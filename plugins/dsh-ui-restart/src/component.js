/**
 * Restart control: one small button parked in the top-right corner of the frame,
 * just left of the built-in right-panel toggle, that fully quits and relaunches
 * the DSH desktop app.
 *
 * Why `shell.overlay`: the conversation header seats only exist once a session
 * is open. A brand-new chat renders `headerBlank headerSessionless`, which keeps
 * the corner seat and the leading seat but not `header.utilities`, so a control
 * registered in `conversation.session.header.utilities` never appears on the
 * first screen. The overlay layer is mounted by the frame itself, is present on
 * every route, and its children are laid out in frame coordinates.
 *
 * The button owns no restart logic. It posts the current session id to the host
 * half and waits: roughly a second later the whole app goes away, so the only
 * durable state is the host's pending-session file.
 */
function dshuiComponent_restart(rt) {
  const React = rt.require('react')
  if (React === null) {
    rt.warn('react is not in this boot graph; restart skipped')
    return
  }
  const h = React.createElement

  /**
   * The control is built out of primitives — the shipped tooltip, button and
   * refresh glyph — so there is no plain-DOM rendering to fall back to. Without
   * them the component logs once and stays inert rather than drawing a disabled
   * or half-styled corner seat that reads as a broken frame.
   */
  const primitives = rt.require('@deepseek-ai/dsh-client-ui-primitives')
  if (primitives === null) {
    rt.warn('ui primitives are not in this boot graph; restart has no control')
    return
  }

  /** Locale namespace for this component's copy; also the slot registration's `locale`. */
  const NS = 'dsh-restart'

  /**
   * Host route that schedules the quit-and-relaunch.
   *
   * The suite namespaces its host routes, so the old standalone spelling stays
   * registered on the host half as an alias: a page cached from before the
   * migration keeps working until it is reloaded.
   */
  const RESTART_ROUTE = '/dsh-ui-copy/restart'

  /** Copy, in the shape `ctx.locale.register` takes. */
  const zh = {
    'button.label': '彻底重启 DSH',
    'button.pending': '正在关闭并重新启动…',
    'failed.network': '请求发不出去，重启未开始。',
    'failed.desktop': '当前不是桌面应用宿主，无法重启。',
    'failed.generic': '重启失败，请重试。',
  }
  const en = {
    'button.label': 'Restart DSH',
    'button.pending': 'Quitting and relaunching…',
    'failed.network': 'The request could not be sent; nothing was restarted.',
    'failed.desktop': 'This process is not the desktop app host, so it cannot restart.',
    'failed.generic': 'Restart failed. Try again.',
  }

  /** Stylesheet for the one component-owned control. */
  const STYLESHEET = `
.dsh-restart-seat { position: absolute; top: 11px; right: 48px; z-index: 1; display: flex; align-items: center; -webkit-app-region: no-drag; }
.dsh-restart-button { width: 28px; height: 28px; color: var(--dshui-text-secondary); flex: none; padding: 0; }
.dsh-restart-button svg { width: 15px; height: 15px; }
.dsh-restart-button:disabled { opacity: .6; }
.dsh-restart-spin { animation: dsh-restart-spin .9s linear infinite; }
@keyframes dsh-restart-spin { to { transform: rotate(360deg); } }
`

  /**
   * The restart control.
   *
   * @param props - the restart hop from the host half, and the locale seat.
   * @returns the icon button seated in the frame's top-right corner.
   */
  function RestartButton({ restart, t }) {
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState(null)

    const press = () => {
      if (busy) return
      setBusy(true)
      setError(null)
      restart().catch((reason) => {
        setBusy(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    }

    const label = busy ? t('button.pending') : error !== null ? error : t('button.label')
    return h(
      'div',
      { className: 'dsh-restart-seat' },
      h(
        primitives.Tooltip,
        { label, side: 'bottom', delayMs: 400 },
        h(
          primitives.Button,
          {
            size: 'sm',
            className: 'dsh-restart-button',
            'aria-label': t('button.label'),
            disabled: busy,
            onClick: press,
          },
          h(primitives.IconRefreshOutlineRegular, { size: 15, className: busy ? 'dsh-restart-spin' : undefined }),
        ),
      ),
    )
  }

  /**
   * Install the surface.
   *
   * The services are waited for here rather than declared on the plugin, so a
   * composition without them leaves this component inert and the rest of the
   * suite running.
   *
   * @param ctx - client root context with `slots`, `locale` and `uiSession`.
   */
  function install(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-copy/restart: dictionaries')

    // The suite's sheet registry owns the <style> element, so switching this
    // component off removes its rules with it instead of leaving them behind.
    rt.style('restart', STYLESHEET)

    /** The session currently occupying the main view, if any. */
    const currentSessionId = () => {
      try {
        return ctx.uiSession?.current?.getSnapshot?.()?.key
      } catch {
        return undefined
      }
    }

    /**
     * Ask the host to quit and relaunch the app.
     *
     * @returns resolution once the host accepted the request.
     * @throws when the request could not be sent or the host refused it.
     */
    const restart = async () => {
      const bind = ctx.locale.bind(NS)
      let response
      try {
        response = await fetch(RESTART_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: currentSessionId() }),
          credentials: 'same-origin',
        })
      } catch {
        throw new Error(bind('failed.network'))
      }

      let payload = null
      try {
        payload = await response.json()
      } catch {
        // A body-less failure keeps its status-only verdict below.
      }

      if (!response.ok || payload === null || payload.ok !== true) {
        throw new Error(payload !== null && payload.reason === 'not-desktop' ? bind('failed.desktop') : bind('failed.generic'))
      }
      return payload
    }

    /**
     * Offset the seat keeps while the right rail is closed; the stylesheet
     * parks it there and the rail's own expand control sits 8px to its right.
     */
    const CLOSED_RIGHT = 48
    /** Breathing room between this seat and the rail's control group. */
    const GAP = 8

    /**
     * Right offset that clears the rail's control group.
     *
     * The right rail is a dockkit pane with a tab strip of its own. Opening it
     * mounts a split glyph and seats fullscreen plus collapse against the
     * window edge, so a fixed offset lands this button on top of the
     * fullscreen glyph. The strip's seats are measured instead: sit down just
     * left of the leftmost one.
     *
     * Seats are read even while the rail slides out of the window, which is
     * what keeps the offset continuous during the close animation; the
     * `CLOSED_RIGHT` floor takes over once the group has left the corner.
     *
     * @returns the offset in pixels, at least `CLOSED_RIGHT`.
     */
    const seatRight = () => {
      const width = window.innerWidth
      const toggle = document.querySelector('[data-sidebar-right-toggle]')
      if (toggle === null) return CLOSED_RIGHT

      let left = toggle.getBoundingClientRect().left
      const strip = toggle.closest('[data-dockkit-strip]') ?? document
      for (const el of strip.querySelectorAll('[data-dockkit-split-button], [data-sidebar-right-mode]')) {
        const rect = el.getBoundingClientRect()
        if (rect.width === 0) continue
        if (rect.left < left) left = rect.left
      }
      return Math.max(CLOSED_RIGHT, Math.round(width - left + GAP))
    }

    /** The node the frame renders only while the rail is closed. */
    const railMarker = () => document.querySelector('[data-sidebar-right-expand]')

    /** Write the offset; only touches the DOM when the number moved. */
    const sync = () => {
      const seat = document.querySelector('.dsh-restart-seat')
      if (seat === null) return
      const next = `${seatRight()}px`
      if (seat.style.right !== next) seat.style.right = next
    }

    let chase = 0

    /**
     * Chase the rail while it slides.
     *
     * The marker swaps the instant the rail starts moving, so sampling the
     * control group's rect for a beat afterwards makes the seat travel with
     * the buttons. Measuring once leaves the seat parked on its old offset
     * until the slide ends and then teleports it; measuring for the whole
     * slide is what reads as one smooth move.
     *
     * @param ms - how long the rail is expected to keep moving.
     */
    const follow = (ms) => {
      if (chase !== 0) cancelAnimationFrame(chase)
      const until = performance.now() + ms
      const tick = () => {
        sync()
        chase = performance.now() < until ? requestAnimationFrame(tick) : 0
      }
      tick()
    }

    let railClosed = railMarker() !== null
    const watcher = new MutationObserver(() => {
      const closed = railMarker() !== null
      if (closed === railClosed) return
      railClosed = closed
      follow(900)
    })
    watcher.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', () => follow(400))

    // The marker only swaps once React commits, which is already after the
    // press. Starting the chase on the press itself means the seat samples on
    // the frame the rail starts to move, not on the frame after.
    const RAIL_SEATS = '[data-sidebar-right-expand], [data-sidebar-right-toggle], [data-sidebar-right-mode], [data-dockkit-split-button]'
    document.addEventListener('pointerdown', (event) => {
      const target = event.target
      if (target instanceof Element && target.closest(RAIL_SEATS) !== null) follow(900)
    }, true)

    // The seat is mounted after this half runs; give it the first layout.
    follow(600)

    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'dsh-restart.seat',
      order: 100,
      locale: NS,
      inject: () => ({ restart }),
    }, RestartButton))
  }

  rt.ctx.inject(['slots', 'locale', 'uiSession'], (scope) => install(scope))
}
