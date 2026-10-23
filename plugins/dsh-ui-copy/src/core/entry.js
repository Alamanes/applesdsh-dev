/**
 * dsh-ui-copy browser entry — the loader wrapper for the copy component.
 *
 * Appended last by `scripts/build.mjs`, after the runtime and the component.
 * This package is one component: the bundle `dsh-ui-suite` pulls it in beside
 * the other thirteen, and each of them is its own row in the plugin page.
 */

window.__ModuleLoader__.load({
  // The boot-graph row id is the package name; client-modules serves this file
  // at `/plugins/<包名>/client.js` and keys the factory by the same string.
  id: 'dsh-ui-copy',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    /**
     * Mount the copy component on its own runtime.
     *
     * The host half injects this row's configuration as `window.DSHUI_COPY`
     * before the boot graph runs, because a boot-graph row arrives as
     * `{ id, url, rev }` and `apply(ctx, config)` always sees an empty config.
     */
    function apply(ctx) {
      const injected = window.DSHUI_COPY
      const config = typeof injected === 'object' && injected !== null ? injected : {}
      const runtime = dshuiCreateRuntime({ ctx, require }, { copy: config })
      runtime.mount('copy', dshuiComponent_copy)
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
