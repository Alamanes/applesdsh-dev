/**
 * dsh-agent-room browser half.
 *
 * 右侧边栏里的一间屋：tab 类型与正文都注册在 sidebar-right 的公开席上，
 * 和宿主自己的 tab（文件、终端）共用同一条 tab 条，不另开页面。
 */

const STYLE_ID = 'dsh-agent-room-style'

const CSS = [
  '.dshar-root{display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px;color:var(--dshui-text-primary,#10233d)}',
  '.dshar-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px;flex:none;padding:8px 12px;border-bottom:1px solid var(--dshui-border-subtle,rgba(76,105,142,.15))}',
  '.dshar-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;background:var(--dshui-surface-raised,rgba(76,105,142,.08));font-size:11px;line-height:18px}',
  '.dshar-dot{width:7px;height:7px;border-radius:50%;flex:none}',
  '.dshar-log{flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px}',
  '.dshar-empty{margin:auto;color:var(--dshui-text-tertiary,#7b8ba3);font-size:12px;text-align:center;line-height:1.8}',
  '.dshar-msg{display:flex;flex-direction:column;gap:3px}',
  '.dshar-meta{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dshui-text-tertiary,#7b8ba3)}',
  '.dshar-name{font-weight:600;color:var(--dshui-text-secondary,#33465e)}',
  '.dshar-text{white-space:pre-wrap;word-break:break-word;line-height:1.65}',
  '.dshar-compose{flex:none;padding:8px 12px 12px;border-top:1px solid var(--dshui-border-subtle,rgba(76,105,142,.15))}',
  '.dshar-box{display:flex;gap:8px;align-items:flex-end}',
  '.dshar-input{flex:1 1 auto;min-height:34px;max-height:120px;resize:none;padding:8px 10px;border-radius:10px;border:1px solid var(--dshui-border,rgba(76,105,142,.22));background:var(--dshui-surface,rgba(255,255,255,.86));color:inherit;font:inherit;line-height:1.5;outline:none}',
  '.dshar-input:focus{border-color:var(--dshui-palette-brand,#4d6bfe)}',
  '.dshar-send{flex:none;height:34px;padding:0 14px;border-radius:10px;border:0;cursor:pointer;background:var(--dshui-palette-brand,#4d6bfe);color:#fff;font:inherit}',
  '.dshar-send[disabled]{opacity:.5;cursor:default}',
  '.dshar-err{padding:6px 12px;font-size:11px;color:#c0503f;word-break:break-word}',
  '.dshar-typing{font-size:11px;color:var(--dshui-text-tertiary,#7b8ba3);padding:0 12px 6px}',
  '.dshar-entry{display:inline-flex;align-items:center;height:26px;padding:0 9px;border-radius:8px;border:0;cursor:pointer;background:transparent;color:var(--dshui-text-secondary,#33465e);font:inherit;font-size:12px}',
  '.dshar-entry:hover{background:var(--dshui-surface-hover,rgba(76,105,142,.1))}',
].join('\n')

/**
 * 把样式写进文档一次。
 */
function installStyle() {
  if (typeof document === 'undefined') return
  let node = document.getElementById(STYLE_ID)
  if (node === null) {
    node = document.createElement('style')
    node.id = STYLE_ID
    node.textContent = CSS
    document.head.appendChild(node)
  }
}

window.__ModuleLoader__.load({
  id: 'dsh-agent-room',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const ID = 'dsh-agent-room'
    const KIND = 'dsh-agent-room'

    installStyle()

    /**
     * 解开 RPC 结果：宿主回 { ok, value } 时按成功取值、失败抛错。
     * @param result - rpc.call 的返回值。
     * @returns 业务值。
     */
    function unwrap(result) {
      if (result === null || typeof result !== 'object' || !('ok' in result)) return result
      if (result.ok === true) return result.value
      throw new Error(result.error?.message ?? '房间没有回应')
    }

    /**
     * 房间正文：消息流 + 输入框。
     * @param props - call 由席位注入。
     */
    function RoomBody({ call }) {
      const [bots, setBots] = React.useState([])
      const [messages, setMessages] = React.useState([])
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const logRef = React.useRef(null)
      const loadedRef = React.useRef(false)

      const request = React.useCallback(
        (endpoint, params) => Promise.resolve(call(endpoint, params)).then(unwrap),
        [call],
      )

      React.useEffect(() => {
        if (loadedRef.current) return
        loadedRef.current = true
        request('dsh-agent-room/room', {})
          .then((state) => {
            setBots(state?.bots ?? [])
            setMessages(state?.messages ?? [])
          })
          .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      }, [request])

      React.useEffect(() => {
        const node = logRef.current
        if (node !== null) node.scrollTop = node.scrollHeight
      }, [messages, busy])

      const submit = () => {
        const text = draft.trim()
        if (text === '' || busy) return
        setDraft('')
        setBusy(true)
        setError(null)
        setMessages((prev) => [...prev, { who: 'user', name: '你', text }])
        request('dsh-agent-room/send', { text })
          .then((value) => {
            setBots(value?.bots ?? [])
            setMessages((prev) => [...prev, ...(value?.messages ?? [])])
          })
          .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
          .finally(() => setBusy(false))
      }

      const onKeyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          submit()
        }
      }

      return h(
        'div',
        { className: 'dshar-root' },
        bots.length === 0
          ? null
          : h(
              'div',
              { className: 'dshar-head' },
              bots.map((bot) =>
                h(
                  'span',
                  { key: bot.id, className: 'dshar-chip' },
                  h('span', { className: 'dshar-dot', style: { background: bot.color ?? '#4d6bfe' } }),
                  bot.name,
                  bot.role ? h('span', null, '·' + bot.role) : null,
                ),
              ),
            ),
        h(
          'div',
          { className: 'dshar-log', ref: logRef },
          messages.length === 0
            ? h('div', { className: 'dshar-empty' }, '这间屋子还空着。', h('br'), '说一句话，它们会一个个接。')
            : messages.map((entry, index) =>
                h(
                  'div',
                  { key: index, className: 'dshar-msg' },
                  h(
                    'div',
                    { className: 'dshar-meta' },
                    entry.who === 'user'
                      ? null
                      : h('span', { className: 'dshar-dot', style: { background: entry.color ?? '#4d6bfe' } }),
                    h('span', { className: 'dshar-name' }, entry.name ?? entry.who),
                    entry.role ? h('span', null, '·' + entry.role) : null,
                  ),
                  h('div', { className: 'dshar-text' }, entry.text),
                ),
              ),
        ),
        busy ? h('div', { className: 'dshar-typing' }, '屋里有人正在想……') : null,
        error === null ? null : h('div', { className: 'dshar-err' }, error),
        h(
          'div',
          { className: 'dshar-compose' },
          h(
            'div',
            { className: 'dshar-box' },
            h('textarea', {
              className: 'dshar-input',
              value: draft,
              rows: 1,
              placeholder: '说点什么，Enter 发送',
              onChange: (event) => setDraft(event.target.value),
              onKeyDown,
            }),
            h(
              'button',
              { type: 'button', className: 'dshar-send', disabled: busy || draft.trim() === '', onClick: submit },
              '说',
            ),
          ),
        ),
      )
    }

    /**
     * 会话 header 的入口：点一下把右栏打开到这间屋。
     * @param props - open 由席位注入。
     */
    function EntryButton({ open }) {
      return h('button', { type: 'button', className: 'dshar-entry', title: '群聊', onClick: open }, '群聊')
    }

    /**
     * 挂载两个席位与一个 tab 类型。
     * @param ctx - 客户端根上下文。
     */
    function apply(ctx) {
      ctx.inject(['slots', 'sidebarRight', 'sidebarRightTabs', 'connection'], (scope) => {
        const call = (endpoint, params, signal) =>
          scope.connection.rpc.call('/api', endpoint, params ?? {}, signal)
        const open = () => scope.sidebarRight.openTab(KIND)

        scope.effect(
          () =>
            scope.sidebarRightTabs.register({
              id: ID,
              kind: KIND,
              title: () => '群聊',
              keepMounted: true,
            }),
          'dsh-agent-room: tab type',
        )

        scope.effect(
          () =>
            scope.slots.inject('sidebar.right.pane.tab', () =>
              scope.slots.register(
                {
                  name: 'sidebar.right.pane.tab',
                  key: ID,
                  inject: () => ({ call }),
                },
                RoomBody,
              ),
            ),
          'dsh-agent-room: pane body',
        )

        scope.effect(
          () =>
            scope.slots.inject('conversation.session.header.actions', () =>
              scope.slots.register(
                {
                  name: 'conversation.session.header.actions',
                  id: 'dsh-agent-room.entry',
                  order: 40,
                  inject: () => ({ open }),
                },
                EntryButton,
              ),
            ),
          'dsh-agent-room: header entry',
        )
      })
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
