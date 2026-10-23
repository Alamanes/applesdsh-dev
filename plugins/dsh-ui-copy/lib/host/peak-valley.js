/**
 * dsh-ui-copy host half — peak-valley.
 *
 * Fetches the Chinese public-holiday calendar and serves it to the browser half,
 * so the peak/valley rule follows each year's leave arrangement without anyone
 * editing a date list.
 *
 * There is no official API for this. The State Council publishes a notice every
 * November, and the `holiday-cn` project republishes it as one JSON document per
 * year, whose `days[].isOffDay` flags the days off. This half fetches the
 * current Beijing year and the next one, unions the two, memoizes the result for
 * a day, and answers two routes with the same document:
 *
 *   GET /dsh-ui-copy/peak-valley/holidays.json   the suite's canonical path
 *   GET /dsh-peak-valley/holidays.json           the path the standalone plugin published
 *   -> { ok, holidays: ["2026-01-01", …], source, fetchedAt, year, error }
 *
 * The second path is an alias kept for a browser bundle (or a bookmark) that was
 * built against the standalone plugin: after the merge it still finds its
 * calendar, while the component inside the suite asks for the canonical path.
 *
 * `ok: false` means the fetch found nothing this time — offline machine, source
 * down, or the route asked again while a fetch is already running. The browser
 * half keeps its own baked-in list for exactly that case, so the hint renders
 * the weekday rule either way.
 *
 * No request carries credentials and the response holds nothing but public
 * dates, so the routes go on the same web server the shipped plugin routes use
 * and skip the trust fence the balance widget needs for its account data.
 */

/** Config field in the suite's schema this host half answers to. */
export const KEY = 'peakValley'

/** Where the calendar lives. The CDN answers first in most networks. */
const SOURCE_BASE = 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master'

/** Same documents, straight from the repository, for a network the CDN misses. */
const MIRROR_BASE = 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master'

/** The suite's route; the browser half asks for this one. */
const ROUTE_PATH = '/dsh-ui-copy/peak-valley/holidays.json'

/** The standalone plugin's route, kept as an alias with the very same answer. */
const LEGACY_ROUTE_PATH = '/dsh-peak-valley/holidays.json'

/** Beijing's fixed offset; the calendar is a Beijing-year document. */
const BEIJING_OFFSET_MS = 8 * 3600 * 1000

/** How long a successful union stays good: the notice changes once a year. */
const CACHE_TTL_MS = 24 * 3600 * 1000

/** Per-attempt network budget; the route answers from cache when this expires. */
const FETCH_TIMEOUT_MS = 8000

/** Memoized union of the years fetched, plus why the last attempt failed. */
let cache = { at: 0, ok: false, holidays: [], error: '' }

/** The refresh in flight, so concurrent route hits share one fetch. */
let inFlight = null

/**
 * Beijing calendar year of an instant.
 *
 * @param ms - epoch milliseconds.
 * @returns the year the calendar is keyed by.
 */
function beijingYear(ms) {
  return new Date(ms + BEIJING_OFFSET_MS).getUTCFullYear()
}

/**
 * One year's days off, from whichever base answers first.
 *
 * Make-up workdays are ignored on purpose: they fall on weekends, which the
 * billing rule already counts as valley.
 *
 * @param year - the calendar year.
 * @returns the leave dates, `YYYY-MM-DD`.
 * @throws when neither base answers with a usable document.
 */
async function fetchYear(year) {
  const errors = []
  for (const base of [SOURCE_BASE, MIRROR_BASE]) {
    try {
      const response = await fetch(`${base}/${year}.json`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
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

/**
 * Fetch both years and replace the memo.
 *
 * A year that has no document yet — the next year before its November notice —
 * contributes nothing and is not an error, so the current year still loads.
 *
 * @returns the new memo.
 */
async function refresh() {
  const year = beijingYear(Date.now())
  const holidays = new Set()
  const errors = []
  for (const target of [year, year + 1]) {
    try {
      for (const date of await fetchYear(target)) holidays.add(date)
    } catch (error) {
      errors.push(`${target}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  cache = {
    at: Date.now(),
    ok: holidays.size > 0,
    holidays: [...holidays].sort(),
    error: errors.join('; '),
  }
  return cache
}

/**
 * The memo, refreshed when it has expired.
 *
 * @returns the memo in force.
 */
async function current() {
  if (cache.ok && Date.now() - cache.at < CACHE_TTL_MS) return cache
  if (inFlight === null) {
    inFlight = refresh().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

/**
 * The one handler both routes share.
 *
 * @param req - the incoming request (unused; the answer does not depend on it).
 * @param res - the response to write the JSON document to.
 */
async function holidaysHandler(req, res) {
  let result = cache
  try {
    result = await current()
  } catch (error) {
    result = { ...cache, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(
    JSON.stringify({
      ok: result.ok,
      holidays: result.holidays,
      source: SOURCE_BASE,
      fetchedAt: result.at,
      year: beijingYear(Date.now()),
      error: result.error,
    }),
  )
}

/**
 * Host body: answer the calendar routes.
 *
 * The wait for `webServer` is local rather than a plugin-level `inject`, so a
 * server that is slow to appear delays only these routes, never the row itself.
 * Both paths are mounted in one effect and removed together.
 *
 * @param ctx - host root context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const mounted = []
      for (const path of [ROUTE_PATH, LEGACY_ROUTE_PATH]) {
        const dispose = scope.webServer.register({ kind: 'exact', path, handler: holidaysHandler })
        if (typeof dispose === 'function') mounted.push(dispose)
      }
      return () => {
        for (const dispose of mounted) dispose()
      }
    }, 'ui-copy/peak-valley: holiday routes')
  })
}
