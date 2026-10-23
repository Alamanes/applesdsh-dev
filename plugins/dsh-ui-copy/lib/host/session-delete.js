/**
 * dsh-ui-copy host half — session-delete.
 *
 * Answers one exact route on the harness web server:
 *
 *   POST /dsh-ui-copy/session-delete/delete   { sessionId } → { ok, removed, failed }
 *
 * Why the Host owns this: the shipped harness can archive a Session but has no
 * way to delete one. Neither `ctx.sessions` nor `ctx.sessionPersistence` (nor
 * the JSONL backend behind it) exposes a removal API, and `workspace.json`
 * only records archive and pin membership — so a component that deletes owns
 * the whole operation: the durable session directory, the workspace registry
 * references to it, and the projection-cache row beside them.
 *
 * The authoritative data is the session directory itself:
 * `<sessions root>/<projectKey(cwd)>/<encodeSegment(id)>`. It is derived here
 * exactly as `@deepseek-ai/dsh-session-persistence-jsonl` derives it, because
 * that backend keeps its root private and publishes no path accessor. The
 * encoding is reproduced rather than approximated: a raw id must never reach
 * the filesystem, and a mismatched spelling would delete the wrong directory
 * or nothing at all.
 *
 * Registry state is written only through `ctx.workspaceRegistry` — never by
 * editing `workspace.json` — so the `domain/changed` broadcast that refreshes
 * every open list is emitted for free.
 *
 * A live Session does not block deletion. The request is the authority: the
 * directory goes away even while a client still holds the Session open, and a
 * running turn is left to fail its next append rather than being waited for.
 * That is the point of a forced delete --- nothing about the Session's runtime
 * state is a reason to keep its bytes on disk.
 *
 * @module dsh-ui-copy/host/session-delete
 */

import { rm, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** Config field in the suite's schema this host half answers to. */
export const KEY = 'sessionDelete'

/** Suite route base; the browser half hard-codes the same prefix. */
const ROUTE_BASE = '/dsh-ui-copy/session-delete'

/** The one write route this component serves. */
const DELETE_ROUTE = `${ROUTE_BASE}/delete`

/**
 * The route this component served while it was a standalone plugin.
 *
 * Still registered, against the same handler, because a page cached from before
 * the migration keeps posting to the old spelling until it is reloaded.
 */
const LEGACY_DELETE_ROUTE = '/dsh-session-delete/delete'

/** Refuse a request body larger than this instead of buffering it. */
const MAX_BODY_BYTES = 64 * 1024

/** The environment variable that relocates the harness home, matching `@deepseek-ai/dsh-home-paths`. */
const DSH_HOME_ENV = 'DSH_HOME'

/** Project directory used by the backend for a Session whose header carries no `cwd`. */
const NO_CWD_DIRECTORY = '_no-cwd'

/** Session ids this component accepts; the same alphabet the backend's path encoder treats as literal. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,200}$/

/**
 * Read one config field, whether the loader handed over a volatile reference
 * or a plain value.
 *
 * @param value - the field as the config exposes it.
 * @returns the plain value, or `undefined` for a missing field.
 */
function readOption(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') return value.get()
  return value
}

/** A usable non-empty string, or `null`. */
function optionalString(value) {
  const plain = readOption(value)
  return typeof plain === 'string' && plain.trim() !== '' ? plain.trim() : null
}

/** Expand a configured path's `~` prefix against the OS home directory. */
function expandHome(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2))
  return value
}

/**
 * The harness home this process is running against.
 *
 * `DSH_HOME` wins when set, matching `@deepseek-ai/dsh-home-paths`; otherwise
 * the default `~/.dsh` applies.
 *
 * @returns the absolute harness home directory.
 */
function dshHome() {
  const configured = optionalString(process.env[DSH_HOME_ENV])
  return configured === null ? path.join(homedir(), '.dsh') : path.resolve(expandHome(configured))
}

/** The configured session log root, or the harness default. */
function sessionsRoot(config) {
  const configured = optionalString(config?.sessionsRoot)
  return configured === null ? path.join(dshHome(), 'sessions') : path.resolve(expandHome(configured))
}

/** The configured projection-cache root, or the harness default. */
function projectionCacheRoot(config) {
  const configured = optionalString(config?.projectionCacheRoot)
  return configured === null ? path.join(dshHome(), 'storages', 'session_projcache') : path.resolve(expandHome(configured))
}

/**
 * Encode a session id as one safe path segment.
 *
 * Reproduced from the JSONL backend: `[A-Za-z0-9._-]` stays literal except for
 * the two whole-segment traversal spellings, and every other code unit becomes
 * `~XXXX`.
 *
 * @param raw - the session id.
 * @returns the escaped single path segment.
 */
function encodeSegment(raw) {
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < raw.length; index++) {
    const code = raw.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character !== '~' && /^[A-Za-z0-9._-]$/.test(character)) out += character
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/**
 * Build the human-navigable project directory name for a session's `cwd`.
 *
 * Reproduced from the JSONL backend: separators collapse into single dashes,
 * unsafe code units use the same escape as ids, and the key is bounded for
 * filesystem component limits.
 *
 * @param cwd - the session's project directory.
 * @returns the project directory name, including its `--` fences.
 */
function projectKey(cwd) {
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index++) {
    const code = cwd.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character === '/' || character === '\\' || character === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
      continue
    }
    separatorRun = false
    if (character !== '~' && /^[A-Za-z0-9._-]$/.test(character)) readable += character
    else readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/**
 * The directory one session owns.
 *
 * @param root - the configured session log root.
 * @param header - the stored session header, read only for its `cwd`.
 * @param id - the session id.
 * @returns the absolute session directory path.
 */
function sessionDirectory(root, header, id) {
  const cwd = typeof header?.cwd === 'string' && header.cwd !== '' ? header.cwd : undefined
  const project = cwd === undefined ? path.join(root, NO_CWD_DIRECTORY) : path.join(root, projectKey(cwd))
  return path.join(project, encodeSegment(id))
}

/**
 * Whether a path is the root itself or lies beneath it.
 *
 * The last fence before `rm -r`: whatever the header said, the directory this
 * component removes must stay inside the configured session root.
 *
 * @param root - the configured session log root.
 * @param target - the candidate directory.
 * @returns whether the target is the root or one of its descendants.
 */
function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** A loopback authority: `localhost`, `*.localhost`, `127.0.0.0/8`, or `::1`. */
function isLoopbackHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (host === '') return false
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1') return true
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (parts === null) return false
  if (Number(parts[1]) !== 127) return false
  return [parts[2], parts[3], parts[4]].every((part) => Number(part) <= 255)
}

/** The host's browser fence, when this build exposes one. */
function connectionFence(ctx) {
  try {
    const connection = ctx.get('connection')
    return connection !== undefined && typeof connection.requestRejection === 'function' ? connection : null
  } catch {
    return null
  }
}

/**
 * Decide whether one request must be refused.
 *
 * The order mirrors the shipped surfaces: this component's own checks always
 * run, and the host fence is consulted afterwards so a deployment that declares
 * extra trusted hosts keeps working. A fence that throws is treated as a
 * refusal rather than as an absent fence.
 *
 * @param ctx - plugin context.
 * @param req - the incoming request.
 * @returns the status code to answer with, or `null` to serve the request.
 */
function rejectionFor(ctx, req) {
  const method = String((req && req.method) || 'GET').toUpperCase()
  if (method !== 'POST') return 405
  const headers = (req && req.headers) || {}
  if (String(headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return 403
  const fence = connectionFence(ctx)
  if (fence === null) {
    let hostname
    try {
      hostname = new URL(`http://${String(headers.host || '')}`).hostname
    } catch {
      return 403
    }
    return isLoopbackHostname(hostname) ? null : 403
  }
  let code
  try {
    code = fence.requestRejection(req)
  } catch {
    return 403
  }
  if (code === undefined || code === null || code === false) return null
  return typeof code === 'number' ? code : 403
}

/**
 * Answer one request with a body.
 *
 * @param res - the response to own.
 * @param status - HTTP status.
 * @param type - `Content-Type`.
 * @param body - response bytes.
 */
function send(res, status, type, body) {
  try {
    res.writeHead(status, {
      'Content-Type': type,
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
    })
    res.end(body)
  } catch {
    try {
      res.end()
    } catch {
      // The socket is already gone; there is nothing left to answer on.
    }
  }
}

/** Answer one request with JSON. */
function sendJson(res, status, payload) {
  send(res, status, 'application/json; charset=utf-8', Buffer.from(JSON.stringify(payload)))
}

/**
 * Read and parse a bounded JSON body.
 *
 * @param req - the incoming request.
 * @returns the parsed body.
 * @throws when the body is oversized, empty, or not JSON.
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('request body is not JSON'))
      }
    })
  })
}

/**
 * Every session this deletion covers: the named one plus its subagent
 * descendants.
 *
 * Lineage follows the stored headers the way the shipped archive gate does —
 * through `origin === 'subagent'` and `parentSession` only. A fork of the
 * session stays behind: it is an independent conversation with its own log.
 *
 * @param headers - stored headers by session id.
 * @param rootId - the named session.
 * @returns the target ids, root first.
 */
function lineageOf(headers, rootId) {
  const targets = [rootId]
  const seen = new Set(targets)
  for (let index = 0; index < targets.length; index++) {
    for (const [id, header] of headers) {
      if (seen.has(id)) continue
      if (header?.origin !== 'subagent') continue
      if (header.parentSession !== targets[index]) continue
      seen.add(id)
      targets.push(id)
    }
  }
  return targets
}

/**
 * How alive a session is in this process.
 *
 * Reported in the result, never used to refuse: a forced delete removes the
 * bytes whatever the runtime state is. The two cases stay apart so a caller can
 * tell a cancelling turn from an idle open handle.
 *
 * @param ctx - plugin context.
 * @param id - the session id.
 * @returns `'running'`, `'open'`, or `null` when the session holds nothing.
 */
function livenessOf(ctx, id) {
  let open = false
  try {
    const sessions = ctx.get('sessions')
    open = sessions !== undefined && sessions.get(id) !== undefined
  } catch {
    // A store without a session for this id is the ordinary case.
  }
  if (!open) {
    try {
      open = typeof ctx.sessionPersistence.hasPendingSession === 'function' && ctx.sessionPersistence.hasPendingSession(id)
    } catch {
      // Older backends carry no pending query; absence is not liveness.
    }
  }
  if (!open) return null
  try {
    const agent = ctx.get('agents')?.get(id)
    return agent?.status === 'running' ? 'running' : 'open'
  } catch {
    return 'open'
  }
}

/**
 * Delete one session lineage.
 *
 * Forced: the durable directories go first, then the registry references, and
 * a live Session only appears in the result as a note. A failure partway leaves
 * the session visible in the UI, which is the recoverable direction.
 *
 * @param ctx - plugin context.
 * @param config - the component's config block.
 * @param rootId - the named session id.
 * @returns the operation result.
 */
async function deleteLineage(ctx, config, rootId) {
  const snapshots = await ctx.sessionPersistence.list()
  const headers = new Map()
  for (const snapshot of snapshots) headers.set(snapshot.header.id, snapshot.header)

  const targets = lineageOf(headers, rootId)
  const live = []
  for (const id of targets) {
    const state = livenessOf(ctx, id)
    if (state !== null) live.push({ id, state })
  }

  const present = targets.filter((id) => headers.has(id))
  if (present.length === 0) return { ok: false, reason: 'unknown', ids: [rootId] }

  const root = sessionsRoot(config)
  const removed = []
  const failed = []
  for (const id of present) {
    const directory = sessionDirectory(root, headers.get(id), id)
    if (!isInside(root, directory)) {
      failed.push({ id, reason: 'outside-root', path: directory })
      continue
    }
    try {
      await rm(directory, { recursive: true, force: true })
      removed.push(id)
    } catch (error) {
      failed.push({ id, reason: 'unlink-failed', message: String((error && error.message) || error) })
    }
  }

  const workspaces = ctx.workspaceRegistry.list()
  for (const id of present) {
    for (const workspace of workspaces) {
      if (!workspace.sessionIds.includes(id)) continue
      await workspace.detachSession(id)
    }
    await ctx.workspaceRegistry.unpinSession(id)
    await ctx.workspaceRegistry.unarchiveSession(id)
    await dropProjectionCache(ctx, config, id)
  }

  return removed.length === 0
    ? { ok: false, reason: 'unlink-failed', ids: present, failed }
    : { ok: true, removed, failed, live }
}

/**
 * Drop one session's projection-cache row.
 *
 * The cache is derived state — a stale row is rejected by identity on the next
 * read — so a failure here is reported but never fails the deletion.
 *
 * @param ctx - plugin context.
 * @param config - the component's config block.
 * @param id - the session id.
 */
async function dropProjectionCache(ctx, config, id) {
  try {
    await unlink(path.join(projectionCacheRoot(config), 'sessions', `${id}.json`))
  } catch (error) {
    if (error && error.code === 'ENOENT') return
    ctx.logger.warn(`session-delete: projection cache for ${id} not removed: ${String((error && error.message) || error)}`)
  }
}

/**
 * Serve one deletion request.
 *
 * @param ctx - plugin context, for the browser fence and the services.
 * @param config - the component's config block, read per request.
 * @returns the route handler.
 */
function deleteHandler(ctx, config) {
  return async (req, res) => {
    const rejection = rejectionFor(ctx, req)
    if (rejection !== null) return sendJson(res, rejection, { ok: false, reason: 'refused' })

    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      return sendJson(res, 400, { ok: false, reason: 'bad-request', message: String((error && error.message) || error) })
    }

    const sessionId = body !== null && typeof body === 'object' ? body.sessionId : undefined
    if (typeof sessionId !== 'string' || !SAFE_ID.test(sessionId)) {
      return sendJson(res, 400, { ok: false, reason: 'invalid-id' })
    }

    try {
      const result = await deleteLineage(ctx, config, sessionId)
      sendJson(res, result.ok ? 200 : 409, result)
    } catch (error) {
      ctx.logger.warn(`session-delete: deleting ${sessionId} failed: ${String((error && error.stack) || error)}`)
      sendJson(res, 500, { ok: false, reason: 'failed', message: String((error && error.message) || error) })
    }
  }
}

/**
 * Mount the routes.
 *
 * `webServer` is injected locally rather than declared on the plugin, so this
 * component still applies in a composition without a web server: it simply
 * serves nothing there, and the browser half stays inert because its fetches
 * fail. The Session persistence and workspace registry services are waited for
 * in the same hop, because the handler cannot be correct without either.
 *
 * Two exact paths share one handler: the suite route, and the standalone
 * plugin's old route, kept for pages cached from before the migration.
 *
 * @param ctx - host plugin context.
 * @param config - the component's config block.
 */
export function apply(ctx, config = {}) {
  const options = config !== null && typeof config === 'object' ? config : {}

  ctx.inject(['sessionPersistence', 'workspaceRegistry', 'webServer'], (web) => {
    const handler = deleteHandler(ctx, options)
    web.effect(() => {
      const disposers = [DELETE_ROUTE, LEGACY_DELETE_ROUTE].map((route) =>
        web.webServer.register({ kind: 'exact', path: route, handler }),
      )
      return () => {
        for (const dispose of disposers) {
          if (typeof dispose === 'function') dispose()
        }
      }
    })
    web.logger.info(`session-delete: serving ${DELETE_ROUTE} (alias ${LEGACY_DELETE_ROUTE}; sessions: ${sessionsRoot(options)})`)
  })
}
