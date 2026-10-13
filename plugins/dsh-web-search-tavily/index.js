/**
 * dsh-web-search-tavily — a Tavily-backed search provider for the DSH web seam.
 *
 * `@deepseek-ai/dsh-web` owns the `ctx.web` capability seam and lets any plugin
 * register a search backend under a stable id. The shipped backend
 * (`dsh-web-search-deepseek`) can only drive an Anthropic-compatible Messages
 * endpoint with the native `web_search` server tool, so it cannot talk to
 * Tavily at all. This plugin registers a second, independent backend under the
 * id `tavily` that speaks Tavily's own `POST /search` REST API, and the profile
 * pins `web.searchProvider: tavily` at it.
 *
 * The provider is deliberately a thin adapter. The seam owns `maxResults`
 * truncation and the `WebError` taxonomy for its own failures, so this module
 * only has to: resolve the credential, dispatch one HTTP request, and map
 * Tavily's `results[]` onto the seam's `sources[]` vocabulary. It reads every
 * option through {@link readOption} so it behaves identically whether the loader
 * hands it a plain JSON config or a schemastery section, and it imports nothing
 * from `@deepseek-ai/*` — the profile resolves `ctx` by injection, not by
 * module resolution, so a bare import of a harness package would not resolve
 * from a profile-local plugin.
 *
 * @module dsh-web-search-tavily
 */

/** Cordis plugin name used by loader diagnostics. Keep it equal to the package name. */
export const name = 'web-search-tavily'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Tavily's search endpoint. */
const DEFAULT_ENDPOINT = 'https://api.tavily.com/search'

/** Credential reference read when the config names no other one. */
const DEFAULT_API_KEY_ENV = 'TAVILY_API_KEY'

/** Tavily's own latency/cost knob: `basic` costs one credit, `advanced` two. */
const DEFAULT_SEARCH_DEPTH = 'basic'

/** Tavily rejects `max_results` above this. */
const TAVILY_MAX_RESULTS = 20

/** Asked-for result count when the caller sets none. */
const FALLBACK_MAX_RESULTS = 8

/** Stable id this provider registers under; `web.searchProvider` names it. */
const TAVILY_PROVIDER_ID = 'tavily'

/**
 * A provider failure carrying a machine-routable `code`.
 *
 * The seam's own `WebError` class is not importable from a profile-local plugin
 * (see the module note), so this mirrors its observable shape — `name` plus an
 * open string `code` — and callers that route on `code` keep working. Consumers
 * must tolerate provider-specific codes by design.
 */
class TavilyWebError extends Error {
	/**
	 * @param message - the operator-facing diagnostic.
	 * @param code - the stable failure code.
	 * @param options - forwarded to `Error`, so `cause` survives.
	 */
	constructor(message, code, options) {
		super(message, options)
		this.name = 'WebError'
		this.code = code
	}
}

/** Unwrap a schemastery section field, leaving a plain config value alone. */
function readOption(value) {
	if (value !== null && typeof value === 'object' && typeof value.get === 'function') return value.get()
	return value
}

/** A usable non-empty string, or `undefined`. */
function optionalString(value) {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Clamp the requested result count into what Tavily accepts. */
function clampMaxResults(value) {
	if (!Number.isInteger(value) || value <= 0) return FALLBACK_MAX_RESULTS
	return Math.min(value, TAVILY_MAX_RESULTS)
}

/** Build the provider's cancellation error while retaining the caller's reason. */
function searchAborted(signal) {
	return new TavilyWebError('Tavily search aborted', 'WEB_ABORTED', {
		cause: signal?.aborted === true ? signal.reason : undefined
	})
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal) {
	if (signal?.aborted === true) throw searchAborted(signal)
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error) {
	return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Map a Tavily search response onto the seam's normalized result.
 *
 * Tavily's `content` field is already a snippet, and its `published_date` is
 * already an opaque date string, so the mapping is a straight rename. Sources
 * are deduped by `url` because Tavily can repeat a URL across a merged result
 * set. `truncated` stays `false`: the seam owns `maxResults` and sets the flag
 * itself if this provider over-returns.
 *
 * @param payload - the parsed Tavily response body.
 * @returns the normalized search result.
 */
function mapTavilyResponse(payload) {
	const results = Array.isArray(payload?.results) ? payload.results : []
	const seen = new Set()
	const sources = []
	for (const item of results) {
		const url = optionalString(item?.url)
		if (url === undefined || seen.has(url)) continue
		seen.add(url)
		const title = optionalString(item?.title)
		const snippet = optionalString(item?.content)
		const publishedAt = optionalString(item?.published_date)
		sources.push({
			url,
			...title === undefined ? {} : { title },
			...snippet === undefined ? {} : { snippet },
			...publishedAt === undefined ? {} : { publishedAt }
		})
	}
	const answer = optionalString(payload?.answer)
	return {
		sources,
		truncated: false,
		...answer === undefined ? {} : { content: answer }
	}
}

/** Read a response body as text without letting a stream error mask the status. */
async function safeText(response) {
	try {
		return (await response.text()).slice(0, 400)
	} catch {
		return ''
	}
}

/**
 * The Tavily-backed search provider.
 *
 * `available()` is the seam's cheap, network-free usability probe. It reports
 * whether a credential *route* is configured rather than whether the key
 * currently resolves, because credential resolution is asynchronous and
 * `available()` may not be. A missing or rejected key therefore surfaces as a
 * named provider error from `search()` instead of as an unavailable backend.
 */
class TavilySearchProvider {
	/**
	 * @param resolveOptions - reads one authoritative options snapshot per call.
	 */
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions
	}

	/** The registry key the seam selects this provider by. */
	get id() {
		return TAVILY_PROVIDER_ID
	}

	/** Whether a credential route is configured; never touches the network. */
	available() {
		const options = this.resolveOptions()
		return options.apiKey !== undefined || options.resolveApiKey !== undefined
	}

	/**
	 * Run one Tavily search.
	 *
	 * @param request - the seam's request; only `query` and `maxResults` exist.
	 * @param signal - optional cancellation signal forwarded to `fetch`.
	 * @returns the normalized, seam-shaped search result.
	 * @throws {TavilyWebError} on cancellation, a missing key, a non-2xx status,
	 *   an unreadable body, or a transport failure.
	 */
	async search(request, signal) {
		const options = this.resolveOptions()
		throwIfSearchAborted(signal)
		const apiKey = options.apiKey ?? await options.resolveApiKey?.()
		if (apiKey === undefined) {
			throw new TavilyWebError(
				`Tavily search has no API key for "${options.apiKeyEnv}"; store it through the credentials service, export it in the launching environment, or set a literal "apiKey" in the web-search-tavily config`,
				'WEB_PROVIDER_CREDENTIAL_MISSING'
			)
		}
		const body = JSON.stringify({
			query: request.query,
			max_results: clampMaxResults(request.maxResults),
			search_depth: options.searchDepth,
			include_answer: false,
			include_raw_content: false
		})
		let response
		try {
			response = await fetch(options.endpoint, {
				method: 'POST',
				headers: {
					accept: 'application/json',
					authorization: `Bearer ${apiKey}`,
					'content-type': 'application/json'
				},
				body,
				...signal === undefined ? {} : { signal }
			})
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal)
			throw new TavilyWebError(
				`Tavily search request to ${JSON.stringify(options.endpoint)} failed: ${String(error)}`,
				'WEB_PROVIDER_ERROR',
				{ cause: error }
			)
		}
		if (!response.ok) {
			const detail = await safeText(response)
			const hint = response.status === 401 || response.status === 403
				? ` — the "${options.apiKeyEnv}" credential was rejected`
				: response.status === 429 ? ' — Tavily rate limit reached' : ''
			throw new TavilyWebError(
				`Tavily search failed with HTTP ${response.status}${hint}${detail.length === 0 ? '' : `: ${detail}`}`,
				'WEB_PROVIDER_ERROR'
			)
		}
		try {
			return mapTavilyResponse(await response.json())
		} catch (error) {
			throw new TavilyWebError(
				`Tavily returned an unprocessable response body: ${String(error)}`,
				'WEB_PROVIDER_ERROR',
				{ cause: error }
			)
		}
	}
}

/**
 * Register the Tavily search provider with `ctx.web`.
 *
 * @param ctx - plugin context; `web` is injected, `credentials` is optional.
 * @param config - the loader row's config, plain or schemastery-backed.
 */
export function apply(ctx, config = {}) {
	const resolveOptions = () => {
		const apiKeyEnv = optionalString(readOption(config.apiKeyEnv)) ?? DEFAULT_API_KEY_ENV
		const literalApiKey = optionalString(readOption(config.apiKey))
		return {
			...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
			resolveApiKey: async () => {
				const credentials = ctx.get('credentials')
				if (credentials !== undefined) {
					const resolved = await credentials.resolve(apiKeyEnv)
					const value = optionalString(resolved?.value)
					if (value !== undefined) return value
				}
				return optionalString(process.env[apiKeyEnv])
			},
			apiKeyEnv,
			endpoint: optionalString(readOption(config.endpoint)) ?? DEFAULT_ENDPOINT,
			searchDepth: optionalString(readOption(config.searchDepth)) ?? DEFAULT_SEARCH_DEPTH
		}
	}
	ctx.web.registerSearchProvider(new TavilySearchProvider(resolveOptions))
}
