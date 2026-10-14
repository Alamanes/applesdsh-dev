/**
 * dsh-local-identity — host half.
 *
 * Publishes a locally configured identity (display name + avatar) to this
 * plugin's browser half over two exact routes on the harness web server:
 *
 *   GET /dsh-local-identity/identity.json   the resolved name and avatar URL
 *   GET /dsh-local-identity/avatar          the avatar file's own bytes
 *
 * The browser half cannot read the cordis config: a client bundle enters the
 * page as a boot-graph row (`{ id, url, rev }`) and is mounted as a Loader
 * entry created with `{ name: id }` alone, so the browser half's
 * `apply(ctx, config)` always receives an empty config. The host row is the
 * only half that sees the profile's config, so the identity is read here and
 * published for the page to fetch.
 *
 * Both fields are volatile, which is what makes them editable from the
 * Settings panel: the settings seam projects a form for every active profile
 * entry whose Config declares volatile fields, and a volatile-only change is
 * committed into this plugin's running references without a remount, so
 * reading the references per request is enough for a saved value to take
 * effect on the spot.
 *
 * Every request is fenced before any file is touched: GET/HEAD only, no
 * cross-site fetch metadata, and the host's own browser fence
 * (`connection.requestRejection`) whenever this build exposes one, with a
 * loopback authority check as the local fallback. The avatar path comes from
 * configuration alone — no request may name a file — so no request can turn
 * this route into an arbitrary-path read.
 *
 * @module dsh-local-identity
 */

import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import Schema from '@deepseek-ai/schemastery'

/** Cordis plugin name; keep it equal to the package name so diagnostics agree. */
export const name = 'local-identity'

/**
 * Declared configuration.
 *
 * `name` is the text the sidebar chip shows; `avatar` is a local path, an
 * http(s) URL, or a `data:` URL. Both are volatile so the Settings panel can
 * edit them, and leaving one unset means "not configured" rather than a
 * default.
 */
export const Config = Schema.object({
	name: Schema.string().volatile(),
	avatar: Schema.string().volatile(),
})

/** Route base; the browser half hard-codes the same prefix. */
const ROUTE_BASE = '/dsh-local-identity'

/** Identity document the browser half polls. */
const IDENTITY_ROUTE = `${ROUTE_BASE}/identity.json`

/** Avatar bytes; requested by the page through the `<img>` this plugin inserts. */
const AVATAR_ROUTE = `${ROUTE_BASE}/avatar`

/** Refuse an avatar larger than this instead of reading it into memory. */
const MAX_AVATAR_BYTES = 16 * 1024 * 1024

/** Image types this plugin can label from a file extension. */
const MIME_BY_EXTENSION = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.avif': 'image/avif',
	'.bmp': 'image/bmp',
	'.ico': 'image/x-icon',
	'.svg': 'image/svg+xml',
}

/** Type served when neither the extension nor the magic bytes identify an image. */
const FALLBACK_MIME = 'application/octet-stream'

/**
 * Read one config field, whether the loader handed over a volatile reference, a
 * plain object, or a schemastery-backed section.
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
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Read the current configuration.
 *
 * Called per request rather than once at load: a settings write commits into
 * the running volatile references, so the next request already sees the value
 * the user just saved.
 *
 * @param config - the row config, volatile references or plain values.
 * @returns `{ name, avatar }`, with `null` meaning "not configured".
 */
function readConfig(config) {
	const source = config !== null && typeof config === 'object' ? config : {}
	return {
		name: optionalString(readOption(source.name)),
		avatar: optionalString(readOption(source.avatar)),
	}
}

/**
 * Expand a configured avatar value into either a URL handed to the page
 * untouched or an absolute local path.
 *
 * A path is resolved against the home directory, so a relative value reads as
 * the file next to where the user works rather than as a path relative to
 * whatever directory the harness happened to start in; `~` expands to the home
 * directory.
 *
 * @param value - the configured `avatar` string.
 * @returns `{ kind: 'url', url }` or `{ kind: 'file', file }`.
 */
function resolveAvatarSource(value) {
	if (/^(?:https?:|data:)/i.test(value)) return { kind: 'url', url: value }
	const expanded = value === '~' || value.startsWith('~/') ? path.join(homedir(), value.slice(1)) : value
	return { kind: 'file', file: path.isAbsolute(expanded) ? expanded : path.resolve(homedir(), expanded) }
}

/** Magic-byte sniffing, for files whose extension says nothing usable. */
function sniffMime(bytes) {
	if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
	if (bytes.length >= 6 && bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
	if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
	if (bytes.length >= 12 && bytes.subarray(4, 8).toString('latin1') === 'ftyp') return 'image/avif'
	const head = bytes.subarray(0, 1024).toString('utf8').trimStart().toLowerCase()
	if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml'
	return null
}

/**
 * Read the avatar file for one request.
 *
 * The file is read per request rather than cached at load time: replacing the
 * image on disk is the point of pointing this plugin at a local file, and the
 * version token in the published URL comes from the file's own metadata so a
 * swapped image is a new URL for the page.
 *
 * @param file - absolute path of the configured avatar.
 * @returns `{ ok: true, bytes, mime, version }`, or `{ ok: false, reason }`
 *   with a short machine-readable reason.
 */
function readAvatarFile(file) {
	let stats
	try {
		stats = statSync(file)
	} catch (error) {
		return { ok: false, reason: (error && error.code) || 'unreadable' }
	}
	if (!stats.isFile()) return { ok: false, reason: 'not-a-file' }
	if (stats.size === 0) return { ok: false, reason: 'empty' }
	if (stats.size > MAX_AVATAR_BYTES) return { ok: false, reason: 'too-large' }
	let bytes
	try {
		bytes = readFileSync(file)
	} catch (error) {
		return { ok: false, reason: (error && error.code) || 'unreadable' }
	}
	const extension = path.extname(file).toLowerCase()
	return {
		ok: true,
		bytes,
		mime: MIME_BY_EXTENSION[extension] ?? sniffMime(bytes) ?? FALLBACK_MIME,
		version: `${Math.round(stats.mtimeMs)}-${stats.size}`,
	}
}

/**
 * Build the identity document the page consumes.
 *
 * A configured avatar that cannot be read publishes `avatarUrl: null` plus the
 * reason instead of a broken URL, so the page falls back to its own local
 * placeholder rather than to anything belonging to the account.
 *
 * @param options - current config from {@link readConfig}.
 * @returns the JSON body.
 */
function identityPayload(options) {
	const document = { ok: true, name: options.name, avatarUrl: null, avatarError: null }
	if (options.avatar === null) return document
	const source = resolveAvatarSource(options.avatar)
	if (source.kind === 'url') return { ...document, avatarUrl: source.url }
	const file = readAvatarFile(source.file)
	if (!file.ok) return { ...document, avatarError: file.reason }
	return { ...document, avatarUrl: `${AVATAR_ROUTE}?v=${file.version}` }
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
 * The order mirrors the shipped surfaces: our own checks always run, and the
 * host fence is consulted afterwards so a deployment that declares extra
 * trusted hosts keeps working. A fence that throws is treated as a refusal
 * rather than as an absent fence.
 *
 * @param ctx - plugin context.
 * @param req - the incoming request.
 * @returns the status code to answer with, or `null` to serve the request.
 */
function rejectionFor(ctx, req) {
	const method = String((req && req.method) || 'GET').toUpperCase()
	if (method !== 'GET' && method !== 'HEAD') return 405
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
 * @param req - the incoming request, read only for its method.
 * @param res - the response to own.
 * @param status - HTTP status.
 * @param type - `Content-Type`.
 * @param body - response bytes.
 */
function send(req, res, status, type, body) {
	try {
		res.writeHead(status, {
			'Content-Type': type,
			'Content-Length': String(body.length),
			'Cache-Control': 'no-store',
		})
		if (String((req && req.method) || 'GET').toUpperCase() === 'HEAD') res.end()
		else res.end(body)
	} catch {
		try {
			res.end()
		} catch {
			// The socket is already gone; there is nothing left to answer on.
		}
	}
}

/** Answer one request with JSON. */
function sendJson(req, res, status, payload) {
	send(req, res, status, 'application/json; charset=utf-8', Buffer.from(JSON.stringify(payload)))
}

/** Answer one request with a short plain-text line. */
function sendText(req, res, status, text) {
	send(req, res, status, 'text/plain; charset=utf-8', Buffer.from(`${text}\n`))
}

/**
 * Serve the identity document.
 *
 * @param ctx - plugin context, for the browser fence.
 * @param config - the row config, read per request.
 * @returns the route handler.
 */
function identityHandler(ctx, config) {
	return (req, res) => {
		const rejection = rejectionFor(ctx, req)
		if (rejection !== null) return sendText(req, res, rejection, 'local identity unavailable')
		sendJson(req, res, 200, identityPayload(readConfig(config)))
	}
}

/**
 * Serve the avatar file.
 *
 * @param ctx - plugin context, for the browser fence.
 * @param config - the row config, read per request.
 * @returns the route handler.
 */
function avatarHandler(ctx, config) {
	return (req, res) => {
		const rejection = rejectionFor(ctx, req)
		if (rejection !== null) return sendText(req, res, rejection, 'local identity unavailable')
		const options = readConfig(config)
		if (options.avatar === null) return sendText(req, res, 404, 'no avatar configured')
		const source = resolveAvatarSource(options.avatar)
		if (source.kind !== 'file') return sendText(req, res, 404, 'avatar is served from its own URL')
		const file = readAvatarFile(source.file)
		if (!file.ok) return sendText(req, res, 404, `avatar unavailable: ${file.reason}`)
		send(req, res, 200, file.mime, file.bytes)
	}
}

/**
 * Mount the two routes.
 *
 * `webServer` is injected locally rather than declared on the plugin, so this
 * plugin still applies in a composition without a web server: it simply serves
 * nothing there, and the browser half stays inert because its fetches fail.
 *
 * @param ctx - host plugin context.
 * @param config - the loader row's config, volatile references or plain values.
 */
export function apply(ctx, config = {}) {
	const options = readConfig(config)
	const described =
		options.name === null && options.avatar === null
			? 'nothing configured yet'
			: `name: ${options.name ?? 'unset'}, avatar: ${options.avatar ?? 'unset'}`
	ctx.inject(['webServer'], (web) => {
		web.effect(() => web.webServer.register({ kind: 'exact', path: IDENTITY_ROUTE, handler: identityHandler(web, config) }))
		web.effect(() => web.webServer.register({ kind: 'exact', path: AVATAR_ROUTE, handler: avatarHandler(web, config) }))
		web.logger.info(`local-identity: serving ${IDENTITY_ROUTE} (${described})`)
	})
}
