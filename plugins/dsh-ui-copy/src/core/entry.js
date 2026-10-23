/**
 * dsh-ui-copy browser entry — the loader wrapper and the component registry.
 *
 * Appended last by `scripts/build.mjs`, after the runtime and every component.
 * The placeholder below is replaced with one `[key, factory]` row per file in
 * `src/components/`, in filename order, so that order is the mount order.
 *
 * Loader facts this file depends on, all observed in the shipped client:
 *
 *   - the row id is the package name (`dsh-ui-copy`), because client-modules
 *     serves this file at `/plugins/<包名>/client.js` and keys the factory by
 *     that same string; the profile row's `id` (`ui-copy`) only names the row;
 *   - `apply(ctx, config)` receives only `{ name: id }` as config, so the real
 *     configuration arrives through `globalThis.DSHUI_CONFIG`, injected by the
 *     host half's `<head>` tap;
 *   - `exports.inject` lists client *services* to wait for; interaction with a
 *     service a component needs is done per component (`ctx.inject(...)`), so
 *     this list stays empty and a missing service disables one component only.
 *
 * Component table:
 *
 * __COMPONENT_TABLE__
 */

window.__ModuleLoader__.load({
  // The boot-graph row id is the package name: client-modules serves this file
  // at `/plugins/<包名>/client.js` and keys the factory by the same string.
  id: 'dsh-ui-copy',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    /**
     * The registry. Keys are the config field names the host half declares, so
     * `ui-copy.config.<key>.enabled` switches exactly one row here.
     */
    const COMPONENTS = [
      __COMPONENTS__
    ]

    /**
     * Mount every enabled component on the shared runtime.
     *
     * A component factory runs inside the runtime's failure boundary, so a host
     * upgrade that drops a slot or an external bundle that is no longer in the
     * boot graph disables that one component and leaves the rest running.
     *
     * @param ctx - client root context.
     */
    function apply(ctx) {
      const config = typeof window.DSHUI_CONFIG === 'object' && window.DSHUI_CONFIG !== null
        ? window.DSHUI_CONFIG
        : {}
      const runtime = dshuiCreateRuntime({ ctx, require }, config)

      for (const [key, factory] of COMPONENTS) {
        runtime.mount(key, factory)
      }

      exports.runtime = runtime
      return function dispose() {
        runtime.dispose()
      }
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
