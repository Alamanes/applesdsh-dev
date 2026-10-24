/**
 * dsh-user-memory browser half — the memory panel: the summary the model writes,
 * every entry, and one box that asks a question or changes memory.
 *
 * The bundle is hand-written classic script: the host serves it to
 * window.__ModuleLoader__, which calls the factory with a module resolver. It
 * registers a sidebar row and a main-slot page through ctx.slots, and talks to
 * its own host routes under api/dsh-user-memory.
 *
 * The routes are DOCUMENT-RELATIVE on purpose: the harness serves the GUI with
 * <base href="./">, so a root-absolute path escapes a sub-path deployment.
 */
window.__ModuleLoader__.load({
  id: 'dsh-user-memory',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'user-memory'
    const ROUTE = 'api/dsh-user-memory'
    const { useState, useEffect, useCallback, useRef } = React

    function call(path, options) {
      return fetch(ROUTE + path, {
        method: 'GET',
        headers: { 'content-type': 'application/json' },
        ...options,
      }).then((response) => response.json()).then((value) => {
        if (value === null || typeof value !== 'object' || value.ok !== true) throw new Error(value?.error ?? 'request failed')
        return value
      })
    }

    const CSS = `.dsum-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; max-height: 100%; overflow-y: auto; overscroll-behavior: contain; background: var(--dshui-surface-1); color: var(--dshui-text-primary); font-family: var(--dshui-font-family); }
.dsum-panel::-webkit-scrollbar { width: 10px; }
.dsum-panel::-webkit-scrollbar-track { background: transparent; }
.dsum-panel::-webkit-scrollbar-thumb { border: 3px solid transparent; border-radius: 999px; background-clip: content-box; background-color: var(--dshui-border-3); }
.dsum-panel::-webkit-scrollbar-thumb:hover { background-color: var(--dshui-border-4); }
.dsum-inner { flex: none; width: 100%; max-width: 720px; margin: 0 auto; padding: 40px 32px 120px; box-sizing: border-box; }
.dsum-head { display: flex; align-items: baseline; gap: 10px; }
.dsum-title { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; color: var(--dshui-text-primary); }
.dsum-sub { color: var(--dshui-text-tertiary); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.dsum-actions { display: flex; align-items: center; gap: 2px; margin-left: auto; }
.dsum-ghost { height: 26px; padding: 0 8px; border: none; border-radius: 6px; background: transparent; color: var(--dshui-text-tertiary); font-family: inherit; font-size: 12.5px; cursor: pointer; transition: color var(--dshui-duration-fast) var(--dshui-ease-standard), background var(--dshui-duration-fast) var(--dshui-ease-standard); }
.dsum-ghost:hover { color: var(--dshui-text-primary); background: var(--dshui-surface-hover); }
.dsum-ghost:disabled { opacity: 0.4; cursor: default; background: transparent; }
.dsum-divider { height: 1px; margin: 26px 0; background: var(--dshui-border-2); }
.dsum-sec { margin: 24px 0 10px; font-size: 15px; font-weight: 600; line-height: 1.4; color: var(--dshui-text-primary); }
.dsum-divider + .dsum-sec { margin-top: 0; }
.dsum-sep + .dsum-sec { margin-top: 20px; }
.dsum-body + .dsum-sec { margin-top: 24px; }
.dsum-body { margin: 0 0 16px; color: var(--dshui-text-secondary); font-size: 15px; line-height: 1.72; }
.dsum-body:last-of-type { margin-bottom: 0; }
.dsum-sep { height: 1px; margin: 36px 0 0; background: var(--dshui-border-2); }
.dsum-topic { margin: 24px 0 10px; color: var(--dshui-text-tertiary); font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.dsum-entry { position: relative; display: flex; align-items: flex-start; gap: 10px; margin: 0 0 14px; padding: 0 0 0 18px; }
.dsum-entry:last-child { margin-bottom: 0; }
.dsum-entry::before { content: ''; position: absolute; left: 4px; top: 10px; width: 4px; height: 4px; border-radius: 50%; background: var(--dshui-text-dimmed); }
.dsum-entry-text { flex: 1; min-width: 0; color: var(--dshui-text-secondary); font-size: 14px; line-height: 1.65; overflow-wrap: anywhere; }
.dsum-entry-meta { display: block; margin-top: 5px; color: var(--dshui-text-caption); font-size: 11.5px; line-height: 1.4; }
.dsum-remove { flex: none; width: 20px; height: 20px; margin-left: 2px; border: none; border-radius: 6px; background: transparent; color: var(--dshui-text-dimmed); font-size: 14px; line-height: 1; cursor: pointer; opacity: 0; transition: opacity var(--dshui-duration-fast) var(--dshui-ease-standard), color var(--dshui-duration-fast) var(--dshui-ease-standard); }
.dsum-entry:hover .dsum-remove, .dsum-remove:focus-visible { opacity: 1; }
.dsum-remove:hover { color: var(--dshui-danger); background: var(--dshui-surface-hover); }
.dsum-empty { padding: 32px 0; color: var(--dshui-text-tertiary); font-size: 14px; line-height: 1.7; }
.dsum-reply { margin: 28px 0 0; padding: 14px 16px; border-radius: 10px; background: var(--dshui-surface-1); color: var(--dshui-text-secondary); font-size: 14px; line-height: 1.7; white-space: pre-wrap; }
.dsum-error { margin: 16px 0 0; color: var(--dshui-danger); font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; }
.dsum-compose { position: sticky; bottom: 0; z-index: 2; flex: none; background: color-mix(in srgb, var(--dshui-surface-1) 72%, transparent); -webkit-backdrop-filter: blur(18px) saturate(1.1); backdrop-filter: blur(18px) saturate(1.1); }
.dsum-compose-inner { width: 100%; max-width: 720px; margin: 0 auto; padding: 8px 32px 24px; box-sizing: border-box; }
.dsum-compose::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 1px; background: transparent; pointer-events: none; }
.dsum-box { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; padding: 5px 5px 5px 18px; border: 1px solid var(--dshui-border-2); border-radius: 22px; background: var(--dshui-surface-1); box-shadow: 0 4px 18px rgba(0, 0, 0, 0.04); transition: border-color var(--dshui-duration-fast) var(--dshui-ease-standard), box-shadow var(--dshui-duration-fast) var(--dshui-ease-standard); }
.dsum-box:focus-within { border-color: var(--dshui-border-3); box-shadow: 0 6px 22px rgba(0, 0, 0, 0.06); }
.dsum-input { flex: 1; min-width: 0; height: 32px; max-height: 132px; padding: 0; border: none; background: transparent; color: var(--dshui-text-primary); font: inherit; font-size: 14px; line-height: 32px; resize: none; outline: none; overflow-y: auto; }
.dsum-input::placeholder { color: var(--dshui-text-dimmed); }
.dsum-send { flex: none; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: none; border-radius: 50%; background-color: var(--dshui-surface-2); background-image: linear-gradient(var(--dshui-surface-2), var(--dshui-surface-2)); color: var(--dshui-text-secondary); cursor: pointer; transition: background var(--dshui-duration-fast) var(--dshui-ease-standard), color var(--dshui-duration-fast) var(--dshui-ease-standard); }
.dsum-send[data-ready='true'] { background: var(--dshui-brand-fill); color: var(--dshui-text-on-brand); }
.dsum-send[data-ready='true']:hover { background: var(--dshui-brand-hover); }
.dsum-send:disabled { cursor: default; opacity: 0.75; }
.dsum-panel { position: relative; transition: box-shadow var(--dshui-duration-base) var(--dshui-ease-standard); }
.dsum-panel.is-thinking { box-shadow: inset 0 0 160px 8px color-mix(in srgb, var(--dshui-brand) 13%, transparent); }
.dsum-inner { transition: filter var(--dshui-duration-base) var(--dshui-ease-standard), opacity var(--dshui-duration-base) var(--dshui-ease-standard); }
.dsum-panel.is-thinking .dsum-inner { filter: blur(5px); opacity: 0.4; pointer-events: none; }
.dsum-skel { display: flex; flex-direction: column; gap: 11px; margin-top: 26px; }
.dsum-skel-row { height: 13px; border-radius: 7px; background: color-mix(in srgb, var(--dshui-text-primary) 8%, transparent); animation: dsum-shimmer 1.6s ease-in-out infinite; }
.dsum-skel-title { width: 26%; height: 16px; margin-top: 14px; }
.dsum-skel-title:first-child { margin-top: 0; }
@keyframes dsum-shimmer { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
.dsum-reveal { animation: dsum-fade 0.4s var(--dshui-ease-standard) both; }
@keyframes dsum-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.dsum-compose-inner { position: relative; }
.dsum-reply-pop { position: absolute; left: 32px; right: 32px; bottom: calc(100% - 2px); max-height: 42vh; overflow-y: auto; box-sizing: border-box; padding: 13px 15px; border: 1px solid var(--dshui-border-2); border-radius: 16px; background: var(--dshui-surface-1); box-shadow: 0 12px 34px rgba(0, 0, 0, 0.1); animation: dsum-fade 0.22s var(--dshui-ease-standard) both; }
.dsum-reply-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; color: var(--dshui-text-tertiary); font-size: 12px; }
.dsum-reply-close { margin-left: auto; width: 22px; height: 22px; border: none; border-radius: 6px; background: transparent; color: var(--dshui-text-dimmed); font-size: 13px; line-height: 1; cursor: pointer; }
.dsum-reply-close:hover { background: var(--dshui-surface-hover); color: var(--dshui-text-primary); }
.dsum-reply-text { color: var(--dshui-text-secondary); font-size: 14px; line-height: 1.7; white-space: pre-wrap; }
.dsum-changes { margin: 8px 0 0; padding: 8px 0 0; border-top: 1px solid var(--dshui-border-2); list-style: none; color: var(--dshui-text-tertiary); font-size: 12.5px; line-height: 1.6; }`

    function injectStyle() {
      if (document.getElementById('dsum-style') !== null) return
      const style = document.createElement('style')
      style.id = 'dsum-style'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /** The summary text, split into its "## heading" sections. */
    function sections(text) {
      const out = []
      for (const line of String(text ?? '').split('\n')) {
        const heading = /^##\s+(.*)$/.exec(line.trim())
        if (heading !== null) out.push({ heading: heading[1], body: [] })
        else if (line.trim() !== '') {
          if (out.length === 0) out.push({ heading: '', body: [] })
          out[out.length - 1].body.push(line)
        }
      }
      return out
    }

    function grouped(entries) {
      const groups = new Map()
      for (const entry of entries) {
        const key = entry.topic ?? ''
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(entry)
      }
      return [...groups.entries()]
    }

    function Arrow() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M8 12.4V3.6' }),
        h('path', { d: 'M3.9 7.7 8 3.6l4.1 4.1' }),
      )
    }

    function Panel() {
      const [state, setState] = useState({ loading: true, entries: [], summary: null, sizes: null, limits: null, fresh: false, summarizing: false, error: null })
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState(false)
      const [reply, setReply] = useState(null)
      const [changes, setChanges] = useState([])
      const [note, setNote] = useState(null)
      const mounted = useRef(true)
      const inputRef = useRef(null)

      const fit = useCallback(() => {
        const el = inputRef.current
        if (el === null) return
        el.style.height = 'auto'
        const next = Math.min(Math.max(el.scrollHeight, 32), 132)
        el.style.height = next + 'px'
        el.style.lineHeight = next <= 32 ? '32px' : '1.6'
      }, [])

      const load = useCallback(() => {
        return call('/view').then((value) => {
          if (mounted.current) setState({ ...value, loading: false })
        }).catch((error) => {
          if (mounted.current) setState((current) => ({ ...current, loading: false, error: String(error?.message ?? error) }))
        })
      }, [])

      useEffect(() => {
        mounted.current = true
        injectStyle()
        void load()
        return () => { mounted.current = false }
      }, [load])

      useEffect(() => {
        if (state.summarizing !== true) return undefined
        const timer = setInterval(() => { void load() }, 700)
        return () => clearInterval(timer)
      }, [state.summarizing, load])

      const remove = (entry) => {
        setNote(null)
        void call('/forget', { method: 'POST', body: JSON.stringify({ text: entry.text, topic: entry.topic }) })
          .then((value) => setState({ ...value, loading: false }))
          .catch((error) => setNote(String(error?.message ?? error)))
      }

      const send = () => {
        const text = draft.trim()
        if (text === '' || busy) return
        setBusy(true)
        setNote(null)
        setReply(null)
        setChanges([])
        void call('/ask', { method: 'POST', body: JSON.stringify({ text }) }).then((value) => {
          setDraft('')
          const applied = Array.isArray(value.changes) ? value.changes : []
          setReply(value.reply ?? '')
          setChanges(applied.map((change) => (change.ok ? '✓ ' : '✗ ') + (change.text || change.error || '')))
          setState({ ...value.view, loading: false })
        }).catch((error) => setNote(String(error?.message ?? error))).finally(() => setBusy(false))
      }

      useEffect(() => { fit() }, [draft, fit])

      const regenerate = () => {
        void call('/view?regenerate=1').then((value) => setState({ ...value, loading: false })).catch((error) => setNote(String(error?.message ?? error)))
      }

      const mainSize = state.sizes?.main ?? 0
      const mainLimit = state.limits?.main ?? 4000
      const count = state.entries.length
      const status = state.loading ? '读取中…' : state.summarizing ? '正在更新…' : count + ' 条 · MEMORY.md ' + mainSize + ' / ' + mainLimit

      return h('div', { className: 'dsum-panel' + (busy ? ' is-thinking' : ''), 'data-dsh-user-memory-view': '' },
        h('div', { className: 'dsum-inner' },
          h('div', { className: 'dsum-head' },
            h('h2', { className: 'dsum-title' }, '记忆摘要'),
            h('span', { className: 'dsum-sub' }, 'Sylvia · ' + status),
            h('div', { className: 'dsum-actions' },
              h('button', { className: 'dsum-ghost', onClick: regenerate, disabled: state.summarizing }, state.summarizing ? '整理中…' : '重写摘要'),
              h('button', { className: 'dsum-ghost', onClick: () => void load() }, '刷新'),
            ),
          ),
          h('div', { className: 'dsum-divider' }),
          state.error !== null ? h('div', { className: 'dsum-error' }, state.error) : null,
          state.summarizing
            ? h('div', { className: 'dsum-skel' },
                h('div', { className: 'dsum-skel-row dsum-skel-title' }),
                h('div', { className: 'dsum-skel-row', style: { width: '96%' } }),
                h('div', { className: 'dsum-skel-row', style: { width: '89%' } }),
                h('div', { className: 'dsum-skel-row', style: { width: '58%' } }),
                h('div', { className: 'dsum-skel-row dsum-skel-title' }),
                h('div', { className: 'dsum-skel-row', style: { width: '94%' } }),
                h('div', { className: 'dsum-skel-row', style: { width: '71%' } }),
              )
            : state.summary !== null
              ? h('div', { className: 'dsum-reveal', key: state.summary.text },
                  sections(state.summary.text).map((section, index) =>
                    h(React.Fragment, { key: 's' + index },
                      section.heading !== '' ? h('div', { className: 'dsum-sec' }, section.heading) : null,
                      h('p', { className: 'dsum-body' }, section.body.join(' ')),
                    )))
              : null,
          count === 0 && !state.loading
            ? h('div', { className: 'dsum-empty' }, '还没有记住任何东西。聊几句，回合结束后会自动整理。')
            : null,
          count === 0 ? null : h('div', { className: 'dsum-sep' }),
          count === 0 ? null : h('div', { className: 'dsum-sec' }, '全部条目'),
          grouped(state.entries).map(([topic, list]) =>
            h('div', { className: 'dsum-group', key: topic || 'main' },
              topic === '' ? null : h('div', { className: 'dsum-topic' }, topic),
              h('div', { className: 'dsum-entries' }, ...list.map((entry, index) =>
                h('div', { className: 'dsum-entry', key: index },
                  h('div', { className: 'dsum-entry-text' }, entry.text,
                    h('span', { className: 'dsum-entry-meta', title: entry.source ?? '' }, entry.added ?? '')),
                  h('button', { className: 'dsum-remove', title: '删除这条', onClick: () => remove(entry) }, '×'),
                ))),
            )),
          note !== null ? h('div', { className: 'dsum-error' }, note) : null,
        ),
        h('div', { className: 'dsum-compose' },
          h('div', { className: 'dsum-compose-inner' },
            reply !== null && reply !== ''
              ? h('div', { className: 'dsum-reply-pop' },
                  h('div', { className: 'dsum-reply-head' }, 'Sylvia',
                    h('button', {
                      className: 'dsum-reply-close',
                      title: '关掉',
                      onClick: () => { setReply(null); setChanges([]) },
                    }, '×')),
                  h('div', { className: 'dsum-reply-text' }, reply),
                  changes.length > 0
                    ? h('ul', { className: 'dsum-changes' }, ...changes.map((line, index) => h('li', { key: index }, line)))
                    : null,
                )
              : null,
            h('div', { className: 'dsum-box' },
            h('textarea', {
              className: 'dsum-input',
              rows: 1,
              ref: inputRef,
              placeholder: '询问或更新',
              value: draft,
              onChange: (event) => { setDraft(event.target.value); fit() },
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  send()
                }
              },
            }),
            h('button', { className: 'dsum-send', 'data-ready': String(draft.trim() !== '' && !busy), onClick: send, disabled: busy, title: '发送' }, busy ? '…' : h(Arrow)),
            ),
          ),
        ),
      )
    }

    function Icon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M3 2.5h6.5A2.5 2.5 0 0 1 12 5v8.5H5.5A2.5 2.5 0 0 1 3 11V2.5z' }),
        h('path', { d: 'M5.5 5.5h4M5.5 8h4M5.5 10.5h2.5' }),
        h('path', { d: 'M12 5h1.5v9.5H6' }),
      )
    }

    function Page() {
      return h('div', { 'data-dsh-plugin': 'user-memory', style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' } }, h(Panel))
    }

    function apply(ctx) {
      ctx.inject(['slots'], (scope) => {
        const disposers = []
        try {
          disposers.push(scope.slots.inject('sidebar.panellist', () => scope.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 62,
            label: () => '记忆',
          }, Icon)))
        } catch (error) {
          console.warn('dsh-user-memory: sidebar row not registered', error)
        }
        try {
          disposers.push(scope.slots.inject('main', () => scope.slots.register({
            name: 'main',
            key: PANEL_ID,
            inject: () => ({}),
          }, Page)))
        } catch (error) {
          console.warn('dsh-user-memory: page not registered', error)
        }
        scope.effect(() => () => {
          for (const dispose of disposers.splice(0)) if (typeof dispose === 'function') dispose()
        }, 'dsh-user-memory: mounts')
      })
    }

    const module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = []
    return module.exports
  },
})