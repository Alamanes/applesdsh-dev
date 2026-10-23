/**
 * dsh-ui-copy component — identity (migrated from `dsh-local-identity`).
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
 * Where the values come from: the row reads and writes them through the
 * settings seam. In the suite the owning profile row is `ui-copy`, so the
 * fields live under its `identity` block (`identity.name`, `identity.avatar`);
 * the legacy `dsh-local-identity` entry is still read as a fallback, so an
 * un-migrated profile keeps an editable row. The chip renders the Host's
 * *resolved* view instead (`/dsh-ui-copy/identity.json`), because a local avatar
 * becomes a served URL that only the Host can compute — including the version
 * token that makes a replaced image reload. Both read the same configuration,
 * so they cannot disagree.
 *
 * Why the chip is DOM work instead of a slot: the launcher seat
 * (`settings.launcher`) is a single-occupant slot occupied by the shipped
 * `AccountMenu`, so registering there would replace the whole menu, including
 * the sign-out flow this component has no business reimplementing. The chip is
 * rewritten in place instead, and the suite's shared observer puts the local
 * identity back whenever React writes the account's own values again.
 *
 * Anchors, in order of stability: the launcher's slot wrapper
 * (`[data-slot="settings.launcher"]`) plus the chip's own state attributes
 * (`data-collapsed`, `aria-haspopup="menu"`), both shipped contract rather than
 * CSS-module hashes. The class-name *suffixes* below (`_avatar`, `_label`) are
 * hashed per build, so they are matched as substrings and used only to find the
 * two seats inside the chip.
 */
function dshuiComponent_identity(rt) {
  const React = rt.require('react')
  if (React === null || typeof React.createElement !== 'function') {
    rt.warn('react is not in this boot graph; component skipped')
    return
  }

  const storeModule = rt.require('@deepseek-ai/dsh-client-store')
  if (storeModule === null || typeof storeModule.createSnapshotStore !== 'function') {
    rt.warn('@deepseek-ai/dsh-client-store is not in this boot graph; component skipped')
    return
  }

  const primitives = rt.require('@deepseek-ai/dsh-client-ui-primitives')
  if (primitives === null) {
    rt.warn('@deepseek-ai/dsh-client-ui-primitives is not in this boot graph; component skipped')
    return
  }

  const createSnapshotStore = storeModule.createSnapshotStore
  const h = React.createElement

  /** Locale namespace for the row's copy; also this component's settings namespace. */
  const NS = 'local-identity'

  /**
   * Profile entry id the row writes to: the suite's own row, whose `identity`
   * block `lib/host/identity.js` reads. The identifier and the namespace name
   * stay as they were, so the row's copy and slot id keep matching the shipped
   * settings namespace.
   */
  const ENTRY_ID = 'ui-copy'

  /** Pre-suite entry id, kept as a read/write fallback for an un-migrated profile. */
  const LEGACY_ENTRY_ID = 'dsh-local-identity'

  /** Path inside the suite entry's config where the identity fields live. */
  const IDENTITY_PREFIX = ['identity']

  /** Identity document served by this component's host half. */
  const IDENTITY_URL = '/dsh-ui-copy/identity.json'

  /** How often the page re-reads the identity, so an avatar swap lands on its own. */
  const REFRESH_MS = 30_000

  /** The launcher's slot wrapper: the sidebar renders it around the account chip. */
  const LAUNCHER_SLOT = '[data-slot="settings.launcher"]'

  /** The chip's own shipped attributes; the account launcher is the only element carrying both. */
  const CHIP_SELECTOR = 'button[data-collapsed][aria-haspopup="menu"]'

  /** Attribute marks, so this component's own nodes are never mistaken for the shipped ones. */
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

  /**
   * Stylesheet for the chip rewrite and the row's `dli-` classes.
   *
   * Every visual value is a `--dshui-*` role, so the row follows the active
   * theme and the profile's token overrides like every other component in the
   * suite. The element marks stay local to this component.
   */
  const STYLESHEET = `
[${AVATAR_HOST_MARK}] > :not([${AVATAR_IMAGE_MARK}]):not([${AVATAR_INITIAL_MARK}]) { display: none !important; }
[${AVATAR_IMAGE_MARK}] { width: 100%; height: 100%; border-radius: var(--dshui-radius-circle); object-fit: cover; display: block; }
[${AVATAR_INITIAL_MARK}] { width: 100%; height: 100%; border-radius: var(--dshui-radius-circle); display: flex; align-items: center; justify-content: center; color: var(--dshui-text-secondary); font-size: var(--dshui-text-size-sm); line-height: 1; user-select: none; }
.dli-row { display: flex; align-items: center; gap: var(--dshui-space-4); padding: var(--dshui-space-6) 0; border-bottom: var(--dshui-border-width) solid var(--dshui-border-2); }
.dli-rowText { display: flex; flex-direction: column; flex: 1; gap: var(--dshui-space-2); min-width: 0; padding-right: var(--dshui-space-7); }
.dli-title { color: var(--dshui-text-primary); font-size: var(--dshui-text-size-base); font-weight: var(--dshui-weight-regular); line-height: var(--dshui-line-normal); }
.dli-desc { color: var(--dshui-text-tertiary); font-size: var(--dshui-text-size-sm); font-weight: var(--dshui-weight-regular); line-height: var(--dshui-line-normal); }
.dli-note { color: var(--dshui-danger); font-size: var(--dshui-text-size-sm); font-weight: var(--dshui-weight-regular); line-height: var(--dshui-line-normal); }
.dli-control { display: inline-flex; align-items: center; gap: var(--dshui-space-5); flex: none; }
.dli-fields { display: flex; flex-direction: column; gap: var(--dshui-space-4); }
.dli-input { width: 240px; }
.dli-preview { flex: none; width: 40px; height: 40px; border-radius: var(--dshui-radius-circle); overflow: hidden; background: var(--dshui-neutral-fill-sunken); display: flex; align-items: center; justify-content: center; }
.dli-previewImage { width: 100%; height: 100%; object-fit: cover; display: block; }
.dli-previewInitial { color: var(--dshui-text-secondary); font-size: var(--dshui-text-size-xl); line-height: 1; user-select: none; }
`

  /** The host's resolved identity; the chip and the row's preview both render this. */
  const identityStore = createSnapshotStore({ name: null, avatarUrl: null, avatarError: null })

  /** Chip label resolver, rebound once the locale service is available. */
  let label = (key) => (key === 'chipUnconfigured' ? FALLBACK_UNCONFIGURED : key)

  /**
   * One shared-sweep request, rebound by {@link installIdentity}.
   *
   * The suite owns the single observer and its one-frame budget, so a pass
   * never schedules itself; {@link refreshIdentity} asks for the next sweep
   * through this handle.
   */
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
   * build that renames it, and skips this component's own nodes by mark.
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

  /** Drop everything this component put on the page. */
  function teardownIdentity() {
    for (const node of document.querySelectorAll(`[${AVATAR_IMAGE_MARK}], [${AVATAR_INITIAL_MARK}]`)) node.remove()
    for (const node of document.querySelectorAll(`[${CHIP_MARK}], [${AVATAR_HOST_MARK}]`)) {
      node.removeAttribute(CHIP_MARK)
      node.removeAttribute(AVATAR_HOST_MARK)
    }
  }

  /**
   * Install the stylesheet, the shared sweep and the refresh cycle.
   *
   * The sheet is registered under this component's id, and the sweep is one
   * pass in the suite's single observer — the attribute filter the old plugin
   * narrowed on (`class`, `src`, `data-collapsed`, `data-signed-out`) is not
   * expressible through `rt.observe`, so the pass simply runs on every sweep
   * and re-applies only what moved.
   *
   * @returns the disposer removing every part of it.
   */
  function installIdentity() {
    const paint = rt.style('identity', STYLESHEET)

    schedule = rt.schedule
    const unobserve = rt.observe(applyIdentity)

    const timer = setInterval(() => { void refreshIdentity() }, REFRESH_MS)
    const onFocus = () => { void refreshIdentity() }
    window.addEventListener('focus', onFocus)

    void refreshIdentity()
    schedule()

    return () => {
      unobserve()
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      paint()
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
   * Resolve one settings entry's form handle.
   *
   * `null` is every shape of "no editable settings on this page": the seam
   * absent, the handle shaped differently after a release, or the lookup
   * itself throwing. Callers keep the built-in defaults in that case.
   *
   * @param scope - a context with `configForms` injected.
   * @param entryId - the profile entry id to open.
   * @returns the form handle, or null.
   */
  function configFormOf(scope, entryId) {
    try {
      const forms = scope.configForms
      if (forms === undefined || forms === null || typeof forms.get !== 'function') return null
      const form = forms.get(entryId)
      if (form === undefined || form === null || typeof form.getSnapshot !== 'function') return null
      return form
    } catch {
      return null
    }
  }

  /**
   * The identity fields a snapshot carries.
   *
   * @param snapshot - `form.getSnapshot()`.
   * @param prefix - `['identity']` for the suite entry, `[]` for the legacy one.
   * @returns `{ name, avatar }`, either field possibly `undefined`.
   */
  function identityFieldsOf(snapshot, prefix) {
    const value = snapshot !== null && typeof snapshot === 'object' && snapshot.value !== null && typeof snapshot.value === 'object'
      ? snapshot.value
      : {}
    const scope = prefix.length === 0 ? value : value[prefix[0]]
    return scope !== null && typeof scope === 'object' ? scope : {}
  }

  /**
   * Write one identity field through the form.
   *
   * A legacy top-level field keeps the original `set`/`unset` calls; the suite
   * entry's fields live one level down, so they go through the atomic path
   * mutation instead — an empty value removes the key rather than storing an
   * empty string, which is what returns the chip to its unconfigured state.
   *
   * @param form - the form handle the row writes through.
   * @param prefix - path segments before the field name.
   * @param field - `name` or `avatar`.
   * @param value - the trimmed value, `''` meaning clear.
   * @returns the form's write promise.
   */
  function writeIdentityField(form, prefix, field, value) {
    if (prefix.length === 0) return value === '' ? form.unset(field) : form.set(field, value)
    const path = [...prefix, field]
    return form.mutate([value === '' ? { op: 'unset', path } : { op: 'set', path, value }])
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
   * The suite entry is the live source; the legacy entry is used only while
   * the suite entry is not served (an un-migrated profile), so the row keeps
   * working with the same semantics in both shapes.
   *
   * @param props - `t` from the row's locale namespace, the suite entry's form,
   *   the legacy entry's form, the host-injected identity seed, and the
   *   identity hook supplied through the registration's `hooks`.
   * @returns the row element.
   */
  function LocalIdentityRow({ t, form, legacy, fallback, useIdentity }) {
    const identity = useIdentity((value) => value)
    const snapshot = useFormSnapshot(form)
    const legacySnapshot = useFormSnapshot(legacy)
    const primary = snapshot.status === 'ready' || legacySnapshot.status !== 'ready'
    const active = primary
      ? { form, prefix: IDENTITY_PREFIX, snapshot }
      : { form: legacy, prefix: [], snapshot: legacySnapshot }
    const stored = identityFieldsOf(active.snapshot, active.prefix)
    const [nickname, setNickname] = React.useState(stored.name ?? fallback.name)
    const [avatar, setAvatar] = React.useState(stored.avatar ?? fallback.avatar)
    const [busy, setBusy] = React.useState(false)
    const [failed, setFailed] = React.useState(false)

    React.useEffect(() => { setNickname(stored.name ?? fallback.name) }, [stored.name, fallback.name])
    React.useEffect(() => { setAvatar(stored.avatar ?? fallback.avatar) }, [stored.avatar, fallback.avatar])

    const commit = (field, next) => {
      const value = next.trim()
      if (value === (stored[field] ?? '')) return
      setBusy(true)
      setFailed(false)
      const write = writeIdentityField(active.form, active.prefix, field, value)
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

    const fields = active.snapshot.status === 'unavailable'
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
    const fallback = {
      name: typeof rt.config.name === 'string' ? rt.config.name : '',
      avatar: typeof rt.config.avatar === 'string' ? rt.config.avatar : '',
    }

    const install = () => installIdentity()
    if (document.body !== null) rt.effect(install, 'ui-copy/identity: identity overrides')
    else document.addEventListener('DOMContentLoaded', () => rt.effect(install, 'ui-copy/identity: identity overrides'), { once: true })

    ctx.inject(['locale'], (scope) => {
      scope.effect(() => scope.locale.register(NS, { zh, en }), 'ui-copy/identity: dictionaries')
      const translate = scope.locale.bind(NS)
      label = (key) => translate(key === 'chipUnconfigured' ? 'nicknamePlaceholder' : key)
      schedule()
    })

    ctx.inject(['slots', 'locale', 'configForms'], (scope) => {
      const form = configFormOf(scope, ENTRY_ID)
      if (form === null) return
      const legacy = configFormOf(scope, LEGACY_ENTRY_ID) ?? form
      scope.slots.inject('settings.general.item', () => scope.slots.register({
        name: 'settings.general.item',
        id: NS,
        order: 12,
        locale: NS,
        inject: () => ({
          form,
          legacy,
          fallback,
          hooks: { identity: identityStore },
        }),
      }, LocalIdentityRow))
    })
  }

  apply(rt.ctx)
}
