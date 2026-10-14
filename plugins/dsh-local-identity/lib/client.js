/**
 * dsh-local-identity — browser half.
 *
 * Two surfaces, one source of truth:
 *
 *   1. the sidebar account chip (the launcher at the bottom of the sidebar,
 *      which ships the DeepSeek account's name and picture) is rewritten to
 *      show this machine's own identity;
 *   2. a row in Settings → General edits that identity — the nickname and the
 *      avatar — through the settings seam, so the values persist in the profile
 *      configuration the rest of the harness already writes.
 *
 * Where the values come from: the row reads and writes them through
 * `ctx.configForms.get('dsh-local-identity')`, the browser face of the Host
 * settings document. The chip renders the Host's *resolved* view instead
 * (`/dsh-local-identity/identity.json`), because a local avatar becomes a
 * served URL that only the Host can compute — including the version token that
 * makes a replaced image reload. Both read the same configuration, so they
 * cannot disagree.
 *
 * Why the chip is DOM work instead of a slot: the launcher seat
 * (`settings.launcher`) is a single-occupant slot occupied by the shipped
 * `AccountMenu`, so registering there would replace the whole menu, including
 * the sign-out flow this plugin has no business reimplementing. The chip is
 * rewritten in place instead, and the `MutationObserver` puts the local
 * identity back whenever React writes the account's own values again.
 *
 * Anchors, in order of stability: the launcher's slot wrapper
 * (`[data-slot="settings.launcher"]`) plus the chip's own state attributes
 * (`data-collapsed`, `aria-haspopup="menu"`), both shipped contract rather than
 * CSS-module hashes. The class-name *suffixes* below (`_avatar`, `_label`) are
 * hashed per build, so they are matched as substrings and used only to find the
 * two seats inside the chip.
 */

window.__ModuleLoader__.load({
  id: 'dsh-local-identity',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    /** Locale namespace for the row's copy; also this plugin's settings namespace. */
    const NS = 'local-identity'

    /** Profile entry id: the settings namespace this plugin owns. */
    const ENTRY_ID = 'dsh-local-identity'

    /** Identity document served by this plugin's host half. */
    const IDENTITY_URL = '/dsh-local-identity/identity.json'

    /** How often the page re-reads the identity, so an avatar swap lands on its own. */
    const REFRESH_MS = 30_000

    /** The launcher's slot wrapper: the sidebar renders it around the account chip. */
    const LAUNCHER_SLOT = '[data-slot="settings.launcher"]'

    /** The chip's own shipped attributes; the account launcher is the only element carrying both. */
    const CHIP_SELECTOR = 'button[data-collapsed][aria-haspopup="menu"]'

    /** Attribute marks, so this plugin's own nodes are never mistaken for the shipped ones. */
    const CHIP_MARK = 'data-dsh-local-identity-chip'
    const AVATAR_HOST_MARK = 'data-dsh-local-identity-avatar-host'
    const AVATAR_IMAGE_MARK = 'data-dsh-local-identity-image'
    const AVATAR_INITIAL_MARK = 'data-dsh-local-identity-initial'

    /** Copy, in the shape `ctx.locale.register` takes. */
    const zh = {
      title: '本地身份',
      description: '侧栏左下角显示的名字与头像。昵称留空时显示“未配置用户昵称”。',
      nickname: '昵称',
      nicknamePlaceholder: '未配置用户昵称',
      avatar: '头像',
      avatarPlaceholder: '未配置头像，可填本机路径、http(s) 地址或 data: URL',
      avatarUnreadable: '读不到这个头像文件',
      saveFailed: '保存失败，请重试',
      unavailable: '这台机器上没有可写的设置文档，名字与头像只能在回环地址的页面上编辑。',
    }
    const en = {
      title: 'Local identity',
      description: 'The name and avatar shown in the sidebar. An empty nickname reads “No nickname configured”.',
      nickname: 'Nickname',
      nicknamePlaceholder: 'No nickname configured',
      avatar: 'Avatar',
      avatarPlaceholder: 'No avatar configured — a local path, http(s), or data: URL',
      avatarUnreadable: 'That avatar file cannot be read',
      saveFailed: 'Could not save; try again',
      unavailable: 'No writable settings document on this machine; edit the name and avatar from a loopback page.',
    }

    /** Fallback for the chip's placeholder before the locale service binds. */
    const FALLBACK_UNCONFIGURED = '未配置用户昵称'

    /** Stylesheet for the chip rewrite; the row uses the `dli-` classes below. */
    const STYLESHEET = `
[${AVATAR_HOST_MARK}] > :not([${AVATAR_IMAGE_MARK}]):not([${AVATAR_INITIAL_MARK}]) { display: none !important; }
[${AVATAR_IMAGE_MARK}] { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; }
[${AVATAR_INITIAL_MARK}] { width: 100%; height: 100%; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-secondary, currentColor); font-size: 12px; line-height: 1; user-select: none; }
.dli-row { display: flex; align-items: center; gap: 8px; padding: 16px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dli-rowText { display: flex; flex-direction: column; flex: 1; gap: 4px; min-width: 0; padding-right: 24px; }
.dli-title { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 400; line-height: 22px; }
.dli-desc { color: var(--dsw-alias-label-tertiary); font-size: 12px; font-weight: 400; line-height: 18px; }
.dli-note { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-tertiary)); font-size: 12px; font-weight: 400; line-height: 18px; }
.dli-control { display: inline-flex; align-items: center; gap: 10px; flex: none; }
.dli-fields { display: flex; flex-direction: column; gap: 8px; }
.dli-input { width: 240px; }
.dli-preview { flex: none; width: 40px; height: 40px; border-radius: 50%; overflow: hidden; background: var(--dsw-alias-bg-skeleton); display: flex; align-items: center; justify-content: center; }
.dli-previewImage { width: 100%; height: 100%; object-fit: cover; display: block; }
.dli-previewInitial { color: var(--dsw-alias-label-secondary, currentColor); font-size: 16px; line-height: 1; user-select: none; }
`

    /** The host's resolved identity; the chip and the row's preview both render this. */
    const identityStore = createSnapshotStore({ name: null, avatarUrl: null, avatarError: null })

    /** Chip label resolver, rebound once the locale service is available. */
    let label = (key) => (key === 'chipUnconfigured' ? FALLBACK_UNCONFIGURED : key)

    /** Frame-coalesced re-application, shared by the observer and the identity reads. */
    let schedule = () => {}

    /** The chip candidates on the page: the shipped account launcher in each sidebar occurrence. */
    function chips() {
      const scoped = document.querySelectorAll(`${LAUNCHER_SLOT} ${CHIP_SELECTOR}`)
      if (scoped.length > 0) return [...scoped]
      // The slot wrapper is how the sidebar renders the launcher; without it the
      // chip is still recognisable by its avatar seat, which the signed-out row
      // does not have.
      return [...document.querySelectorAll(CHIP_SELECTOR)].filter((chip) => chip.querySelector('[class*="_avatar"]') !== null)
    }

    /** Whether this chip shows an account identity rather than the signed-out More row. */
    function showsIdentity(chip) {
      return chip.getAttribute('data-signed-out') !== 'true'
    }

    /** The first character of a name, for the avatar placeholder. */
    function initialOf(name) {
      if (name === null) return null
      const characters = Array.from(name.trim())
      return characters.length > 0 ? characters[0] : null
    }

    /**
     * Find the chip's text label.
     *
     * The shipped label span carries the `_label` class; the fallback covers a
     * build that renames it, and skips this plugin's own nodes by mark.
     *
     * @param chip - the account launcher button.
     * @returns the label element, or `null` when the chip renders no label (collapsed sidebar).
     */
    function labelOf(chip) {
      const shipped = chip.querySelector('[class*="_label"]')
      if (shipped !== null) return shipped
      const spans = [...chip.querySelectorAll('span')].filter((span) =>
        span.querySelector('*') === null
        && span.getAttribute(AVATAR_INITIAL_MARK) === null
        && span.textContent.trim() !== '')
      return spans.length > 0 ? spans[spans.length - 1] : null
    }

    /** Write the configured name — or the unconfigured placeholder — over the chip's label. */
    function applyLabel(chip) {
      const identity = identityStore.getSnapshot()
      const wanted = identity.name ?? label('chipUnconfigured')
      const target = labelOf(chip)
      if (target === null || target.textContent === wanted) return
      target.textContent = wanted
    }

    /**
     * Put the resolved avatar into the chip's avatar seat.
     *
     * The seat is the shipped 24px circle; React's own child inside it is hidden
     * by the stylesheet rather than removed, so React keeps updating a node it
     * still owns. Without a usable avatar the first character of the configured
     * name stands in, and with no name either the seat keeps only its neutral
     * background — the chip never falls back to the account's own picture.
     *
     * @param chip - the account launcher button.
     */
    function applyAvatar(chip) {
      const host = chip.querySelector('[class*="_avatar"]')
      if (host === null) return
      const identity = identityStore.getSnapshot()
      const initial = identity.avatarUrl === null ? initialOf(identity.name) : null

      host.setAttribute(AVATAR_HOST_MARK, '')
      const image = host.querySelector(`[${AVATAR_IMAGE_MARK}]`)
      const placeholder = host.querySelector(`[${AVATAR_INITIAL_MARK}]`)

      if (identity.avatarUrl !== null) {
        if (placeholder !== null) placeholder.remove()
        if (image === null) {
          host.insertBefore(createAvatarImage(identity.avatarUrl), host.firstChild)
          return
        }
        if (image.getAttribute('src') !== identity.avatarUrl) image.setAttribute('src', identity.avatarUrl)
        return
      }

      if (image !== null) image.remove()
      if (initial === null) {
        if (placeholder !== null) placeholder.remove()
        return
      }
      if (placeholder === null) {
        const created = document.createElement('span')
        created.setAttribute(AVATAR_INITIAL_MARK, '')
        created.textContent = initial
        host.insertBefore(created, host.firstChild)
        return
      }
      if (placeholder.textContent !== initial) placeholder.textContent = initial
    }

    /** One image element for an avatar URL, carrying the mark the stylesheet keys on. */
    function createAvatarImage(url) {
      const image = document.createElement('img')
      image.setAttribute(AVATAR_IMAGE_MARK, '')
      image.setAttribute('src', url)
      image.alt = ''
      image.draggable = false
      image.referrerPolicy = 'no-referrer'
      return image
    }

    /** One pass over every chip on the page. */
    function applyIdentity() {
      for (const chip of chips()) {
        if (!showsIdentity(chip)) continue
        chip.setAttribute(CHIP_MARK, '')
        applyAvatar(chip)
        applyLabel(chip)
      }
    }

    /** Read the host's identity document and re-apply it. */
    async function refreshIdentity() {
      try {
        const response = await fetch(IDENTITY_URL, { cache: 'no-store', credentials: 'same-origin' })
        if (!response.ok) return
        const payload = await response.json()
        if (payload === null || typeof payload !== 'object' || payload.ok !== true) return
        identityStore.set({
          name: typeof payload.name === 'string' && payload.name !== '' ? payload.name : null,
          avatarUrl: typeof payload.avatarUrl === 'string' && payload.avatarUrl !== '' ? payload.avatarUrl : null,
          avatarError: typeof payload.avatarError === 'string' && payload.avatarError !== '' ? payload.avatarError : null,
        })
        schedule()
      } catch {
        // No host route (the host half is not mounted, or the page is a plain
        // browser outside this harness): the shipped chip stays as it is.
      }
    }

    /** Drop everything this plugin put on the page. */
    function teardownIdentity() {
      for (const node of document.querySelectorAll(`[${AVATAR_IMAGE_MARK}], [${AVATAR_INITIAL_MARK}]`)) node.remove()
      for (const node of document.querySelectorAll(`[${CHIP_MARK}], [${AVATAR_HOST_MARK}]`)) {
        node.removeAttribute(CHIP_MARK)
        node.removeAttribute(AVATAR_HOST_MARK)
      }
    }

    /**
     * Install the stylesheet, the observer and the refresh cycle.
     *
     * @returns the disposer removing all three.
     */
    function installIdentity() {
      const style = document.createElement('style')
      style.setAttribute('data-dsh-local-identity', '')
      style.textContent = STYLESHEET
      document.head.append(style)

      // The observer is chatty while a response streams, so passes collapse into
      // one per frame.
      let scheduled = false
      schedule = () => {
        if (scheduled) return
        scheduled = true
        requestAnimationFrame(() => {
          scheduled = false
          applyIdentity()
        })
      }
      const observer = new MutationObserver(schedule)
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'src', 'data-collapsed', 'data-signed-out'],
      })

      const timer = setInterval(() => { void refreshIdentity() }, REFRESH_MS)
      const onFocus = () => { void refreshIdentity() }
      window.addEventListener('focus', onFocus)

      void refreshIdentity()
      schedule()

      return () => {
        observer.disconnect()
        clearInterval(timer)
        window.removeEventListener('focus', onFocus)
        style.remove()
        teardownIdentity()
      }
    }

    /**
     * Subscribe one component to a config form's snapshots.
     *
     * @param form - a `ctx.configForms.get(id)` handle.
     * @returns the current snapshot, refreshed on every change.
     */
    function useFormSnapshot(form) {
      const [snapshot, setSnapshot] = React.useState(() => form.getSnapshot())
      React.useEffect(() => form.subscribe(() => setSnapshot(form.getSnapshot())), [form])
      return snapshot
    }

    /**
     * The Settings → General row.
     *
     * Two text fields, committed on blur or Enter: an empty field clears the
     * stored value (`unset`), which is how the identity returns to its
     * unconfigured state. Drafts are replaced whenever the stored value moves
     * underneath them, so a save that the Host refused leaves the text in place
     * to be submitted again.
     *
     * @param props - `t` from the row's locale namespace, the config form handle,
     *   and the identity hook supplied through the registration's `hooks`.
     * @returns the row element.
     */
    function LocalIdentityRow({ t, form, useIdentity }) {
      const identity = useIdentity((value) => value)
      const snapshot = useFormSnapshot(form)
      const stored = snapshot.value ?? {}
      const [nickname, setNickname] = React.useState(stored.name ?? '')
      const [avatar, setAvatar] = React.useState(stored.avatar ?? '')
      const [busy, setBusy] = React.useState(false)
      const [failed, setFailed] = React.useState(false)

      React.useEffect(() => { setNickname(stored.name ?? '') }, [stored.name])
      React.useEffect(() => { setAvatar(stored.avatar ?? '') }, [stored.avatar])

      const commit = (field, next) => {
        const value = next.trim()
        if (value === (stored[field] ?? '')) return
        setBusy(true)
        setFailed(false)
        const write = value === '' ? form.unset(field) : form.set(field, value)
        Promise.resolve(write)
          .then((accepted) => {
            if (accepted) void refreshIdentity()
            else setFailed(true)
          })
          .catch(() => setFailed(true))
          .finally(() => setBusy(false))
      }

      const textField = (field, labelKey, value, setValue, placeholder) => h(primitives.Input, {
        key: field,
        className: 'dli-input',
        type: 'text',
        value,
        readOnly: busy,
        placeholder,
        'aria-label': t(labelKey),
        onChange: (event) => setValue(event.target.value),
        onBlur: () => commit(field, value),
        onKeyDown: (event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        },
      })

      const preview = identity.avatarUrl !== null
        ? h('img', { className: 'dli-previewImage', src: identity.avatarUrl, alt: '', draggable: false })
        : h('span', { className: 'dli-previewInitial' }, initialOf(identity.name) ?? '')

      const notes = []
      if (identity.avatarError !== null) notes.push(h('div', { className: 'dli-note', key: 'avatar' }, `${t('avatarUnreadable')}: ${identity.avatarError}`))
      if (failed) notes.push(h('div', { className: 'dli-note', key: 'save' }, t('saveFailed')))

      const fields = snapshot.status === 'unavailable'
        ? h('div', { className: 'dli-note', key: 'unavailable' }, t('unavailable'))
        : h('div', { className: 'dli-fields', key: 'fields' }, [
          textField('name', 'nickname', nickname, setNickname, t('nicknamePlaceholder')),
          textField('avatar', 'avatar', avatar, setAvatar, t('avatarPlaceholder')),
        ])

      return h('div', { className: 'dli-row' }, [
        h('div', { className: 'dli-rowText', key: 'text' }, [
          h('div', { className: 'dli-title', key: 'title' }, t('title')),
          h('div', { className: 'dli-desc', key: 'desc' }, t('description')),
          ...notes,
        ]),
        h('div', { className: 'dli-control', key: 'control' }, [
          h('span', { className: 'dli-preview', key: 'preview' }, preview),
          fields,
        ]),
      ])
    }

    /** The chip needs no client service; the General row waits for its three. */
    const inject = []

    /**
     * Install both surfaces.
     *
     * The chip rewrite is installed unconditionally, so the sidebar shows the
     * local identity even where the settings seam is absent; the General row is
     * registered only once its three services exist.
     *
     * @param ctx - client root context.
     */
    function apply(ctx) {
      const install = () => installIdentity()
      if (document.body !== null) ctx.effect(install, 'local-identity: identity overrides')
      else document.addEventListener('DOMContentLoaded', () => ctx.effect(install, 'local-identity: identity overrides'), { once: true })

      ctx.inject(['locale'], (scope) => {
        scope.effect(() => scope.locale.register(NS, { zh, en }), 'local-identity: dictionaries')
        const translate = scope.locale.bind(NS)
        label = (key) => translate(key === 'chipUnconfigured' ? 'nicknamePlaceholder' : key)
        schedule()
      })

      ctx.inject(['slots', 'locale', 'configForms'], (scope) => {
        const form = scope.configForms.get(ENTRY_ID)
        scope.slots.inject('settings.general.item', () => scope.slots.register({
          name: 'settings.general.item',
          id: NS,
          order: 12,
          locale: NS,
          inject: () => ({
            form,
            hooks: { identity: identityStore },
          }),
        }, LocalIdentityRow))
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
