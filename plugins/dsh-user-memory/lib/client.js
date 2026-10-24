/**
 * dsh-user-memory browser half — a settings-style panel: the summary the model
 * writes, every entry, and one box that asks a question or changes memory.
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

    const CSS = `
.dsum-panel { display: flex; flex-direction: column; gap: var(--dshui-space-5); padding: var(--dshui-space-7) var(--dshui-space-6) var(--dshui-space-9); max-width: 820px; margin: 0 auto; color: var(--dshui-text-primary); font-family: var(--dshui-font-family); font-size: var(--dshui-text-size-base); line-height: var(--dshui-line-normal); }
.dsum-head { display: flex; align-items: center; gap: var(--dshui-space-3); }
.dsum-title { margin: 0; font-size: var(--dshui-text-size-lg); font-weight: 600; letter-spacing: -0.01em; color: var(--dshui-text-primary); }
.dsum-meta { display: flex; align-items: center; gap: var(--dshui-space-2); margin-left: auto; color: var(--dshui-text-tertiary); font-size: var(--dshui-text-size-sm); font-variant-numeric: tabular-nums; }
.dsum-button { height: var(--dshui-control-height-sm); padding: 0 var(--dshui-space-3); border: 1px solid var(--dshui-border-3); border-radius: var(--dshui-radius-md); background: var(--dshui-surface-1); color: var(--dshui-text-primary); font-family: inherit; font-size: var(--dshui-text-size-sm); cursor: pointer; transition: background var(--dshui-duration-fast) var(--dshui-ease-standard), border-color var(--dshui-duration-fast) var(--dshui-ease-standard); }
.dsum-button:hover { background: var(--dshui-surface-hover); border-color: var(--dshui-border-4); }
.dsum-button:disabled { opacity: 0.5; cursor: default; }
.dsum-bar { height: 2px; border-radius: var(--dshui-radius-pill); background: var(--dshui-neutral-fill); overflow: hidden; }
.dsum-bar span { display: block; height: 100%; border-radius: inherit; background: var(--dshui-brand); transition: width var(--dshui-duration-base) var(--dshui-ease-standard); }
.dsum-empty { padding: var(--dshui-space-4) var(--dshui-space-1); color: var(--dshui-text-tertiary); font-size: var(--dshui-text-size-sm); }
.dsum-card { padding: var(--dshui-space-5); border-radius: var(--dshui-radius-lg); background: var(--dshui-surface-1); }
.dsum-card h3 { margin: var(--dshui-space-4) 0 var(--dshui-space-2); font-size: var(--dshui-text-size-sm); font-weight: 600; color: var(--dshui-text-secondary); letter-spacing: 0.01em; }
.dsum-card h3:first-child { margin-top: 0; }
.dsum-card p { margin: 0 0 var(--dshui-space-3); color: var(--dshui-text-secondary); }
.dsum-card p:last-child { margin-bottom: 0; }
.dsum-group { display: flex; flex-direction: column; gap: var(--dshui-space-2); }
.dsum-group-title { padding: 0 var(--dshui-space-1); color: var(--dshui-text-caption); font-size: var(--dshui-text-size-xs); letter-spacing: 0.06em; text-transform: uppercase; }
.dsum-entry { display: flex; align-items: flex-start; gap: var(--dshui-space-3); padding: var(--dshui-space-3) var(--dshui-space-4); border: 1px solid var(--dshui-border-2); border-radius: var(--dshui-radius-md); background: var(--dshui-surface-1); transition: background var(--dshui-duration-fast) var(--dshui-ease-standard); }
.dsum-entry:hover { background: var(--dshui-surface-hover); }
.dsum-entry-text { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.dsum-entry-meta { display: block; margin-top: var(--dshui-space-1); color: var(--dshui-text-caption); font-size: var(--dshui-text-size-xs); }
.dsum-remove { flex: none; width: 22px; height: 22px; border: none; border-radius: var(--dshui-radius-sm); background: transparent; color: var(--dshui-text-dimmed); font-size: 15px; line-height: 1; cursor: pointer; opacity: 0; transition: opacity var(--dshui-duration-fast) var(--dshui-ease-standard), color var(--dshui-duration-fast) var(--dshui-ease-standard); }
.dsum-entry:hover .dsum-remove, .dsum-remove:focus-visible { opacity: 1; }
.dsum-remove:hover { color: var(--dshui-danger); background: var(--dshui-neutral-fill); }
.dsum-compose { display: flex; align-items: flex-end; gap: var(--dshui-space-3); }
.dsum-input { flex: 1; min-height: 44px; max-height: 180px; padding: var(--dshui-space-3) var(--dshui-space-4); border: 1px solid var(--dshui-border-3); border-radius: var(--dshui-radius-md); background: var(--dshui-surface-base); color: var(--dshui-text-primary); font: inherit; line-height: var(--dshui-line-normal); resize: none; transition: border-color var(--dshui-duration-fast) var(--dshui-ease-standard); }
.dsum-input::placeholder { color: var(--dshui-text-dimmed); }
.dsum-input:focus { outline: none; border-color: var(--dshui-border-focus); }
.dsum-send { flex: none; height: var(--dshui-control-height-lg); padding: 0 var(--dshui-space-5); border: none; border-radius: var(--dshui-radius-md); background: var(--dshui-brand-fill); color: var(--dshui-text-on-brand); font-family: inherit; font-size: var(--dshui-text-size-base); cursor: pointer; transition: background var(--dshui-duration-fast) var(--dshui-ease-standard); }
.dsum-send:hover { background: var(--dshui-brand-hover); }
.dsum-send:disabled { opacity: 0.45; cursor: default; }
.dsum-reply { padding: var(--dshui-space-2) 0 var(--dshui-space-2) var(--dshui-space-4); border-left: 2px solid var(--dshui-brand); color: var(--dshui-text-secondary); }
.dsum-error { color: var(--dshui-danger); font-size: var(--dshui-text-size-sm); white-space: pre-wrap; }
`

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

    function Panel() {
      const [state, setState] = useState({ loading: true, entries: [], summary: null, sizes: null, limits: null, fresh: false, summarizing: false, error: null })
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState(false)
      const [reply, setReply] = useState(null)
      const [note, setNote] = useState(null)
      const mounted = useRef(true)

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
        const timer = setInterval(() => { void load() }, 1500)
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
        void call('/ask', { method: 'POST', body: JSON.stringify({ text }) }).then((value) => {
          setDraft('')
          setReply(value.reply ?? '')
          setState({ ...value.view, loading: false })
          if (Array.isArray(value.changes) && value.changes.length > 0) {
            setNote(value.changes.map((change) => (change.ok ? '✓ ' : '✗ ') + (change.text || change.error || '')).join('\n'))
          }
        }).catch((error) => setNote(String(error?.message ?? error))).finally(() => setBusy(false))
      }

      const regenerate = () => {
        void call('/view?regenerate=1').then((value) => setState({ ...value, loading: false })).catch((error) => setNote(String(error?.message ?? error)))
      }

      const mainSize = state.sizes?.main ?? 0
      const mainLimit = state.limits?.main ?? 4000
      const ratio = mainLimit > 0 ? Math.min(1, mainSize / mainLimit) : 0

      return h('div', { className: 'dsum-panel', 'data-dsh-user-memory-view': '' },
        h('div', { className: 'dsum-head' },
          h('h2', { className: 'dsum-title' }, '记忆'),
          h('div', { className: 'dsum-meta' },
            h('span', null, 'MEMORY.md ' + mainSize + ' / ' + mainLimit),
            h('button', { className: 'dsum-button', onClick: regenerate, disabled: state.summarizing }, state.summarizing ? '整理中…' : '重写摘要'),
            h('button', { className: 'dsum-button', onClick: () => void load() }, '刷新'),
          ),
        ),
        h('div', { className: 'dsum-bar' }, h('span', { style: { width: Math.round(ratio * 100) + '%' } })),
        state.error !== null ? h('div', { className: 'dsum-error' }, state.error) : null,
        state.loading ? h('div', { className: 'dsum-empty' }, '读取中…') : null,
        state.entries.length === 0 && !state.loading
          ? h('div', { className: 'dsum-empty' }, '还没有记住任何东西。聊几句，回合结束后会自动整理。')
          : null,
        state.summary !== null
          ? h('div', { className: 'dsum-card' }, sections(state.summary.text).map((section, index) =>
              h(React.Fragment, { key: index },
                section.heading !== '' ? h('h3', null, section.heading) : null,
                h('p', null, section.body.join(' ')),
              )))
          : null,
        grouped(state.entries).map(([topic, list]) =>
          h('div', { className: 'dsum-group', key: topic || 'main' },
            h('div', { className: 'dsum-group-title' }, topic === '' ? 'MEMORY.md' : topic),
            ...list.map((entry, index) =>
              h('div', { className: 'dsum-entry', key: index },
                h('div', { className: 'dsum-entry-text' }, entry.text,
                  h('span', { className: 'dsum-entry-meta' }, [entry.added, entry.source].filter(Boolean).join(' · '))),
                h('button', { className: 'dsum-remove', title: '删除这条', onClick: () => remove(entry) }, '×'),
              )),
          )),
        reply !== null && reply !== '' ? h('div', { className: 'dsum-reply' }, reply) : null,
        note !== null ? h('div', { className: 'dsum-error', style: { whiteSpace: 'pre-wrap' } }, note) : null,
        h('div', { className: 'dsum-compose' },
          h('textarea', {
            className: 'dsum-input',
            placeholder: '问一句，或者让它改记忆：「记住我喜欢素的风格」「删掉关于 vim 的那条」',
            value: draft,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            },
          }),
          h('button', { className: 'dsum-send', onClick: send, disabled: busy || draft.trim() === '' }, busy ? '…' : '发送'),
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
      return h('div', { 'data-dsh-plugin': 'user-memory' }, h(Panel))
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
