/**
 * dsh-ui-ptc — 浏览器半边。
 *
 * PTC 模式把一次程序执行画成一棵调用树：根是 run_code，程序里每次
 * tools.xxx() 都是它的子调用。内置的根行是一张通用的代码卡片，于是聊天里
 * 先出现一大段代码，真正的动作缩在它下面的竖线里。
 *
 * 这一层只改根行：把 run_code 自己的卡片从 tool.call.toolview 上摘下来，
 * 子调用列去掉缩进与竖线，动作就像普通模式那样平铺在聊天里。
 *
 * 根行只在两种情况下保留一行字：程序没有派发任何子调用（否则这一段会整段
 * 空掉），以及程序本身失败、中止或超时（错误不在任何子调用里，不能让它们
 * 静默消失）。
 */

function dshuiComponent_ptc(rt) {
  const React = rt.require('react')
  if (React === null || typeof React.createElement !== 'function') {
    rt.warn('react is not in this boot graph; component skipped')
    return
  }

  const h = React.createElement
  const Fragment = React.Fragment

  /** The keyed Tool view seat this component owns. */
  const TOOLVIEW_SLOT = 'tool.call.toolview'

  /** Our own markers: the root marker also tells the stylesheet which row lost its card. */
  const ROOT_ATTR = 'data-dshui-ptc-root'
  const ROW_ATTR = 'data-dshui-ptc-row'
  const RUNNING_ATTR = 'data-dshui-ptc-running'
  const FAILED_ATTR = 'data-dshui-ptc-failed'
  const ROOT_CLASS = 'dshui-ptc-root'
  const NOTE_CLASS = 'dshui-ptc-note'
  const ERROR_CLASS = 'dshui-ptc-error'

  /* The stylesheet spells the row marker literally; keep it in sync with ROW_ATTR. */
  const STYLESHEET = `
/* The card itself is gone; this span only carries the row marker. */
.dshui-ptc-root {
  display: none;
}

/* The call row that lost its card: its children stand on their own now. */
[data-dshui-ptc-row] > [data-subcalls] {
  position: relative;
  margin: 0;
  padding-left: 8px;
  border-left: 0;
}

/* The group keeps a whisper of the guide line: 1px, dimmed, clear on hover. */
[data-dshui-ptc-row] > [data-subcalls]::before {
  content: '';
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  width: 1px;
  border-radius: 1px;
  background: var(--dsw-alias-border-l2);
  opacity: 0.35;
  transition: opacity 120ms ease, background-color 120ms ease;
}

[data-dshui-ptc-row]:hover > [data-subcalls]::before {
  opacity: 0.8;
}

/* Any failed step turns the whole group's line red. */
[data-dshui-ptc-row][data-dshui-ptc-failed] > [data-subcalls]::before {
  background: var(--dsw-alias-state-error-primary);
  opacity: 0.7;
}

/* A 2px sweep across the group head while the program is still running. */
[data-dshui-ptc-row][data-dshui-ptc-running]::before {
  content: '';
  display: block;
  height: 2px;
  margin: 0 0 6px;
  border-radius: 1px;
  background-image: linear-gradient(90deg, transparent, var(--dsw-alias-state-business-primary), transparent);
  background-size: 45% 100%;
  background-repeat: no-repeat;
  animation: dshui-ptc-sweep 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes dshui-ptc-sweep {
  0% { background-position: -45% 0; opacity: 0.35; }
  45% { opacity: 0.75; }
  100% { background-position: 100% 0; opacity: 0.35; }
}

@media (prefers-reduced-motion: reduce) {
  [data-dshui-ptc-row][data-dshui-ptc-running]::before {
    animation: none;
    opacity: 0.5;
  }
}

/* One quiet line for a program that dispatched nothing, or failed as a whole. */
.dshui-ptc-note,
.dshui-ptc-error {
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 1.5;
  margin: 2px 0;
  padding: 0;
  overflow-wrap: anywhere;
}

.dshui-ptc-note {
  color: var(--dsw-alias-label-secondary);
}

.dshui-ptc-error {
  color: var(--dsw-alias-state-error-primary);
}
`

  /** Whether the block is a settled result (its stage left the event stream). */
  function settled(block) {
    return typeof block === 'object' && block !== null && 'kind' in block
  }

  /** Whether one dispatched step settled as a failure or a stop. */
  function childFailed(block) {
    if (!settled(block)) return false
    if (block.isError === true) return true
    return typeof block.error === 'object' && block.error !== null && block.error.code === 'interrupted'
  }

  /** The result's text content, flattened the same way the built-in rows do it. */
  function resultText(node) {
    const parts = []
    const content = Array.isArray(node === null || node === undefined ? null : node.content) ? node.content : []
    for (let index = 0; index < content.length; index += 1) {
      const block = content[index]
      if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text)
        continue
      }
      try {
        parts.push(JSON.stringify(block, null, 2))
      } catch (error) {
        parts.push(String(block))
      }
    }
    return parts.join('\n')
  }

  /** First non-empty line of a text, trimmed. */
  function firstLine(text) {
    const lines = String(text).split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim()
      if (line !== '') return line
    }
    return ''
  }

  /** The whole-program failure: its text, else its error code. Empty means "no detail". */
  function failureLine(block) {
    const error = typeof block.error === 'object' && block.error !== null ? block.error : null
    const text = firstLine(resultText(block))
    if (text !== '') return text
    if (error !== null) {
      if (typeof error.code === 'string' && error.code !== '') return error.code
      if (typeof error.name === 'string' && error.name !== '') return error.name
    }
    return ''
  }

  /** The model's own description of this run, when the arguments already carry one. */
  function callDescription(block) {
    try {
      const args = block === null || block === undefined ? null : block.args
      if (typeof args !== 'object' || args === null) return ''
      const value = args.description
      return typeof value === 'string' ? value.trim() : ''
    } catch (error) {
      return ''
    }
  }

  /**
   * The replacement for the run_code card.
   *
   * It renders nothing for the program itself: the subcalls are siblings this
   * seat never owns, so leaving the card empty is exactly what makes them rise
   * to the conversation flow. A row keeps one line only when there is nothing
   * else to look at, or when the failure belongs to the program and no subcall
   * will ever carry it.
   */
  function PtcRoot(props) {
    const block = props.block
    const done = settled(block)
    const subCalls = Array.isArray(block === null || block === undefined ? null : block.subCalls) ? block.subCalls : []
    const stopped = done && typeof block.error === 'object' && block.error !== null && block.error.code === 'interrupted'
    const failed = done && (block.isError === true || stopped)
    const running = !done
    const anyChildFailed = subCalls.some(childFailed)
    const rootRef = React.useRef(null)

    // The stylesheet cannot walk up from here, so the row itself is marked:
    // its child column keeps only a whisper of the guide line, and the head
    // shows a sweep while the program is still running.
    React.useEffect(function () {
      const node = rootRef.current
      if (node === null || typeof node.closest !== 'function') return undefined
      const row = node.closest('[data-chat-call-id]')
      if (row === null) return undefined
      row.setAttribute(ROW_ATTR, '')
      if (running) row.setAttribute(RUNNING_ATTR, '')
      else row.removeAttribute(RUNNING_ATTR)
      if (failed || anyChildFailed) row.setAttribute(FAILED_ATTR, '')
      else row.removeAttribute(FAILED_ATTR)
      return function () {
        row.removeAttribute(ROW_ATTR)
        row.removeAttribute(RUNNING_ATTR)
        row.removeAttribute(FAILED_ATTR)
      }
    }, [running, failed, anyChildFailed])

    const children = []

    if (failed) {
      const detail = failureLine(block)
      const label = stopped ? '程序已中止' : '程序执行失败'
      children.push(
        h('div', { key: 'error', className: ERROR_CLASS, role: 'note' }, detail === '' ? label : label + ' · ' + detail),
      )
    } else if (subCalls.length === 0 && props.phase !== 'preparing') {
      const description = callDescription(block)
      const label = done ? '程序已完成' : '程序运行中'
      children.push(
        h('div', { key: 'note', className: NOTE_CLASS }, description === '' ? label : label + ' · ' + description),
      )
    }

    children.push(
      h('span', {
        key: 'root',
        ref: rootRef,
        className: ROOT_CLASS,
        [ROOT_ATTR]: 'true',
        'aria-hidden': 'true',
      }),
    )

    return h(Fragment, null, children)
  }

  /**
   * Install the sheet and claim the run_code seat.
   *
   * The seat is keyed and empty in the shipped composition, so a plain
   * registration wins over the generic fallback without a priority override.
   */
  function install(ctx) {
    rt.effect(function () {
      const removeSheet = rt.style('ptc', STYLESHEET)
      let offToolview = null
      try {
        offToolview = ctx.slots.inject(TOOLVIEW_SLOT, function () {
          // The shipped ui-tool registers the same key at priority 0; the
          // lowest priority renders, so this row must claim a lower number.
          return ctx.slots.register({ name: TOOLVIEW_SLOT, key: 'run_code', priority: -1 }, PtcRoot)
        })
      } catch (error) {
        // No conversation layer in this composition: leave no dangling sheet.
        rt.error(error)
      }
      return function () {
        if (offToolview !== null) offToolview()
        removeSheet()
      }
    }, 'ui-ptc: run_code row')
  }

  rt.ctx.inject(['slots'], function (scope) {
    install(scope)
  })
}
