/**
 * Browser half: a "插件" row in the sidebar nav (directly below 新会话, like
 * ChatGPT's Plugins entry), plus the rotating hero taglines.
 *
 * Hand-written in the loader's own bundle format (`window.__ModuleLoader__.load`
 * plus a CommonJS-style `require` for shared modules) rather than compiled from
 * TypeScript, so the package needs no build step.
 *
 * Elements must be built through `react/jsx-runtime`. A bare `{ type, props }`
 * literal is not a React element: React rejects it as a child with minified
 * error #31.
 *
 * Placement: the shell renders `sidebar.panellist` rows right after the
 * 新会话 button. A panel row normally selects a main-area panel registered
 * under the same id (selecting a missing one throws), so the row's click is
 * intercepted in the capture phase and routed to Settings's 插件 section
 * instead — no main panel is registered, and `selectPanel` never runs.
 *
 * Reaching a specific Settings section from outside is otherwise impossible:
 * `ui-settings-general` keeps both the open flag and the active section in
 * component-local state (see its `shell-contract.ts`), so the only way in is
 * activating the trigger, then the section's nav item.
 */

const SETTINGS_SLOT = '[data-slot="sidebar.settings"]'
// Same string today, but two different roles: the row's accessible label vs
// the Settings nav item this row routes to. Kept separate so they can diverge.
const ROW_LABEL = '插件'
const SECTION_LABEL = '插件'

/** Open Settings, then its 插件 section (polls for the dialog's nav item). */
function openPluginsSection() {
  const trigger = document.querySelector(`${SETTINGS_SLOT} button`)
  if (!(trigger instanceof HTMLElement)) return
  trigger.click()
  const deadline = Date.now() + 2000
  const tick = () => {
    const dialog = document.querySelector('[role="dialog"]')
    const item = dialog && [...dialog.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === SECTION_LABEL)
    if (item instanceof HTMLElement) { item.click(); return }
    if (Date.now() < deadline) window.setTimeout(tick, 80)
  }
  window.setTimeout(tick, 100)
}

/** Route clicks on the 插件 panel row to the Settings section (capture phase:
 *  runs before React's delegated listener, so `selectPanel` never fires).
 *  Scope: a nav button labelled 插件 — the slot wrapper lives INSIDE the row
 *  button, so `[data-slot=…] button` cannot match from the event target. */
function interceptRowClicks() {
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return
    const row = event.target.closest(`nav button[aria-label="${ROW_LABEL}"]`)
    if (!row) return
    event.preventDefault()
    event.stopImmediatePropagation()
    openPluginsSection()
  }, { capture: true })
}

/**
 * Rotating hero taglines. The harness ships a fixed heading (探索未至之境);
 * we swap its first span for a rotating line à la Codex. The 预览版 badge in
 * the same `titleGroup` is left untouched. React owns the text, so swaps are
 * applied through a MutationObserver and re-applied whenever React rewrites
 * the node (e.g. on every return to the empty state, which is when a new line
 * gets picked).
 */
const TAGLINES = [
  '今天我们要构建什么？',
  '接下来做什么？',
  '今天写点什么？',
  '有什么想实现的吗？',
  '从一句描述开始。',
  '准备好动手了吗？',
]

let lastTagline = null

/** Swap the hero heading for a random tagline (never the same one twice). */
function rotateTagline() {
  const group = document.querySelector('[class$=_titleGroup]')
  const label = group && group.querySelector('span:first-child')
  if (!label || label.textContent === lastTagline) return
  const pool = TAGLINES.filter((t) => t !== lastTagline)
  const next = pool[Math.floor(Math.random() * pool.length)]
  label.textContent = next
  lastTagline = next
}

/** Keep applying the rotator across React re-renders (rAF-throttled: the body
  * observer is chatty during streaming responses). */
function startTaglines() {
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      rotateTagline()
    })
  }
  schedule()
  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  })
}

window.__ModuleLoader__.load({
  id: 'dsh-codex-sidebar',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const { jsx } = require('react/jsx-runtime')

    /**
     * Codex's Plugins glyph: an at-sign inside a ring.
     *
     * The panel row's glyph. The shell hands it `{ size, active }` and draws
     * the row chrome (label, selected state) itself. The shell passes 16 in
     * wide mode but draws the 新会话 icon at 14 — clamping keeps the two rows'
     * glyphs optically identical (collapsed rail's 18 is kept).
     */
    function PluginsIcon(props) {
      const size = props && props.size !== undefined ? props.size : 16
      const drawn = size === 16 ? 14 : size
      return jsx('svg', {
        width: drawn,
        height: drawn,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        'aria-hidden': true,
        children: [
          jsx('circle', { cx: 8, cy: 8, r: 6.1 }, 'ring'),
          jsx('circle', { cx: 8, cy: 8, r: 2.1 }, 'core'),
          jsx('path', { d: 'M10.1 8v2.3a1.35 1.35 0 0 0 2.7 0' }, 'tail'),
        ],
      }, 'icon')
    }

    /** Required services: the slot registry this row registers into. */
    const inject = ['slots']

    /**
     * Register the nav row and the click routing; start the tagline rotator.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'codex-plugins',
        order: 10,
        label: ROW_LABEL,
      }, PluginsIcon))
      interceptRowClicks()
      if (document.body) startTaglines()
      else document.addEventListener('DOMContentLoaded', startTaglines, { once: true })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
