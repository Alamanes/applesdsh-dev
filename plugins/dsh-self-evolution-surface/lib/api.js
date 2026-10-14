/**
 * The host routes the panel reads.
 *
 * Read-only by design. Every state change goes through the tool or the command
 * family, which records a verdict and a log line; a browser page that could
 * also promote a candidate would be a second, unaudited door into the same
 * decision.
 *
 * @module dsh-self-evolution-surface/lib/api
 */

/** Route prefix for every endpoint this plugin serves. */
export const ROUTE_PREFIX = '/api/self-evolution'

/**
 * Mount the routes on a context that provides `connection`.
 *
 * @param options - the wiring inputs.
 * @param options.routeCtx - the context carrying `connection`.
 * @param options.evolve - the flow facade.
 * @returns whether the routes were registered.
 */
export function mountRoutes({ routeCtx, evolve }) {
  const fetch = routeCtx.connection?.fetch
  if (fetch === undefined || typeof fetch.register !== 'function') return false

  const json = (value) => Response.json(value, { headers: { 'cache-control': 'no-store' } })

  fetch.register({
    path: `${ROUTE_PREFIX}/overview`,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try {
        return json(evolve.overview())
      } catch (error) {
        return json({ error: String(error?.message ?? error).slice(0, 300) })
      }
    },
  })

  fetch.register({
    path: `${ROUTE_PREFIX}/brief`,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try {
        return json({ brief: await evolve.brief() })
      } catch (error) {
        return json({ error: String(error?.message ?? error).slice(0, 300) })
      }
    },
  })

  return true
}
