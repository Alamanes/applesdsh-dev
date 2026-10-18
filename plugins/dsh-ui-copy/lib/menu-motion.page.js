/**
 * dsh-ui-copy — the menu motion page script.
 *
 * The behaviour half of the menu component; `menu-motion.css` beside it is the
 * look. The host half inlines both into every index response, so editing this
 * file and reloading the page is enough.
 *
 * What it drives
 *   The enter half is a CSS animation, and React mounts a menu with the
 *   animation already running. The script only decides when it is safe to
 *   reveal: MenuSurface mounts its surface `visibility: hidden` at the origin
 *   until `useLayoutEffect` has measured the anchor and written the final
 *   `left` / `top`, so the script holds the menu at `opacity: 0` until the
 *   surface is visible and then hands it to the sheet.
 *
 *   The leave half needs a clone, because React unmounts a closed menu rather
 *   than giving it a departing state. Closing therefore copies the menu — and
 *   the backing plate the macOS shell draws under a translucent menu — into a
 *   fixed, inert layer at the geometry the menu had on its last frame, and the
 *   sheet fades that copy out. The live menu is gone either way; the copy only
 *   covers the length of the fade.
 *
 * Anchors
 *   `[data-menu-material="translucent"][role="menu"]` is the attribute pair
 *   MenuSurface writes on a menu surface, portal or not; `[data-menu-backing]`
 *   is the plate it portals to the document body; the two carry the same
 *   `--dsh-menu-anchor` value, which is what pairs a menu with its plate.
 *
 * Failure posture
 *   Every measurement is best effort. A menu that never becomes visible is
 *   revealed after a frame budget, a menu removed without a recorded frame
 *   simply disappears, and any error leaves the menus themselves untouched.
 */

(() => {
  'use strict'

  const FLAG = '__dshUiCopyMenuMotion'
  if (globalThis[FLAG] === true) return
  globalThis[FLAG] = true

  /** MenuSurface's own marker pair: set on every menu surface it renders. */
  const MENU_SELECTOR = '[data-menu-material="translucent"][role="menu"]'
  /** The plate the macOS shell draws under a translucent menu. */
  const BACKING_SELECTOR = '[data-menu-backing]'
  /** CSS-module local of the primitives package; a submenu opens sideways. */
  const SUBMENU_HINT = '_submenu_'

  /** State attributes; the sheet is written against these three. */
  const ENTER_ATTR = 'data-dsh-ui-copy-enter'
  const LEAVE_ATTR = 'data-dsh-ui-copy-leave'
  const BACKING_LEAVE_ATTR = 'data-dsh-ui-copy-leave-backing'
  const LAYER_ATTR = 'data-dsh-ui-copy-ghost'

  /** Motion constants the variables in the sheet default to. */
  const ENTER_MS = 170
  const EXIT_MS = 130
  const ENTER_SCALE = 0.96
  const ENTER_SHIFT = 6
  /** Frames a mounting menu may stay hidden before the script reveals it anyway. */
  const REVEAL_BUDGET = 20

  /** True while the platform asks for motion to be reduced. */
  const quietMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

  /**
   * Last known geometry of every open menu, refreshed once per frame while at
   * least one is open. The frame before the unmount is the only chance to learn
   * where the menu was, so the tracking loop is what makes a positioned clone
   * possible at all.
   */
  const open = new Map()
  let tracking = false

  /** Menus that already took the enter pass; a node moved by React is not a new menu. */
  const welcomed = new WeakSet()

  const track = () => {
    if (tracking) return
    tracking = true
    const step = () => {
      for (const [menu] of open) {
        if (menu.isConnected) open.set(menu, menu.getBoundingClientRect())
        else open.delete(menu)
      }
      if (open.size === 0) {
        tracking = false
        return
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  /**
   * The control the user last pressed. A menu reads as growing out of whatever
   * opened it, and this is the only handle on that control: a portal menu is a
   * sibling of the whole application, not of its trigger.
   */
  let pressed = null

  const remember = (node) => {
    if (!(node instanceof Element)) return
    // A press inside a menu chooses an item; it says nothing about where the
    // next menu will open from, so the previous opener stays in place.
    if (node.closest('[role="menu"]') !== null) return
    pressed = node.closest('button, [role="button"], [aria-haspopup]')
  }

  document.addEventListener('pointerdown', (event) => remember(event.target), true)
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
    remember(document.activeElement)
  }, true)

  /**
   * The edge a menu grows from, as `transform-origin` plus the offset it
   * travels. A submenu comes in from the side of its parent row; a dropdown
   * comes out of its trigger when the trigger is known, and out of the nearer
   * viewport edge when it is not.
   *
   * @param menu - the surface about to be revealed.
   * @param rect - its geometry, measured once it is visible.
   */
  function entryFor(menu, rect) {
    if (menu.matches(`[class*="${SUBMENU_HINT}"]`)) {
      return { origin: 'left center', x: '-4px', y: '0' }
    }
    const opener = pressed !== null && pressed.isConnected && !menu.contains(pressed)
      ? pressed.getBoundingClientRect()
      : null
    const above = opener !== null
      ? rect.bottom <= opener.top + 2
      : rect.top + rect.height / 2 > window.innerHeight / 2
    return above
      ? { origin: 'center bottom', x: '0', y: `${ENTER_SHIFT}px` }
      : { origin: 'center top', x: '0', y: `-${ENTER_SHIFT}px` }
  }

  /**
   * Reveal a menu through the enter animation.
   *
   * The menu is held invisible from the moment it is seen, so the first paint
   * never shows a surface sitting at the origin. The hold is lifted on the
   * frame the surface turns visible — that is, the frame React has finished
   * placing it — or after {@link REVEAL_BUDGET} frames, whichever comes first,
   * so a menu whose visibility never changes cannot be left hidden.
   *
   * @param menu - the mounted menu surface.
   */
  function enter(menu) {
    if (quietMotion() || welcomed.has(menu)) return
    welcomed.add(menu)
    open.set(menu, menu.getBoundingClientRect())
    track()

    // Hold both halves of the surface — the menu and the plate the macOS shell
    // draws under it — until React has placed them: the mount frame renders
    // both hidden at the origin, and revealing that frame would flash the
    // corner of the screen. The plate is looked up per frame until it is found,
    // because the two are separate portal children.
    let plate = null
    const hold = () => {
      if (plate !== null && plate.isConnected) return
      plate = backingFor(menu)
      if (plate !== null) plate.style.opacity = '0'
    }
    hold()
    menu.style.opacity = '0'

    let revealed = false
    let frames = 0

    const reveal = () => {
      if (revealed) return
      revealed = true
      const spot = entryFor(menu, menu.getBoundingClientRect())
      for (const surface of [menu, plate]) {
        if (surface === null) continue
        surface.style.setProperty('--dsh-ui-copy-menu-origin', spot.origin)
        surface.style.setProperty('--dsh-ui-copy-menu-enter-x', spot.x)
        surface.style.setProperty('--dsh-ui-copy-menu-enter-y', spot.y)
        surface.style.setProperty('--dsh-ui-copy-menu-enter-scale', String(ENTER_SCALE))
        surface.style.setProperty('--dsh-ui-copy-menu-enter-duration', `${ENTER_MS}ms`)
        surface.style.opacity = ''
        surface.setAttribute(ENTER_ATTR, '')
        surface.addEventListener('animationend', (event) => {
          if (event.target === surface && event.animationName === 'dsh-ui-copy-menu-in') surface.removeAttribute(ENTER_ATTR)
        }, { once: true })
      }
    }

    const wait = () => {
      if (revealed) return
      hold()
      if (window.getComputedStyle(menu).visibility !== 'hidden' || ++frames > REVEAL_BUDGET) reveal()
      else requestAnimationFrame(wait)
    }
    requestAnimationFrame(wait)
  }

  /** The backing plate paired with a menu, matched through the anchor variable both carry. */
  function backingFor(menu) {
    const anchor = menu.style.getPropertyValue('--dsh-menu-anchor')
    if (anchor === '') return null
    for (const plate of document.querySelectorAll(BACKING_SELECTOR)) {
      if (plate.style.getPropertyValue('--dsh-menu-anchor') === anchor) return plate
    }
    return null
  }

  /** The layer every departing clone lives in, created on first use. */
  function ghostLayer() {
    const existing = document.body.querySelector(`[${LAYER_ATTR}]`)
    if (existing !== null) return existing
    const layer = document.createElement('div')
    layer.setAttribute(LAYER_ATTR, '')
    layer.setAttribute('aria-hidden', 'true')
    document.body.appendChild(layer)
    return layer
  }

  /**
   * Copy a box onto a fixed, inert clone in the ghost layer.
   *
   * @param clone - the element to place.
   * @param rect - the geometry to place it at.
   * @param depth - stacking order inside the layer, lowest first.
   */
  function place(clone, rect, depth) {
    clone.removeAttribute(ENTER_ATTR)
    clone.removeAttribute('id')
    // A clone is not a live plate: leaving the marker on would let the next
    // menu pair itself with this copy instead of the real one.
    clone.removeAttribute('data-menu-backing')
    clone.style.position = 'fixed'
    clone.style.left = `${rect.left}px`
    clone.style.top = `${rect.top}px`
    clone.style.width = `${rect.width}px`
    clone.style.height = `${rect.height}px`
    clone.style.margin = '0'
    clone.style.minWidth = '0'
    clone.style.maxWidth = 'none'
    clone.style.maxHeight = 'none'
    clone.style.zIndex = String(depth)
    clone.style.pointerEvents = 'none'
    clone.style.visibility = 'visible'
    clone.style.setProperty('--dsh-ui-copy-menu-exit-duration', `${EXIT_MS}ms`)
    // A clone is never an anchor target: the live menu it copies is gone, and a
    // duplicated anchor name would make the plate resolve against the wrong box.
    clone.style.setProperty('anchor-name', 'none')
    clone.style.setProperty('position-anchor', 'auto')
    return clone
  }

  /**
   * Fade a departing menu out on the geometry of its last frame.
   *
   * @param menu - the menu just removed from the document.
   * @param rect - its last recorded geometry.
   * @param backing - its backing plate, still readable, or null.
   */
  function leave(menu, rect, backing) {
    const layer = ghostLayer()
    const plate = backing === null ? null : place(backing.cloneNode(true), rect, 0)
    if (plate !== null) {
      plate.setAttribute(BACKING_LEAVE_ATTR, '')
      // The plate only fades: scaling it would open a seam against the menu.
      plate.style.setProperty('--dsh-ui-copy-menu-exit-scale', '1')
      layer.appendChild(plate)
    }

    const clone = place(menu.cloneNode(true), rect, 1)
    clone.setAttribute(LEAVE_ATTR, '')
    clone.style.setProperty('--dsh-ui-copy-menu-exit-scale', '0.98')
    layer.appendChild(clone)

    let cleaned = false
    const finish = () => {
      if (cleaned) return
      cleaned = true
      plate?.remove()
      clone.remove()
      if (layer.childElementCount === 0) layer.remove()
    }
    clone.addEventListener('animationend', (event) => {
      if (event.target === clone && event.animationName === 'dsh-ui-copy-menu-out') finish()
    }, { once: true })
    // The animation event is the normal path; this covers a clone whose
    // animation never started, for instance when the layer was detached.
    window.setTimeout(finish, EXIT_MS + 400)
  }

  /**
   * Route one added or removed node to the enter or leave pass.
   *
   * A node that is itself a menu is handled alone: its own submenus travel with
   * it, and a ghost of the outer menu already covers them.
   */
  function visit(node, handle) {
    if (!(node instanceof Element)) return
    if (node.matches(MENU_SELECTOR)) {
      handle(node)
      return
    }
    for (const nested of node.querySelectorAll(MENU_SELECTOR)) handle(nested)
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) visit(node, enter)
      for (const node of record.removedNodes) {
        visit(node, (menu) => {
          const rect = open.get(menu) ?? null
          open.delete(menu)
          if (rect === null || rect.width === 0 || quietMotion()) return
          leave(menu, rect, backingFor(menu))
        })
      }
    }
  })

  observer.observe(document.documentElement, { childList: true, subtree: true })
})()
