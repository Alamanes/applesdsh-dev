/**
 * dsh-ui-copy runtime — the one place where a component gets its services.
 *
 * The suite exists because a dozen UI plugins used to poll the same document
 * with a dozen MutationObservers, each injecting its own <style> and each
 * guessing whether the shipped DOM had already mounted. This runtime gives them
 * one observer, one frame budget, one style registry and one failure boundary:
 *
 *   - `observe(pass)` registers a DOM pass; every registered pass runs in a
 *     single rAF-throttled sweep, and one crashing pass never stops the rest.
 *   - `style(id, css)` registers a sheet by component id, so a sheet can be
 *     replaced without touching the DOM and no sheet is ever written twice.
 *   - `mount(key, factory)` calls a component factory under `try`/`catch`, so a
 *     host upgrade that removes a slot, or a disabled external bundle, disables
 *     one component instead of the whole suite.
 *   - `option(name, fallback)` reads the config the host half injected, which is
 *     the only channel a browser bundle has: a boot-graph row arrives as
 *     `{ id, url, rev }` and `apply(ctx, config)` always sees an empty config.
 *
 * Component contract — a component is a top-level function in the built bundle:
 *
 *     function dshuiComponent_<key>(rt) {
 *       if (rt.config.enabled === false) return
 *       ...
 *     }
 *
 * Components never touch `window.__ModuleLoader__`, never build their own
 * MutationObserver, and never write a literal colour, radius, gap, size,
 * duration or shadow: those live in `lib/styles/tokens.css` as `--dshui-*`.
 */

/**
 * Build the runtime handed to every component.
 *
 * @param env - `{ ctx, require }` from the bundle factory.
 * @param config - the host half's injected `window.__DSHUI_CONFIG__` object.
 */
function dshuiCreateRuntime(env, config) {
  var ctx = env.ctx
  var load = env.require
  // The token contract lives on `body` (see lib/styles/tokens.css), so a token
  // is read there rather than from the document root.
  var root = document.body !== null ? document.body : document.documentElement
  var suiteConfig = isRecord(config) ? config : {}

  /** Component state: key -> `{ enabled, options }`. */
  var components = Object.create(null)

  /** Every DOM pass registered by an enabled component. */
  var passes = []

  /** Owned cleanups, run by `dispose`. */
  var cleanups = []

  /** A frame has been requested but has not run yet. */
  var scheduled = false

  function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  function merge(base, over) {
    var out = {}
    var key
    for (key in base) if (Object.prototype.hasOwnProperty.call(base, key)) out[key] = base[key]
    for (key in over) if (Object.prototype.hasOwnProperty.call(over, key)) out[key] = over[key]
    return out
  }

  /**
   * A component key as the schema spells it: `session-delete` -> `sessionDelete`.
   *
   * Component ids stay hyphenated (they match `<nn>-<key>.js` and the sheet
   * names), while the host schema uses camelCase field names, so every lookup
   * tries both spellings rather than making each component remember which one
   * its block landed under.
   */
  function schemaKeyOf(key) {
    return String(key).replace(/-([a-z0-9])/g, function (_, letter) {
      return letter.toUpperCase()
    })
  }

  /**
   * The config block for one component.
   *
   * Accepts both shapes a config can arrive in — a flat `{ quota: { … } }` map
   * and the same value nested under `components` — and both spellings, because
   * the host half writes camelCase while components name themselves with
   * hyphens.
   */
  function componentConfig(key) {
    var names = [key, schemaKeyOf(key)]
    var found = null
    for (var index = 0; index < names.length; index += 1) {
      if (isRecord(suiteConfig[names[index]])) {
        found = suiteConfig[names[index]]
        break
      }
    }
    var nestedSource = isRecord(suiteConfig.components) ? suiteConfig.components : null
    var nested = null
    if (nestedSource !== null) {
      for (var position = 0; position < names.length; position += 1) {
        if (isRecord(nestedSource[names[position]])) {
          nested = nestedSource[names[position]]
          break
        }
      }
    }
    return merge(nested || {}, found || {})
  }

  function warn(key, message) {
    console.warn('[ui-copy/' + key + '] ' + message)
  }

  function fail(key, error) {
    console.error('[ui-copy/' + key + ']', error)
  }

  function request() {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(run)
  }

  function run() {
    scheduled = false
    if (document.body === null) return
    var snapshot = passes.slice()
    for (var index = 0; index < snapshot.length; index += 1) {
      var entry = snapshot[index]
      if (entry === undefined) continue
      try {
        entry.pass()
      } catch (error) {
        fail(entry.key, error)
        var position = passes.indexOf(entry)
        if (position !== -1) passes.splice(position, 1)
      }
    }
  }

  function sheetById(id) {
    return document.head.querySelector('style[data-dshui-sheet="' + String(id).replace(/["\\]/g, '\\$&') + '"]')
  }

  function installStyle(id, css) {
    var existing = sheetById(id)
    if (existing !== null) {
      existing.textContent = css
      return function () {
        if (existing.parentNode !== null) existing.parentNode.removeChild(existing)
      }
    }
    var style = document.createElement('style')
    style.setAttribute('data-dshui-sheet', id)
    style.textContent = css
    document.head.appendChild(style)
    return function () {
      if (style.parentNode !== null) style.parentNode.removeChild(style)
    }
  }

  function requireExternal(name) {
    try {
      return load(name)
    } catch (error) {
      fail('bundle', 'cannot load "' + name + '": ' + String((error && error.message) || error))
      return null
    }
  }

  /** The object handed to one component factory. */
  function componentApi(key, options) {
    return {
      /* ---- identity -------------------------------------------------- */
      key: key,
      ctx: ctx,
      suite: suiteConfig,

      /* ---- configuration --------------------------------------------- */
      /** This component's own block. `enabled` is already honoured by `mount`. */
      config: options,
      option: function (name, fallback) {
        var value = options[name]
        return value === undefined ? fallback : value
      },
      /** Another component's state, for components that depend on a sibling. */
      component: function (other) {
        return components[other] || { enabled: false, options: {} }
      },
      /** The current theme name, read from the same attribute the host themes on. */
      theme: function () {
        return document.body !== null && document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
      },

      /* ---- host services --------------------------------------------- */
      /** An external package, or `null` when it is not in this boot graph. */
      require: requireExternal,
      /** Run a host effect, or run the body directly when the seam is absent. */
      effect: function (body, label) {
        try {
          if (ctx && typeof ctx.effect === 'function') return ctx.effect(body, label || key)
        } catch (error) {
          fail(key, error)
          return undefined
        }
        try {
          return body()
        } catch (error) {
          fail(key, error)
          return undefined
        }
      },

      /* ---- document --------------------------------------------------- */
      /** Register a DOM pass; returns an unsubscribe function. */
      observe: function (pass) {
        var entry = { key: key, pass: pass }
        passes.push(entry)
        if (document.body !== null) request()
        return function () {
          var index = passes.indexOf(entry)
          if (index !== -1) passes.splice(index, 1)
        }
      },
      /** Ask for one sweep on the next frame. */
      schedule: request,
      /** Install or replace a sheet scoped to this component. */
      style: function (id, css) {
        return installStyle(key + '/' + id, css)
      },
      /** Current text of one of this component's sheets. */
      styleText: function (id) {
        var style = sheetById(key + '/' + id)
        return style === null ? '' : style.textContent
      },
      /** A token's computed value; components should prefer the CSS variable. */
      token: function (name, fallback) {
        try {
          var scope = document.body !== null ? document.body : root
          var value = getComputedStyle(scope).getPropertyValue(name).trim()
          if (value !== '') return value
        } catch (error) {
          fail(key, error)
        }
        return fallback === undefined ? '' : fallback
      },

      /* ---- diagnostics ------------------------------------------------ */
      log: function (message) {
        console.info('[ui-copy/' + key + '] ' + message)
      },
      warn: function (message) {
        warn(key, message)
      },
      error: function (error) {
        fail(key, error)
      },
    }
  }

  /**
   * Register a component and hand it the runtime.
   *
   * Enabled is the config's `enabled` when it is a boolean and `true` when the
   * profile says nothing, so a component that ships enabled keeps working after
   * an upgrade that adds a sibling and the user turns things off one by one.
   */
  function mount(key, factory) {
    var options = componentConfig(key)
    var record = {
      key: key,
      enabled: options.enabled === false ? false : true,
      options: options,
    }
    components[key] = record
    if (!record.enabled) return
    if (typeof factory !== 'function') {
      warn(key, 'no factory for this component')
      return
    }
    try {
      factory(componentApi(key, options))
    } catch (error) {
      record.enabled = false
      fail(key, error)
    }
  }

  var observer = null
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(request)
    var start = function () {
      if (document.body === null) return
      // No `attributes`: React churns attributes constantly, and a component
      // that writes an attribute from a pass would re-enter itself through the
      // observer. Every surface this suite patches is created or replaced as a
      // node, so childList plus characterData is the whole trigger set.
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      request()
    }
    if (document.body !== null) start()
    else document.addEventListener('DOMContentLoaded', start, { once: true })
    cleanups.push(function () {
      observer.disconnect()
    })
  }

  /** Remove every pass, sheet and observer this runtime owns. */
  function dispose() {
    passes.length = 0
    for (var index = 0; index < cleanups.length; index += 1) {
      try {
        cleanups[index]()
      } catch (error) {
        /* a failed cleanup must not stop the rest */
      }
    }
    cleanups.length = 0
  }

  var base = componentApi('runtime', {})
  return {
    ctx: ctx,
    config: suiteConfig,
    require: requireExternal,
    mount: mount,
    component: base.component,
    observe: base.observe,
    schedule: base.schedule,
    style: base.style,
    token: base.token,
    theme: base.theme,
    dispose: dispose,
  }
}
