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
export const KEY = 'whale'

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
export function apply(ctx, config = {}) {
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
