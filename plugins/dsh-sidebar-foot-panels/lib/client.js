/**
 * dsh-sidebar-foot-panels — browser half.
 *
 * Moves the two global panels out of the sidebar's panel list and onto the
 * sidebar foot, as two compact icon buttons:
 *
 *   - the shipped rows stay where React drew them; the plugin only hides them,
 *     marking the matching `<button>` in `nav.panelList` with
 *     `data-dsh-foot-panels-hidden`. The list stops occupying the column once
 *     every row in it is one of ours (its own rule marks it too), so the top of
 *     the sidebar is New Session and the session list alone;
 *   - the entry points are registered as a real `sidebar.footer.action` entry —
 *     the slot ui-sidebar declares as "optional actions beside Settings at the
 *     sidebar foot" — and drawn by the sidebar itself, so they inherit the
 *     column state (`wide`, i.e. wide row versus 56px rail), the foot's own
 *     alignment and the shipped hover/focus tokens.
 *
 * A click goes through `ctx.layout.selectPanel(id)`, the controller call the
 * shipped row makes, so panel switching keeps the persisted selection, the
 * pending-navigation abort and the main-panel guard unchanged. The active state
 * is read from `ctx.layout.panelInfo`, the same selection source that marks the
 * shipped row with `aria-current`.
 *
 * Why the list is DOM work and the buttons are a slot:
 *
 *   - The panel list is owned by ui-sidebar: it draws one row per
 *     `sidebar.panellist` registration and owns the button. A plugin can add
 *     entries to that slot, and it can take over a cell by reusing a shipped id,
 *     but it cannot withdraw another plugin's registration, and occupying a cell
 *     would still leave a row in the list. So the rows are hidden where they
 *     land.
 *   - The marks are re-applied from a rAF-throttled MutationObserver, because
 *     React rebuilds a row on structural changes. Only an attribute React never
 *     renders is written: `className`, `aria-label`, `aria-current` and the click
 *     handler stay the shipped ones, so keyboard order and accessibility of the
 *     hidden rows are untouched if the plugin is removed.
 *
 * The buttons follow the panel ledger: a panel whose plugin is disabled
 * disappears from the foot as well, and the wrapper renders nothing when neither
 * panel is offered.
 *
 * @module dsh-sidebar-foot-panels/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-sidebar-foot-panels',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    /** Locale namespace for the two button labels; also the footer entry's `locale`. */
    const NS = 'sidebar-foot-panels'

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      plugins: '插件',
      schedules: '自动化任务',
    }

    /** English dictionary, checked complete against the zh key set. */
    const en = {
      plugins: 'Plugins',
      schedules: 'Automation tasks',
    }

    /** ui-sidebar's list of global panel rows. */
    const PANELLIST_SLOT = 'sidebar.panellist'

    /** ui-sidebar's list of optional actions beside Settings. */
    const FOOTER_SLOT = 'sidebar.footer.action'

    /** The shipped panel list: the `nav` whose CSS-module class carries this suffix. */
    const PANEL_LIST_SELECTOR = 'nav[class*="panelList"]'

    /**
     * Mark written on a shipped panel row — and on the list itself once every row
     * in it is ours — so the plugin's stylesheet can take it out of flow.
     *
     * An attribute rather than a class: React rewrites `className` on its own
     * re-renders, while an attribute it does not render survives every update of
     * the element it was set on.
     */
    const HIDDEN_ATTR = 'data-dsh-foot-panels-hidden'

    /**
     * The panels this plugin relocates, in the order the buttons appear.
     *
     * `id` is the `sidebar.panellist` cell key, which is also the `main` slot key
     * the panel page renders under, which is also what `ctx.layout.selectPanel`
     * takes. `copy` names the label key in this plugin's dictionary. `Icon` is the
     * shipped glyph shape, inlined because the two panel packages export neither
     * their icon components nor their own panel ids.
     */
    const PANELS = [
      { id: 'plugins', copy: 'plugins', Icon: PinwheelIcon },
      { id: 'schedules', copy: 'schedules', Icon: ClockIcon },
    ]

    /** The cell keys this plugin claims, as a lookup for the ledger scan. */
    const PANEL_IDS = new Set(PANELS.map((panel) => panel.id))

    /** The primitives tooltip, when this build still exports one. */
    const Tooltip = primitives.Tooltip

    /**
     * The plugin's stylesheet.
     *
     * The hidden-row rule is the whole point of the sheet; the button rules reuse
     * the shipped `iconButton` geometry and tokens so the pair reads as part of
     * the foot rather than as a new control family.
     */
    const STYLESHEET = `
[${HIDDEN_ATTR}] { display: none !important; }
.dsh-fp-actions {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  padding: 0 2px;
}
.dsh-fp-button {
  box-sizing: border-box;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: none;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font: inherit;
}
.dsh-fp-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-fp-button[data-active='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-fp-button:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dsh-fp-button[data-rail='true'] {
  width: 36px;
  height: 36px;
  border-radius: var(--dsw-radius-md);
}
.dsh-fp-glyph { display: inline-flex; align-items: center; justify-content: center; }
`

    /**
     * The pinwheel client-ui-plugin-manager draws for its panel row.
     *
     * @param props - `size` in pixels.
     * @returns the glyph.
     */
    function PinwheelIcon({ size = 16 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          strokeWidth: 1,
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
        },
        h('path', { key: 'w', d: 'M7.84457 5.06199C11.6605 4.93876 14.7962 6.14848 14.8484 7.76397C14.8875 8.97461 13.1838 10.0696 10.7215 10.5942', stroke: 'currentColor' }),
        h('path', { key: 'n', d: 'M5.12742 8.07731C5.00419 4.26138 6.21391 1.12568 7.8294 1.07351C9.04004 1.03441 10.135 2.73808 10.6596 5.20037', stroke: 'currentColor' }),
        h('path', { key: 'e', d: 'M8.02457 10.6802C4.20865 10.8034 1.07294 9.5937 1.02077 7.97821C0.981678 6.76758 2.68535 5.67262 5.14763 5.14798', stroke: 'currentColor' }),
        h('path', { key: 's', d: 'M10.7476 7.89535C10.8708 11.7113 9.66109 14.847 8.0456 14.8991C6.83496 14.9382 5.74 13.2346 5.21536 10.7723', stroke: 'currentColor' }),
      )
    }

    /**
     * The clock client-ui-schedule draws for its panel row.
     *
     * @param props - `size` in pixels.
     * @returns the glyph.
     */
    function ClockIcon({ size = 16 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          strokeWidth: 1,
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
        },
        h('path', { key: 'face', d: 'M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14Z', stroke: 'currentColor' }),
        h('path', { key: 'hands', d: 'M8 4.31V8.46L11 10.08', stroke: 'currentColor' }),
      )
    }

    /**
     * The panels currently offered by the sidebar, as `{ id, copy, Icon }`.
     *
     * Read back from the `sidebar.panellist` ledger on every change, so a panel
     * whose plugin is disabled loses its button instead of leaving a dead one.
     */
    let offered = []

    /** Cells currently watching {@link offered}. */
    const offeredListeners = new Set()

    /**
     * Replace the offered list when it really changed.
     *
     * Identity is the id sequence: `useSyncExternalStore` compares snapshots by
     * reference, and a rebuilt list with the same ids must not re-render.
     *
     * @param next - the next list.
     */
    function setOffered(next) {
      const same = next.length === offered.length && next.every((panel, index) => panel.id === offered[index].id)
      if (same) return
      offered = next
      for (const listener of [...offeredListeners]) listener()
    }

    /**
     * Subscribe one component to the offered list.
     *
     * @param listener - change callback.
     * @returns the unsubscribe.
     */
    function subscribeOffered(listener) {
      offeredListeners.add(listener)
      return () => {
        offeredListeners.delete(listener)
      }
    }

    /**
     * Read the offered list from React.
     *
     * @returns the current list.
     */
    function useOfferedPanels() {
      return React.useSyncExternalStore(subscribeOffered, () => offered)
    }

    /**
     * Wrap ui-layout's selection source as a hook.
     *
     * `ctx.layout.panelInfo` is the layout store's `panelInfo` slice: its
     * `getSnapshot` hands back the very object the root store renders the shipped
     * rows from, so a button highlights exactly when its row would have.
     *
     * @param layout - the injected `ctx.layout` service.
     * @returns a hook returning the active panel id, or null for the conversation.
     */
    function activePanelHook(layout) {
      const subscribe = (listener) => layout.panelInfo.subscribe(listener)
      const getSnapshot = () => layout.panelInfo.getSnapshot().activePanelId
      return () => React.useSyncExternalStore(subscribe, getSnapshot)
    }

    /**
     * One foot button.
     *
     * @param props - the panel spec, its selection state, the column state, the
     *   injected `selectPanel` and the bound translator.
     * @returns the button, wrapped in the shipped tooltip when it is available.
     */
    function FootPanelButton({ panel, active, rail, selectPanel, t }) {
      const label = t(panel.copy)
      const button = h(
        'button',
        {
          type: 'button',
          className: 'dsh-fp-button',
          'data-active': active ? 'true' : undefined,
          'data-rail': rail ? 'true' : undefined,
          'aria-label': label,
          'aria-current': active ? 'page' : undefined,
          title: typeof Tooltip === 'function' ? undefined : label,
          onClick: () => selectPanel(panel.id),
        },
        h('span', { className: 'dsh-fp-glyph', 'aria-hidden': 'true' }, h(panel.Icon, { size: rail ? 18 : 16 })),
      )
      if (typeof Tooltip !== 'function') return button
      return h(Tooltip, { label, delayMs: 500 }, button)
    }

    /**
     * The foot group.
     *
     * @param props - the sidebar's owner share (`wide`), the injected selection
     *   helpers, and the bound translator.
     * @returns the group, or null while neither panel is offered.
     */
    function FootPanels({ wide, selectPanel, useActivePanelId, t }) {
      const panels = useOfferedPanels()
      const activeId = useActivePanelId()
      if (panels.length === 0) return null
      return h(
        'div',
        { className: 'dsh-fp-actions' },
        panels.map((panel) =>
          h(FootPanelButton, {
            key: panel.id,
            panel,
            active: activeId === panel.id,
            rail: !wide,
            selectPanel,
            t,
          }),
        ),
      )
    }

    /**
     * Install the stylesheet, the observer and the footer entry.
     *
     * @param ctx - client root context.
     * @returns the disposer that takes all three back out.
     */
    function mount(ctx) {
      /** Row positions in `nav.panelList` this plugin hides; rebuilt with the ledger. */
      let hiddenRows = []

      const style = document.createElement('style')
      style.setAttribute('data-dsh-sidebar-foot-panels', '')
      style.textContent = STYLESHEET
      document.head.appendChild(style)

      /**
       * Re-read the panel ledger: which rows to hide, and which buttons to offer.
       *
       * The order is ui-sidebar's own — `entriesOfSlot` winners by `order`, the
       * same list it maps to rows — so a hidden position and the row React drew
       * there are the same row.
       */
      const reindex = () => {
        const ids = ctx.slots
          .entriesOfSlot(PANELLIST_SLOT)
          .map((entry) => ({ id: entry.options.id, order: entry.options.order ?? 0 }))
          .sort((a, b) => a.order - b.order)
          .map((row) => row.id)
        hiddenRows = ids.flatMap((id, index) => (PANEL_IDS.has(id) ? [index] : []))
        setOffered(PANELS.filter((panel) => ids.includes(panel.id)))
      }

      /**
       * Mark the rows at {@link hiddenRows}, and the list itself once every row in
       * it is ours so its margin does not survive as an empty gap.
       *
       * Descendant buttons rather than direct children: the shipped row wraps its
       * button in a tooltip, and a build that anchors the tooltip with an element
       * of its own still leaves exactly one button per row. Every row not at a
       * hidden position is unmarked, which is what keeps the plugin honest after a
       * third panel is registered.
       */
      const paint = () => {
        const list = document.querySelector(PANEL_LIST_SELECTOR)
        if (list === null) return
        const rows = list.querySelectorAll('button')
        let visible = 0
        rows.forEach((row, index) => {
          if (hiddenRows.includes(index)) row.setAttribute(HIDDEN_ATTR, '')
          else {
            row.removeAttribute(HIDDEN_ATTR)
            visible += 1
          }
        })
        if (rows.length > 0 && visible === 0) list.setAttribute(HIDDEN_ATTR, '')
        else list.removeAttribute(HIDDEN_ATTR)
      }

      let frame = 0

      /** Re-paint on the next frame; one pass per frame however many mutations land. */
      const schedule = () => {
        if (frame !== 0) return
        frame = requestAnimationFrame(() => {
          frame = 0
          paint()
        })
      }

      const observer = new MutationObserver(schedule)
      observer.observe(document.body, { childList: true, subtree: true })

      const sync = () => {
        reindex()
        paint()
      }

      const offLedger = ctx.slots.subscribe(PANELLIST_SLOT, sync)
      ctx.slots.inject(FOOTER_SLOT, () =>
        ctx.slots.register(
          {
            name: FOOTER_SLOT,
            id: 'foot-panels',
            order: 10,
            locale: NS,
            inject: () => ({
              selectPanel: (id) => ctx.layout.selectPanel(id),
              useActivePanelId: activePanelHook(ctx.layout),
            }),
          },
          FootPanels,
        ),
      )

      sync()

      return () => {
        observer.disconnect()
        if (frame !== 0) cancelAnimationFrame(frame)
        offLedger()
        style.remove()
        setOffered([])
        for (const marked of document.querySelectorAll(`[${HIDDEN_ATTR}]`)) marked.removeAttribute(HIDDEN_ATTR)
      }
    }

    /**
     * Client plugin body: dictionaries first, then the page-side mount. The mount
     * waits for `body` because the observer it installs watches it.
     *
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'sidebar-foot-panels: dictionaries')
      if (document.body !== null) ctx.effect(() => mount(ctx), 'sidebar-foot-panels: foot group')
      else document.addEventListener('DOMContentLoaded', () => ctx.effect(() => mount(ctx), 'sidebar-foot-panels: foot group'), { once: true })
    }

    exports.apply = apply
    exports.inject = ['slots', 'layout', 'locale']
    return module.exports
  },
})
