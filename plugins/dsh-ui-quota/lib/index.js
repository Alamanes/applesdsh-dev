/**
 * dsh-ui-quota host half — Command Code plan quota.
 *
 * Serves the Command Code account quota report to the browser half over one
 * exact Fetch route on Connection's shared `/api` transport, and registers the
 * optional `/quota` slash command that prints the same report into a
 * conversation.
 *
 * The browser cannot call Command Code itself — the API key lives on the host
 * and the Provider API is not browser-CORS reachable — so the settings section
 * asks the host for a normalized report. Registering the route through
 * Connection's exact Fetch registry (rather than `connection.rpc.handle`) is
 * deliberate: `handle` mounts the channel with `owner.webServer`, whose
 * resolution walks the Connection plugin's own fiber chain — where `webServer`
 * is never in scope — so it throws `cannot get property "webServer" without
 * inject` for every caller outside that package, no matter what the caller
 * injects (dsh 0.1.5-rc.1). An exact route is served by the same `/api`
 * transport as the rest of the GUI, so it inherits the Host/Origin fence and
 * the browser-session cookie: only a same-origin browser holding this process's
 * cookie reaches it.
 *
 * Routes
 *   `/api/dsh-ui-copy/quota/cc-quota/report`  the suite's own path
 *   `/api/cc-quota/report`                    the pre-suite path, kept as an alias
 *
 * Both paths share one handler and one cache, so an older browser half that still
 * posts to the old path keeps working while this package's components use the
 * namespaced one. The suite namespace has to live in the *endpoint* rather than
 * in the channel: `connection.rpc.call` validates its channel against a single
 * path segment, so with channel `/api` the endpoint
 * `dsh-ui-copy/quota/cc-quota/report` is what produces the namespaced path. That
 * endpoint is also the method inside the request envelope, and the handler
 * accepts the pre-suite method `cc-quota/report` on the alias route.
 *
 * The token heat map travels over a second route of its own,
 * `/api/cc-quota/activity`; `lib/quota.mjs` is the read-only Command Code source
 * that derives the three credit windows.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { credentialFingerprint, fetchQuotaReport, quotaSnapshotPath } from './quota.mjs'

/** Config field in the suite's schema this host half answers to. */
export const CONFIG_KEY = 'quota'

/** Package root, for the bundled token sheet. */
const LIB = fileURLToPath(new URL('./', import.meta.url))

/** Shared browser transport; routes under it inherit its fence and session. */
const CHANNEL = '/api'

/* ---- Chinese public-holiday calendar ----------------------------------- */

/**
 * The peak/valley hint in the menu drawer reads its leave dates from here.
 *
 * There is no official API: the State Council publishes a notice every
 * November, and the `holiday-cn` project republishes it as one JSON document per
 * year. This half fetches the current Beijing year and the next one, unions the
 * two and memoizes the result for a day. `ok: false` means nothing was fetched
 * this time; the browser keeps a baked-in list for exactly that case.
 */
const HOLIDAY_SOURCE_BASE = 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master'
const HOLIDAY_MIRROR_BASE = 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master'
const HOLIDAY_ROUTE_PATH = '/dsh-ui-copy/peak-valley/holidays.json'
const HOLIDAY_LEGACY_ROUTE_PATH = '/dsh-peak-valley/holidays.json'
const HOLIDAY_BEIJING_OFFSET_MS = 8 * 3600 * 1000
const HOLIDAY_CACHE_TTL_MS = 24 * 3600 * 1000
const HOLIDAY_FETCH_TIMEOUT_MS = 8000

/** Memoized union of the years fetched, plus why the last attempt failed. */
let holidayCache = { at: 0, ok: false, holidays: [], error: '' }

/** The refresh in flight, so concurrent route hits share one fetch. */
let holidayInFlight = null

/** Beijing calendar year of an instant. */
function beijingYearOf(ms) {
  return new Date(ms + HOLIDAY_BEIJING_OFFSET_MS).getUTCFullYear()
}

/** One year's days off, from whichever base answers first. */
async function fetchHolidayYear(year) {
  const errors = []
  for (const base of [HOLIDAY_SOURCE_BASE, HOLIDAY_MIRROR_BASE]) {
    try {
      const response = await fetch(`${base}/${year}.json`, { signal: AbortSignal.timeout(HOLIDAY_FETCH_TIMEOUT_MS) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      const days = Array.isArray(body?.days) ? body.days : []
      return days
        .filter((day) => day !== null && typeof day === 'object' && day.isOffDay === true && typeof day.date === 'string')
        .map((day) => day.date)
    } catch (error) {
      errors.push(`${base}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(errors.join('; '))
}

/** Fetch both years and replace the memo. */
async function refreshHolidays() {
  const year = beijingYearOf(Date.now())
  const holidays = new Set()
  const errors = []
  for (const target of [year, year + 1]) {
    try {
      for (const date of await fetchHolidayYear(target)) holidays.add(date)
    } catch (error) {
      errors.push(`${target}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  holidayCache = {
    at: Date.now(),
    ok: holidays.size > 0,
    holidays: [...holidays].sort(),
    error: errors.join('; '),
  }
  return holidayCache
}

/** The memo, refreshed when it has expired. */
async function currentHolidays() {
  if (holidayCache.ok && Date.now() - holidayCache.at < HOLIDAY_CACHE_TTL_MS) return holidayCache
  if (holidayInFlight === null) {
    holidayInFlight = refreshHolidays().finally(() => {
      holidayInFlight = null
    })
  }
  return holidayInFlight
}

/** The handler both calendar routes share. */
async function holidaysHandler(request, response) {
  let result = holidayCache
  try {
    result = await currentHolidays()
  } catch (error) {
    result = { ...holidayCache, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify({
    ok: result.ok,
    holidays: result.holidays,
    source: HOLIDAY_SOURCE_BASE,
    fetchedAt: result.at,
    year: beijingYearOf(Date.now()),
    error: result.error,
  }))
}

/** Mount the calendar routes on the host web server. */
function mountHolidayRoutes(ctx) {
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const mounted = []
      for (const routePath of [HOLIDAY_ROUTE_PATH, HOLIDAY_LEGACY_ROUTE_PATH]) {
        const dispose = scope.webServer.register({ kind: 'exact', path: routePath, handler: holidaysHandler })
        if (typeof dispose === 'function') mounted.push(dispose)
      }
      return () => {
        for (const dispose of mounted) dispose()
      }
    }, 'ui-copy/quota: holiday routes')
  })
}

/**
 * Endpoint name; the browser sends it as the envelope method.
 *
 * This is the pre-suite spelling on purpose. The exact Fetch registry matches a
 * concrete path and a three-segment endpoint was answered with 404, so the
 * suite keeps the proven two-segment shape rather than spending a host upgrade
 * on cosmetics; the suite namespace lives in the command name, the settings
 * section id and the route file's own docs.
 */
const ENDPOINT = 'cc-quota/report'

/** Path the exact Fetch registry matches, channel included. */
const ROUTE_PATH = `${CHANNEL}/${ENDPOINT}`

/** The namespaced spelling, registered when the registry accepts it. */
const LEGACY_ENDPOINT = 'dsh-ui-copy/quota/cc-quota/report'
const LEGACY_ROUTE_PATH = `${CHANNEL}/${LEGACY_ENDPOINT}`

/**
 * Serve a cached report for this long. The panel polls, and every miss costs
 * four upstream requests against the same account the user is coding on.
 */
const CACHE_MS = 15_000

/**
 * How old a snapshot on disk may be and still be worth showing.
 *
 * The panel's first paint waits for an upstream round trip — measured at ~1.3 s
 * against the live API, of which the two slowest endpoints are each over a
 * second — and a freshly started dsh has nothing cached. That is exactly the
 * "the card takes a moment to appear" case. Serving the previous snapshot
 * immediately, dimmed and labelled with its age, turns the wait into no wait;
 * the fresh report lands about a second later and replaces it.
 *
 * Past this age the numbers stop being a useful stand-in (the 5-hour window
 * alone rolls over several times a day), so the panel starts blank instead of
 * guessing.
 */
const SNAPSHOT_MAX_MS = 6 * 3_600_000

/**
 * Wrap one result in the `server-response` envelope the browser caller checks.
 * @param rpcId - the caller's correlation id, echoed back verbatim.
 * @param result - `{ ok: true, value }` or `{ ok: false, error }`.
 * @returns the HTTP response carrying that envelope.
 */
function envelope(rpcId, result) {
  return Response.json({ type: 'server-response', rpcId, result })
}

/**
 * Read the last good snapshot from disk.
 *
 * The file wraps the report with the fingerprint of the credential it was taken
 * with, so a snapshot cannot be served to a different account than the one it
 * describes. A missing, unreadable, malformed or unrecognised-version file
 * simply means there is nothing to show early — never an error the user sees.
 *
 * @param file - the snapshot path.
 * @returns `{ fingerprint, report }`, or undefined.
 */
function readSnapshot(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || parsed.version !== 1) return undefined
    const report = parsed.report
    const fingerprint = parsed.fingerprint
    if (typeof fingerprint !== 'string' || report === null || typeof report !== 'object') return undefined
    if (typeof report.fetchedAt !== 'string') return undefined
    return { fingerprint, report }
  } catch {
    return undefined
  }
}

/**
 * Persist the last good snapshot. Best effort: a read-only home directory must
 * not break the panel; it only costs the next cold start its head start.
 *
 * @param file - the snapshot path.
 * @param report - the report that was just fetched.
 * @param fingerprint - the credential fingerprint it belongs to.
 */
function writeSnapshot(file, report, fingerprint) {
  try {
    // The snapshot carries the account name and its spend, so it gets the same
    // modes dsh's own credential store uses. Written beside the target and
    // renamed, so a second dsh reading during this write never sees a
    // half-written report, and the per-pid name keeps two writers apart.
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const temp = `${file}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify({ version: 1, fingerprint, report }), { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, file)
  } catch {
    // Ignored on purpose: see above.
  }
}

/**
 * An RPC error result, in the same shape the Connection transport uses.
 * @param rpcId - the caller's correlation id.
 * @param code - stable machine-readable code.
 * @param message - human-readable detail.
 * @param details - structured extras; `issues` matches the transport's shape.
 * @returns the HTTP response carrying that error.
 */
function failure(rpcId, code, message, details = {}) {
  return envelope(rpcId, { ok: false, error: { code, message, details } })
}

/** Compact money text for the `/quota` command output. */
function money(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(2)}` : '—'
}

/** Short token counts (`210.0M`) for the `/quota` command output. */
function shortTokens(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return String(value)
}

/** Human countdown to a reset instant, coarse enough to stay stable in chat. */
function countdown(resetAt) {
  if (typeof resetAt !== 'number' || !Number.isFinite(resetAt)) return undefined
  const minutes = Math.floor((resetAt - Date.now()) / 60_000)
  // A passed instant is not "now": the next refresh replaces the window, and a
  // line claiming it resets in this second reads as a stalled report.
  if (minutes <= 0) return undefined
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h${minutes % 60}m`
  return `${Math.floor(minutes / 1_440)}d${Math.floor((minutes % 1_440) / 60)}h`
}

/**
 * One `/quota` output line for a credit window. Absent windows (pay-as-you-go
 * plans) produce no line at all rather than a placeholder.
 *
 * Money is printed for the monthly allowance only: the rolling windows are
 * pass/fail limits, so their dollar figures would be noise — the same reason
 * the card omits them.
 */
function commandWindowLine(label, source, resetAt, withMoney = false) {
  if (source === undefined || source === null) return undefined
  // A read that straddles a billing boundary cannot state a percentage: the two
  // endpoints behind it describe different periods.
  if (withMoney && source.capSuspect === true) {
    const reset = countdown(resetAt)
    return `${label} reading straddles a billing boundary${reset === undefined ? '' : ` · resets in ${reset}`}`
  }
  const percent = typeof source.percent === 'number' ? `${source.percent.toFixed(1)}% used` : 'usage unavailable'
  const span = withMoney && source.used !== undefined && source.cap !== undefined
    ? ` · ${money(source.used)} / ${money(source.cap)} · ${money(Math.max(0, source.cap - source.used))} left`
    : ''
  const reset = countdown(resetAt)
  return `${label} ${percent}${span}${reset === undefined ? '' : ` · resets in ${reset}`}`
}

/**
 * Render the normalized report as the `/quota` command's chat text.
 *
 * Plain lines on purpose: chat surfaces wrap freely, so nothing here depends on
 * column alignment.
 */
function formatReportText(report) {
  const lines = []
  const plan = report?.plan
  lines.push(`Command Code · ${plan?.name ?? plan?.planId ?? 'account'}${plan?.status === undefined ? '' : ` (${plan.status})`}`)

  const periodEnd = plan?.currentPeriodEnd === undefined ? undefined : Date.parse(plan.currentPeriodEnd)
  const rows = [
    commandWindowLine('5-hour', report?.fiveHour, report?.fiveHour?.resetAt),
    commandWindowLine('Weekly', report?.weekly, report?.weekly?.resetAt),
    commandWindowLine('Monthly', report?.monthly, periodEnd, true),
  ].filter((line) => line !== undefined)
  if (rows.length === 0) {
    lines.push('No credit windows reported for this plan.')
  } else {
    lines.push(...rows)
  }

  const totals = report?.totals
  if (totals?.requests !== undefined) {
    lines.push(`${totals.requests.toLocaleString('en-US')} requests · ${totals.successRate ?? '—'}% success · in ${shortTokens(totals.tokensIn)} / out ${shortTokens(totals.tokensOut)}`)
  }
  if (report?.failures?.length > 0) {
    lines.push(`Degraded endpoints: ${report.failures.join('; ')}`)
  }
  return lines.join('\n')
}


/**
 * Register the quota routes on the host Connection service.
 *
 * The report path never throws: every upstream failure is converted into the RPC
 * error result so the browser half can render a message instead of a transport
 * failure. A malformed request or a mismatched method is a programming error on
 * the caller side and is reported as `bad-request`.
 *
 * @param ctx - host plugin context carrying the `connection` service.
 */
function install(ctx) {
  /** @type {{ at: number, report: unknown } | undefined} */
  let cache

  /** Where the last good report is kept between process lifetimes. */
  const snapshotFile = quotaSnapshotPath()
  /**
   * The snapshot read once at startup. Read lazily-adjacent to the first call
   * rather than on every call: it exists for the first paint, and after that the
   * in-process cache is what answers.
   */
  let snapshot = readSnapshot(snapshotFile)

  /**
   * Whether this machine still points at Command Code, and with which key.
   *
   * The snapshot exists to make the card appear instantly, not to outlive the
   * configuration it belongs to. Somebody who just removed their Command Code
   * provider must get the "not applicable here" answer (and so no card) rather
   * than a reading from an account they no longer have wired up — and somebody
   * who switched accounts must not see the previous account's numbers. The first
   * question is a resolve-or-not check, the second is the fingerprint match
   * against the snapshot. Both are a few small file reads plus a digest, and only
   * run on the cold path.
   *
   * @returns the current credential fingerprint, or undefined when nothing resolves.
   */
  const currentFingerprint = () => credentialFingerprint()

  /**
   * The read currently in progress, if any.
   *
   * Two callers can want a report at the same moment — the section's poll and a
   * `/quota` invocation, say. Without this, both would fetch, and the slower
   * response would land last and overwrite the cache with the older snapshot,
   * which is exactly the kind of quietly-wrong number a drifting account makes
   * hard to spot. Joining the in-flight read keeps one snapshot per window and
   * one upstream cost per snapshot.
   *
   * @type {Promise<object> | undefined}
   */
  let inFlight


  /**
   * Read once from upstream, then cache and persist the result.
   * @returns the RPC result for this read; never throws.
   */
  const fetchOnce = async () => {
    try {
      const value = await fetchQuotaReport()
      cache = { at: Date.now(), report: value }
      // Keep the last good report on disk — and in memory — so the next cold
      // start (a dsh restart, a page reload after the host recycled) can paint
      // instantly instead of waiting out another upstream round trip. Refreshing
      // the in-memory copy matters too: otherwise the stale path would go on
      // serving whatever was on disk at startup, which is older than the report
      // already fetched.
      const fingerprint = currentFingerprint()
      snapshot = fingerprint === undefined ? undefined : { fingerprint, report: value }
      if (fingerprint !== undefined) writeSnapshot(snapshotFile, value, fingerprint)
      return { ok: true, value }
    } catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN'
      // Nothing on this machine points at Command Code, so the plugin has no job
      // here. This travels as a *successful* response carrying a marker rather
      // than an RPC error: the transport's error schema is a discriminated union
      // of known codes, so an invented code fails the browser's validation and
      // surfaces as a transport failure — the opposite of hiding.
      if (code === 'MISSING_CREDENTIAL' && error.configured === false) {
        return { ok: true, value: { configured: false, reason: 'no-commandcode-provider' } }
      }
      return {
        ok: false,
        error: {
          code: 'internal',
          message: `[${code}] ${error instanceof Error ? error.message : String(error)}`,
          details: {},
        },
      }
    }
  }

  /**
   * Serve a report, preferring the cheapest source that can answer honestly.
   *
   * Order: the in-process cache (≤15 s old, no marker), then — only on a true
   * cold start — the snapshot on disk, labelled `stale` and served *while* a
   * refresh runs behind it, then a blocking upstream read.
   *
   * The snapshot is deliberately restricted to the case where nothing has been
   * read successfully in this process yet. Serving it whenever the 15 s cache
   * lapsed would mean answering every poll with a dimmed, ageing snapshot while a
   * live read was already on its way — the panel would visibly grey out every few
   * seconds for no gain, since the numbers it is already showing are just as old
   * as the snapshot's. Once one live read has landed, waiting ~1.3 s for the next
   * one is invisible to a user looking at a card that is already painted.
   *
   * @param options.allowStale - whether a snapshot may be served early. The
   *   browser route says yes because its first paint is the whole point; the
   *   `/quota` command says no, because somebody who typed a command wants a
   *   current answer, not a labelled guess.
   * @returns the RPC result for this call.
   */
  const report = async ({ allowStale = false } = {}) => {
    const now = Date.now()
    if (cache !== undefined && now - cache.at < CACHE_MS) {
      return { ok: true, value: cache.report }
    }

    // Start (or join) the refresh either way: the snapshot must never become a
    // reason to stop asking upstream.
    if (inFlight === undefined) {
      inFlight = fetchOnce().finally(() => { inFlight = undefined })
    }

    if (allowStale && cache === undefined) {
      const fingerprint = currentFingerprint()
      // Only this account's own snapshot: see `currentFingerprint`.
      const belongsHere = fingerprint !== undefined && snapshot !== undefined && snapshot.fingerprint === fingerprint
      const age = Date.parse(snapshot?.report?.fetchedAt ?? '')
      const ageMs = now - age
      if (belongsHere && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < SNAPSHOT_MAX_MS) {
        // Forwarded whole, plus the two fields that make the fallback honest:
        // that it is one, and how old it is.
        return { ok: true, value: { ...snapshot.report, stale: true, staleAgeMs: ageMs } }
      }
    }

    return inFlight
  }

  /**
   * Read one client-request envelope and answer it.
   * @param request - the Fetch request the Connection bridge composed.
   * @returns the response; never throws.
   */
  const serve = async (request) => {
    if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      return new Response('content type must be application/json', { status: 415 })
    }

    let body
    try {
      body = await request.json()
    } catch {
      return new Response('body is not JSON', { status: 400 })
    }

    const message = body !== null && typeof body === 'object' ? body : undefined
    const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request'
    if (message?.type !== 'client-request' || typeof message.method !== 'string') {
      return failure(rpcId, 'bad-request', 'invalid client-request message', { issues: [] })
    }
    // Two paths share this handler, and each carries its own method name; the
    // pre-suite one is accepted for a browser half that still sends it. Anything
    // else reached us on the wrong route.
    if (message.method !== ENDPOINT && message.method !== LEGACY_ENDPOINT) {
      return failure(rpcId, 'bad-request', `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(ENDPOINT)}`, { issues: [] })
    }

    const result = await report({ allowStale: true })
    return envelope(rpcId, result)
  }

  // One handler, two paths: the suite's own route and the pre-suite alias.
  const route = {
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: serve,
  }
  ctx.effect(() => ctx.connection.fetch.register({ path: ROUTE_PATH, ...route }), 'ui-copy/quota: route')
  ctx.effect(() => ctx.connection.fetch.register({ path: LEGACY_ROUTE_PATH, ...route }), 'ui-copy/quota: legacy route')

  registerQuotaCommand(ctx, report)

  // Daily token activity for the settings page's heat map. Its own route and its
  // own cache: this reads the local session logs, so it costs the Command Code
  // account nothing and must never wait behind the quota cache.
  let activityCache
  const activityServe = async (request) => {
    let body
    try {
      body = await request.json()
    } catch {
      return new Response('body is not JSON', { status: 400 })
    }
    const message = body !== null && typeof body === 'object' ? body : undefined
    const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request'
    const now = Date.now()
    if (activityCache === undefined || now - activityCache.at > ACTIVITY_CACHE_MS) {
      const persistence = optionalService(ctx, 'sessionPersistence')
      if (persistence === undefined) {
        return envelope(rpcId, { ok: true, value: { days: [], unavailable: true, sessions: 0 } })
      }
      activityCache = { at: now, value: await collectDailyTokens(persistence) }
    }
    return envelope(rpcId, { ok: true, value: activityCache.value })
  }
  ctx.effect(() => ctx.connection.fetch.register({
    path: ACTIVITY_ROUTE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: activityServe,
  }), 'ui-copy/quota: activity route')

  // Temporary diagnostic route: the browser half posts the account menu's
  // markup here so it can be inspected from disk.
  ctx.effect(() => ctx.connection.fetch.register({
    path: `${CHANNEL}/cc-quota/debug`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        writeFileSync('/tmp/dsh-menu-debug.html', await request.text())
      } catch {
        // diagnostics only
      }
      return new Response('ok')
    },
  }), 'ui-copy/quota: debug route')

  ctx.logger.info(`cc-quota: serving quota reports on ${ROUTE_PATH} (alias ${LEGACY_ROUTE_PATH})`)
}

/**
 * Register the optional `/quota` slash command on the human-command registry.
 *
 * `commands` is deliberately *not* required: it is an optional service here (the
 * settings section works in profiles that compose no command runtime), and the
 * repo convention is `ctx.get(name)` for exactly that. The handler reuses the
 * route's cached `report()` so a slash invocation never costs more upstream
 * requests than the section would have spent anyway.
 *
 * @param ctx - host plugin context.
 * @param report - the cached report producer shared with the Fetch route.
 */
function registerQuotaCommand(ctx, report) {
  const commands = ctx.get('commands')
  if (commands === undefined) {
    ctx.logger.info('cc-quota: no command runtime composed; /quota not registered')
    return
  }
  ctx.effect(() => commands.register({
    name: 'quota',
    description: 'Show Command Code plan credit usage',
    handler: async () => {
      const result = await report()
      if (!result.ok) {
        return { kind: 'error', text: result.error.message }
      }
      if (result.value !== null && typeof result.value === 'object' && result.value.configured === false) {
        return { kind: 'error', text: 'No Command Code provider is configured on this host.' }
      }
      return { kind: 'success', text: formatReportText(result.value) }
    },
  }), 'ui-copy/quota: /quota command')
}

/**
 * Host body.
 *
 * The suite's loader calls every host half at `apply` time without waiting for
 * the services each one needs, so `connection` is awaited here: the routes cannot
 * exist before it does, and `ctx.inject` skips the callback in a profile that
 * composes no Connection at all — the same outcome as the standalone plugin's
 * `inject` declaring it.
 *
 * @param ctx - host plugin context.
 * @param config - this component's config block; only `enabled` is meaningful,
 *   and `lib/index.js` has already skipped the call when it is false.
 */
function applyComponent(ctx, config) {
  void config
  const start = (scope) => {
    try {
      install(scope)
    } catch (error) {
      console.error('[ui-copy/quota] host half failed', error)
    }
  }
  // Wait for the service instead of probing `ctx.connection`: reading an
  // uninjected service off the context throws in this host, and that throw
  // happened before the wait could be set up — which is why the quota route
  // answered 404 while every other host half of the suite was serving.
  if (typeof ctx.inject !== 'function') {
    console.warn('[ui-copy/quota] ctx.inject is unavailable; quota routes not registered')
    return
  }
  // `sessionPersistence` joins the wait only for the heat map: reading an
  // uninjected service off the context throws in this host, so the collector
  // needs the injection even though the quota route itself never touches it.
  ctx.inject(['connection', 'sessionPersistence'], start)
  mountHolidayRoutes(ctx)
}

/* ---- suite row plumbing ---------------------------------------------- */

/**
 * Hand this package's configuration to its browser half and put the token layer
 * on the page.
 *
 * A boot-graph row arrives as `{ id, url, rev }` and `apply(ctx, config)`
 * always sees an empty config, so the row's configuration has to travel through
 * the page: a `global` injection row carries it, and the browser half reads
 * `window.DSHUI_QUOTA`. The token sheet rides along so this package works when
 * it is installed on its own, without the bundle.
 */
function injectSuiteRow(ctx, config) {
  const value = config !== null && typeof config === 'object' ? config : {}
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: 'DSHUI_QUOTA', value })
    let tokens = null
    try {
      tokens = readFileSync(LIB + 'styles/tokens.css', 'utf8')
    } catch {
      tokens = null
    }
    if (tokens !== null) table.push({ kind: 'style', text: tokens })
  })
}

/* ---- daily token activity ---------------------------------------------- */

/** Endpoint the settings page's heat map posts to. */
const ACTIVITY_ENDPOINT = 'cc-quota/activity'

/** Path the exact Fetch registry matches for the heat map. */
const ACTIVITY_ROUTE_PATH = `${CHANNEL}/${ACTIVITY_ENDPOINT}`

/**
 * Serve a cached activity answer for this long. The scan walks every persisted
 * session, so a page that remounts must not pay for it twice; a minute is short
 * enough that today's cell keeps up with the work being done.
 */
const ACTIVITY_CACHE_MS = 60_000

/** Days of history the heat map asks for: 53 weeks of cells. */
const ACTIVITY_DAYS = 371

/**
 * A service that may or may not be composed, never a throw.
 *
 * The heat map is auxiliary: a profile without session persistence should lose
 * the graph, not the whole section, and `ctx.get` is how the host spells
 * "optional dependency".
 */
function optionalService(ctx, name) {
  try {
    return ctx.get?.(name)
  } catch {
    return undefined
  }
}

/** Local calendar day key, matching what the browser builds from the same rows. */
function dayKeyOf(value) {
  const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(ms)) return undefined
  const date = new Date(ms)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Every event of one persisted session, across both persistence seams.
 *
 * 0.1.3+ exposes `open`/`read`/`close`; rc.1 only has `inspect`. Both yield
 * the same event list, so the fold below never learns which seam answered.
 */
async function readSessionEvents(persistence, id) {
  if (typeof persistence.open === 'function') {
    const handle = await persistence.open(id, 'read')
    try {
      const events = []
      let offset = 0
      const PAGE = 500
      for (;;) {
        const slice = await handle.read(offset, PAGE)
        const page = slice !== null && typeof slice === 'object' && Array.isArray(slice.events) ? slice.events : []
        if (page.length === 0) break
        for (const event of page) events.push(event)
        offset += page.length
      }
      return events
    } finally {
      await handle.close().catch(() => {})
    }
  }
  if (typeof persistence.inspect === 'function') {
    const inspection = await persistence.inspect(id)
    return inspection !== null && typeof inspection === 'object' && Array.isArray(inspection.events) ? inspection.events : []
  }
  return []
}

/**
 * Per-day token totals across every persisted session.
 *
 * Backfill-shaped on purpose: the heat map has to show history this process
 * never watched happen, so the whole log is replayed. Each completed model call
 * owns one (turn, step) key within its session and lands exactly once, so a
 * replayed session never double counts. Token totals are provider-inclusive —
 * uncached input, output, cache reads and cache writes — which is the same
 * number the model provider reports for those calls.
 *
 * @param persistence - the host's session persistence service.
 * @returns the sorted daily series plus how many sessions were read.
 */
async function collectDailyTokens(persistence) {
  const days = new Map()
  const folded = new Map()
  let sessions = 0
  let raw
  try {
    const useAlphaList = typeof persistence.open === 'function'
    raw = useAlphaList ? await persistence.list(undefined) : await persistence.list()
  } catch (error) {
    return { days: [], sessions, error: error instanceof Error ? error.message : String(error) }
  }
  const headers = (Array.isArray(raw) ? raw : [])
    .map((item) => (item !== null && typeof item === 'object' && item.header !== null && typeof item.header === 'object' && typeof item.header.id === 'string' ? item.header : item))
    .filter((header) => header !== null && typeof header === 'object' && typeof header.id === 'string' && header.id !== '')

  for (const header of headers) {
    let events
    try {
      events = await readSessionEvents(persistence, header.id)
    } catch {
      continue
    }
    sessions += 1
    for (const event of events) {
      if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') continue
      const data = event.data
      const usage = data !== null && typeof data === 'object' ? data.usage : undefined
      if (usage === null || typeof usage !== 'object') continue
      const tokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
        + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
      if (!(tokens > 0)) continue
      const day = dayKeyOf(event.time)
      if (day === undefined) continue
      const turn = data.turn
      const step = data.step
      if (typeof turn === 'number' && typeof step === 'number') {
        folded.set(`${header.id}:${turn}:${step}`, { day, tokens })
      } else {
        days.set(day, (days.get(day) ?? 0) + tokens)
      }
    }
  }
  for (const sample of folded.values()) {
    days.set(sample.day, (days.get(sample.day) ?? 0) + sample.tokens)
  }

  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - (ACTIVITY_DAYS - 1))
  const from = dayKeyOf(cutoff.getTime())
  const series = [...days.entries()]
    .filter(([day]) => from === undefined || day >= from)
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([day, tokens]) => ({ day, tokens }))
  return { days: series, sessions }
}

/** Cordis entry: the suite row plumbing, then this package's own host body. */
export function apply(ctx, config) {
  injectSuiteRow(ctx, config)
  return applyComponent(ctx, config)
}
