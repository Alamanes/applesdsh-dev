/**
 * dsh-self-evolution — browser half.
 *
 * A compact status strip under the composer. The host half owns all the state
 * and every decision; this half only reads and shows it, so the panel can never
 * become a second, unaudited door into promotion or archiving.
 *
 * What it shows is exactly the numbers that answer "is anything waiting for me":
 * how many candidates are queued, how many extracts are waiting for a Dream,
 * how many skills are enabled, and when the last Dream and the last flow ran. Anything more would be a page, and a page needs a
 * slot this plugin can place reliably; the strip uses the one slot the plugin
 * authoring guide recommends for a first version.
 *
 * Styling deliberately sets no color. It inherits the surrounding text color
 * and uses `currentColor` for the border, so the strip follows the host theme,
 * including light/dark switching, without naming a single theme token that
 * could be renamed out from under it.
 */

window.__ModuleLoader__.load({
  id: 'dsh-self-evolution',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    /** The slot the strip renders into. */
    const SLOT = 'conversation.composer.dock'

    /** Host route carrying the panel's data; see the host half. */
    const OVERVIEW_ROUTE = '/api/self-evolution/overview'

    /** Refresh interval: a local round trip that keeps the counts current. */
    const POLL_MS = 60000

    /** The strip. Renders whatever it has; never throws into the slot. */
    function EvolutionStrip() {
      const [state, setState] = React.useState({ loading: true })

      React.useEffect(() => {
        let live = true
        async function load() {
          try {
            const response = await fetch(OVERVIEW_ROUTE, { headers: { accept: 'application/json' } })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const body = await response.json()
            if (live) setState({ loading: false, data: body })
          } catch (error) {
            if (live) setState({ loading: false, error: String(error?.message ?? error) })
          }
        }
        void load()
        const timer = setInterval(() => { void load() }, POLL_MS)
        return () => {
          live = false
          clearInterval(timer)
        }
      }, [])

      const data = state.data
      const status = data?.status
      const parts = []
      if (status !== undefined) {
        parts.push(`候选 ${status.candidates ?? 0}`)
        parts.push(`收件箱 ${status.inbox ?? 0}`)
        parts.push(`技能 ${status.skills ?? 0}`)
        if (typeof status.lastDreamAt === 'string' && status.lastDreamAt.length > 0) {
          parts.push(`上次 Dream ${String(status.lastDreamAt).slice(0, 16).replace('T', ' ')}`)
        }
        if (typeof status.lastEvolutionAt === 'string' && status.lastEvolutionAt.length > 0) {
          parts.push(`上次进化 ${String(status.lastEvolutionAt).slice(0, 16).replace('T', ' ')}`)
        }
        if (status.collectorUnavailable === true) parts.push('采集后端不可用')
      } else if (state.loading) {
        parts.push('读取中…')
      } else {
        parts.push(`不可用：${state.error ?? '未知原因'}`)
      }

      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            margin: '4px 0',
            padding: '4px 8px',
            border: '1px solid currentColor',
            borderRadius: '6px',
            fontSize: '12px',
            opacity: 0.75,
          },
          title: '自我进化：/evolve 查看状态，/evolve brief 查看探测结果',
        },
        h('span', { key: 'label', style: { fontWeight: 600 } }, '🧬 进化'),
        h('span', { key: 'counts' }, parts.join(' · ')),
      )
    }

    exports.inject = ['slots']

    /**
     * Register the strip for as long as this plugin is loaded.
     *
     * @param ctx - the client root context.
     */
    exports.apply = (ctx) => {
      ctx.slots.inject(SLOT, () =>
        ctx.slots.register({ name: SLOT, id: 'self-evolution-status', order: 20 }, EvolutionStrip),
      )
    }

    return module.exports
  },
})
