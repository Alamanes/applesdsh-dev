import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
/**
 * dsh-ui-copy host half — whale.
 *
 * Migrated from `dsh-plugin-harness-whale`. The standalone host half was one
 * esbuild bundle that also carried an inlined schemastery (the package shipped
 * its build output, not its source), and its real duty was a single route:
 *
 *   GET|HEAD /_plugins/harness-whale/config
 *     the resolved wallpaper configuration as JSON, `no-store`, `nosniff`,
 *     405 (with `Allow: GET, HEAD`) for anything else.
 *
 * Nothing else was registered: the wallpaper's points, shaders, canvas and
 * layer are all built by the browser half, and no asset or static directory is
 * served from this package. So the host half's whole job is that config
 * endpoint, and the inlined schemastery is configuration declaration only —
 * it is re-declared in `lib/index.js` with the suite's `Schema`, and the
 * bundled copy is not carried over.
 *
 * In the suite the same endpoint is served under the suite namespace and the
 * old path stays as an alias, so a page still running the pre-suite browser
 * bundle keeps working for one release:
 *
 *   GET|HEAD /dsh-ui-copy/whale/config        (browser half's route)
 *   GET|HEAD /_plugins/harness-whale/config   (alias)
 *
 * The browser half also receives the same block through
 * `window.__DSHUI_CONFIG__.whale`, so a composition without a web server still
 * paints the wallpaper with the profile's values.
 *
 * @module dsh-ui-copy/host/whale
 */

/** Config field in the suite's schema this host half answers to. */
export const CONFIG_KEY = 'whale'

/** Package root, for the bundled token sheet. */
const LIB = fileURLToPath(new URL('./', import.meta.url))

/** Route base; the browser component hard-codes the same config path. */
const ROUTE_BASE = '/dsh-ui-copy/whale'

/** Wallpaper configuration endpoint. */
const CONFIG_ROUTE = `${ROUTE_BASE}/config`

/** Pre-suite endpoint, still served as an alias for a page running the old bundle. */
const LEGACY_CONFIG_ROUTE = '/_plugins/harness-whale/config'

/**
 * Answer one request with the configuration payload.
 *
 * The payload is serialized once per apply: it is the profile's config block,
 * and a profile edit restarts the plugin row anyway, so there is nothing to
 * re-read per request.
 *
 * @param payload - the serialized configuration.
 * @returns the route handler.
 */
function configHandler(payload) {
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end('method not allowed')
      return
    }
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(req.method === 'HEAD' ? undefined : payload)
  }
}

/**
 * Mount the config endpoint and its alias.
 *
 * `webServer` is injected locally rather than declared on the plugin, so this
 * host half still applies in a composition without a web server: the wallpaper
 * then reads the injected config block and no route is served.
 *
 * @param ctx - host plugin context.
 * @param config - the `ui-copy.whale` block, already narrowed by `lib/index.js`.
 */
function applyComponent(ctx, config = {}) {
  const payload = JSON.stringify(config !== null && typeof config === 'object' ? config : {})
  ctx.inject(['webServer'], (web) => {
    const handler = configHandler(payload)
    web.effect(() => web.webServer.register({ kind: 'exact', path: CONFIG_ROUTE, handler }))
    // The alias stays one release: a browser half still built against the old
    // package asks for its own path instead of falling back to the defaults.
    web.effect(() => web.webServer.register({ kind: 'exact', path: LEGACY_CONFIG_ROUTE, handler }))
    web.logger?.info?.(`ui-copy/whale: serving ${CONFIG_ROUTE} (alias ${LEGACY_CONFIG_ROUTE})`)
  })
}

/* ---- suite row plumbing ---------------------------------------------- */

/**
 * Hand this package's configuration to its browser half and put the token layer
 * on the page.
 *
 * A boot-graph row arrives as `{ id, url, rev }` and `apply(ctx, config)`
 * always sees an empty config, so the row's configuration has to travel through
 * the page: a `global` injection row carries it, and the browser half reads
 * `window.DSHUI_WHALE`. The token sheet rides along so this package works when
 * it is installed on its own, without the bundle.
 */
function injectSuiteRow(ctx, config) {
  const value = config !== null && typeof config === 'object' ? config : {}
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: 'DSHUI_WHALE', value })
    let tokens = null
    try {
      tokens = readFileSync(LIB + 'styles/tokens.css', 'utf8')
    } catch {
      tokens = null
    }
    if (tokens !== null) table.push({ kind: 'style', text: tokens })
  })
}

/** Cordis entry: the suite row plumbing, then this package's own host body. */
export function apply(ctx, config) {
  injectSuiteRow(ctx, config)
  return applyComponent(ctx, config)
}
