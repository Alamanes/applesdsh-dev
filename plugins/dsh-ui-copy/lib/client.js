/**
 * dsh-ui-copy browser half.
 *
 * Rewrites three pieces of shipped copy without touching the packages that
 * render them:
 *
 *   - the blank-session headline (`hero.headline`, 探索未至之境), replaced by a
 *     line picked from the pool for the active language;
 *   - the composer's empty-state hint, mapped from the sentence React currently
 *     passes down, so the hero and the session states keep their own wording;
 *   - the 预览版 badge, hidden by one CSS rule.
 *
 * Why the DOM instead of the two APIs that look right:
 *
 *   - Locale: `hero.headline` is an entry of the `conversation` namespace, and
 *     `ctx.locale.register()` throws once that namespace already holds a
 *     dictionary for the language. The shipped package always registers first,
 *     so a plugin cannot override the string there.
 *   - Slots: the Hero declares one slot around the headline —
 *     `conversation.hero.brand.mark`, the fish — and the headline text has no
 *     seat of its own. `conversation.composer` is a chain slot, but the blank
 *     state renders it `fallbackOnly`, so chain entries never reach the hero.
 *
 * React owns the original text, so every rewrite is re-applied from a
 * rAF-throttled MutationObserver: React writes the shipped copy again on its own
 * re-renders and the observer puts ours back. Each pass checks the current value
 * before writing, so our own mutations never ping-pong.
 *
 * The composer hint is matched by the shipped sentence rather than by
 * hero-versus-session state. `[data-placeholder]` on the editable surface always
 * carries React's current sentence and is never written here; only the visible
 * bubble and the aria-label that mirrors it are rewritten. That keeps the
 * mapping independent of which variant is mounted, and it follows the language
 * because the shipped sentences differ per language.
 *
 * The same sheet carries the accent override: `accent.light` / `accent.dark`
 * repaint the two accent families the shipped theme publishes on `body` — the
 * neutral brand colour (primary buttons, switches, selected strokes) and the
 * blue business colour (links, focus rings, business badges) — plus the derived
 * ink and hover shades that cannot inherit from those tokens. See
 * {@link accentBlock}.
 *
 * Copy lives in {@link DEFAULTS}. The plugin's cordis config is not readable
 * here: a browser bundle enters the page as a boot-graph row (`{ id, url, rev }`)
 * and is mounted with `{ name: id }` alone, so `apply(ctx, config)` always sees
 * an empty config. The accent therefore comes from the config form the host half
 * declares, `ctx.configForms.get('ui-copy')`, which is the same value the
 * Settings → General row writes; see {@link AccentRow}.
 */

/**
 * Settings namespace and config-form entry id. Both are the loading row's id
 * (`- id: ui-copy`): the entry id names the form, and the namespace names the
 * dictionary the row's text is taken from.
 */
var SETTINGS_NS = 'ui-copy'
var CONFIG_ENTRY_ID = 'ui-copy'

/** Headline label inside the Hero's title group; the badge is its sibling. */
var HEADLINE_SELECTOR = '[class*="titleGroup"] > span:first-child'
/** The 预览版 badge sharing that title group. */
var PREVIEW_BADGE_SELECTOR = '[class*="previewBadge"]'
/** The composer's scrollport: one per mounted composer occurrence. */
var COMPOSER_SCROLL_SELECTOR = '[data-input-scroll]'
/** React's own copy of the current hint, on the editable surface. */
var HINT_SOURCE_SELECTOR = '[data-placeholder]'
/** The visible hint bubble. */
var HINT_BUBBLE_SELECTOR = '[data-composer-placeholder]'

/** Editable copy. Overridable field by field through the plugin's cordis config. */
var DEFAULTS = {
  /**
   * Headline pools keyed by the primary subtag of `<html lang>`, which the
   * locale plugin keeps in sync with the active language. An unknown language
   * falls back to `zh`, then to the first pool given.
   */
  headline: {
    zh: [
      '有什么可以帮你的？',
      '今天想做点什么？',
      '我们来做点什么。',
      '你想从哪里开始？',
      '有什么要交给我？',
      '从一句话开始吧。',
    ],
    en: [
      'What can I help you with?',
      'What are we building today?',
      'Let us make something.',
      'Where would you like to start?',
      'What can I take off your plate?',
      'Start with one sentence.',
    ],
  },
  /**
   * Shipped hint → the lines this plugin shows instead. Each key is one exact
   * shipped sentence, so every state (blank Hero, live session) and every
   * language carries its own pool; a single string is accepted as a one-line
   * pool when the line should not rotate.
   */
  placeholders: {
    '描述你想要构建的内容, / 调用指令, @ 文件或对话': [
      '说点什么，剩下的我来',
      '脑子里那团东西，倒出来吧',
      '别客气，直接开口',
      '想折腾点什么？',
      '一句话就够，剩下的交给我',
      '从随便哪句开始都行',
    ],
    '发消息或创建任务, / 调用指令, @ 文件或对话': [
      '接着聊，我听着',
      '还有呢？继续说',
      '下一句，请',
      '想到什么说什么',
    ],
    'Describe what you want to build, / commands, @ files or sessions': [
      'Say the word, I take it from there',
      'Let us see what is in your head',
      'No need to be polite, just ask',
      'What are we tinkering with?',
      'One sentence is enough',
    ],
    'Message or run a task, / commands, @ files or sessions': [
      'Go on, I am listening',
      'And then?',
      'Your next line, please',
      'Say whatever comes to mind',
    ],
  },
  /**
   * Accent colour per theme. Empty leaves the shipped colour alone; a bare
   * string paints both themes with the same value.
   */
  accent: {
    light: '',
    dark: '',
  },
  /** Hide the 预览版 badge next to the headline. */
  hidePreviewBadge: true,
  /** Extra CSS appended to this plugin's stylesheet, for anything not covered above. */
  css: '',
}

/** Last line this plugin wrote, so a re-render never repeats it back to back. */
var lastHeadline = null
/** Same, per shipped hint sentence (the key names a state and a language). */
var lastPlaceholder = new Map()

/** See {@link DEFAULTS}. */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The line pool for the language the document is currently in. */
function headlinePool(table) {
  const primary = (document.documentElement.lang || '').toLowerCase().split('-')[0]
  const pools = Object.values(table).filter((pool) => Array.isArray(pool) && pool.length > 0)
  const own = primary !== '' && Array.isArray(table[primary]) && table[primary].length > 0 ? table[primary] : null
  return own ?? table.zh ?? pools[0] ?? []
}

/**
 * The accent tokens this plugin repaints: the neutral brand colour, the blue
 * business colour, the link colour, and the shrunken alias the shipped theme
 * emits for the active-tab caret and the settings page (`#4176e6`). The last
 * name is spelled exactly as the bundle does; a release that drops it only
 * leaves one unused declaration behind.
 */
var ACCENT_TOKENS = [
  '--dsw-alias-brand-primary',
  '--dsw-alias-brand-primary-new-colorprimary-new-color',
  '--dsw-alias-link',
  '--dsw-alias-state-business-primary',
]

/** `#rgb` / `#rrggbb` as 0-255 channels, or null for anything else. */
function hexChannels(color) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (match === null) return null
  const digits = match[1]
  const full = digits.length === 3 ? digits.replace(/./g, (digit) => digit + digit) : digits
  return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16))
}

/** WCAG relative luminance, used only to pick ink that stays readable. */
function luminance(channels) {
  const linear = (value) => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(channels[0]) + 0.7152 * linear(channels[1]) + 0.0722 * linear(channels[2])
}

/**
 * Black or white, whichever contrasts more with the accent fill.
 * @returns the ink colour, or null when the accent is not a hex value and its
 *   contrast cannot be measured here.
 */
function contrastInk(color) {
  const channels = hexChannels(color)
  if (channels === null) return null
  const relative = luminance(channels)
  return 1.05 / (relative + 0.05) > (relative + 0.05) / 0.05 ? '#ffffff' : '#0d0d0d'
}

/**
 * The accent override for one theme.
 *
 * The colour lands on every token in {@link ACCENT_TOKENS} plus the values that
 * cannot inherit from them: the primary button's hover shade, mixed toward black
 * in light and white in dark so it deepens or lifts instead of flipping back to
 * the shipped neutral, and the ink drawn on an accent fill.
 *
 * The declarations are rooted at `html body` and `html body *`: the shipped
 * theme publishes its aliases on `body` and on `body *`, and this selector wins
 * that tie by specificity rather than by sheet order, which the runtime
 * stylesheets do not guarantee. No !important is used, so a component that
 * remaps a token inside its own scope still wins.
 *
 * `--dsh-ui-copy-accent` and `--dsh-ui-copy-accent-ink` are published for the
 * ask surface, whose own token layer remaps the harness tokens and would
 * otherwise read back into itself.
 *
 * @param selector - the theme root selector, already specificity-boosted.
 * @param color - accent colour for this theme; an empty string writes nothing.
 * @param shade - the colour this theme's hover state mixes toward.
 */
function accentBlock(selector, color, shade) {
  if (color === '') return ''
  const declarations = ACCENT_TOKENS.map((token) => `${token}: ${color};`)
  declarations.push(`--dsw-alias-button-primary-hover: color-mix(in srgb, ${color} 84%, ${shade});`)
  const ink = contrastInk(color)
  if (ink !== null) declarations.push(`--dsw-alias-label-primary-foreground: ${ink};`)
  declarations.push(`--dsh-ui-copy-accent: ${color};`)
  if (ink !== null) declarations.push(`--dsh-ui-copy-accent-ink: ${ink};`)
  return `${selector} {\n  ${declarations.join('\n  ')}\n}\n`
}

/** The two theme blocks, or nothing when no accent is configured. */
function accentStylesheet(accent) {
  return (
    accentBlock('html body,\nhtml body *', accent.light, '#000000') +
    accentBlock('html body[data-ds-dark-theme],\nhtml body[data-ds-dark-theme] *', accent.dark, '#ffffff')
  )
}

/** A config value as an accent pair: a bare string paints both themes. */
function accentFrom(value) {
  if (typeof value === 'string') return { light: value, dark: value }
  if (!isPlainObject(value)) return { ...DEFAULTS.accent }
  const colour = (entry) => (typeof entry === 'string' ? entry : '')
  return { light: colour(value.light), dark: colour(value.dark) }
}

/**
 * Drop the characters that could break out of a declaration value. Everything
 * else is passed through, so any CSS colour syntax the browser understands is
 * accepted and an unparsable value simply leaves the token unset.
 */
function sanitizeColor(value) {
  return typeof value === 'string' ? value.replace(/[;{}<>]/g, '').trim() : ''
}

/**
 * The accent pair a config-form snapshot carries.
 *
 * @param snapshot - `form.getSnapshot()`.
 * @returns `{ light, dark }`; an empty string means "leave the shipped colour".
 */
function accentOf(snapshot) {
  const value = isPlainObject(snapshot) && isPlainObject(snapshot.value) ? snapshot.value : {}
  const accent = isPlainObject(value.accent) ? value.accent : {}
  return { light: sanitizeColor(accent.light), dark: sanitizeColor(accent.dark) }
}

/** A `#rrggbb` for the native colour input, which accepts nothing else. */
function pickerHex(value) {
  const channels = hexChannels(value)
  if (channels === null) return '#888888'
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** The Settings → General row's text, one dictionary per language. */
var ROW_TEXT = {
  zh: {
    title: 'UI 强调色',
    description: '主按钮、开关、选中描边、链接、焦点环与业务态徽标的颜色，浅色与深色主题各配一个。留空表示沿用官方配色。',
    light: '浅色',
    dark: '深色',
    inherit: '跟随官方',
    clear: '清除',
    saveFailed: '保存失败，请重试',
    unavailable: '这台机器上没有可写的设置文档，强调色只能在回环地址的页面上编辑。',
    workspacePick: '选择项目',
    workspaceSwitch: '切换项目',
    workspaceEmpty: '还没有登记的项目',
  },
  en: {
    title: 'UI accent',
    description: 'Colour of primary buttons, switches, selected strokes, links, focus rings and business badges, one per theme. Empty keeps the shipped colour.',
    light: 'Light',
    dark: 'Dark',
    inherit: 'Shipped',
    clear: 'Clear',
    saveFailed: 'Could not save; try again',
    unavailable: 'No writable settings document on this machine; edit the accent from a loopback page.',
    workspacePick: 'Choose project',
    workspaceSwitch: 'Switch project',
    workspaceEmpty: 'No projects registered yet',
  },
}

/**
 * The Settings → General row's own chrome.
 *
 * It borrows the shipped alias tokens rather than hard-coding colours, so the
 * row follows the active theme like the rows the other plugin bundles
 * contribute next to it, and it keeps its own `duic-` prefix so nothing here
 * can collide with a shipped class.
 */
var SETTINGS_CSS = `
.duic-row{display:flex;align-items:flex-start;gap:8px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.duic-rowText{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:24px}
.duic-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.duic-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}
.duic-note{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-tertiary));font-size:12px;font-weight:400;line-height:18px}
.duic-control{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex:none}
.duic-field{display:flex;align-items:center;gap:8px}
.duic-fieldLabel{color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-tertiary));font-size:12px;line-height:18px;width:28px;text-align:right}
.duic-picker{box-sizing:border-box;width:34px;height:28px;padding:2px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3);cursor:pointer}
.duic-picker::-webkit-color-swatch-wrapper{padding:0}
.duic-picker::-webkit-color-swatch{border:none;border-radius:5px}
.duic-picker-empty{opacity:.4}
.duic-picker:disabled{cursor:default;opacity:.6}
.duic-input{box-sizing:border-box;width:136px;height:28px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);padding:0 10px;font:inherit;font-size:13px}
.duic-input:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
.duic-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.duic-input:disabled{opacity:.6;cursor:default}
.duic-clear{flex:none;border:none;background:none;padding:0 2px;color:var(--dsw-alias-link);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.duic-clear:disabled{cursor:default;opacity:.6}
`

/**
 * The project chip's chrome.
 *
 * It sits in the composer dock as the leftmost entry and opens upward, because
 * the dock itself lives at the bottom of the seat. Every state change is a
 * transform or an opacity, so opening and closing stay on the compositor.
 */
var WORKSPACE_CSS = `
.duic-ws{position:relative;display:flex;align-items:center;order:-10}
.duic-wsTrigger{display:flex;align-items:center;gap:6px;height:22px;padding:0 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:background-color .14s cubic-bezier(.2,0,.2,1),color .14s cubic-bezier(.2,0,.2,1)}
.duic-wsTrigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.duic-wsTrigger:disabled{cursor:default;opacity:.6}
.duic-wsIcon,.duic-wsChevron{display:flex;flex:none}
.duic-wsIcon svg,.duic-wsChevron svg{display:block}
.duic-wsLabel{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.duic-wsChevron{transition:transform .18s cubic-bezier(.2,0,.2,1)}
.duic-ws[data-open="true"] .duic-wsChevron{transform:rotate(180deg)}
.duic-wsMenu{position:absolute;bottom:calc(100% + 8px);left:0;z-index:40;display:flex;flex-direction:column;gap:2px;box-sizing:border-box;min-width:236px;max-width:340px;max-height:320px;overflow:auto;padding:6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-2));box-shadow:0 14px 40px #00000059;transform-origin:bottom left;opacity:0;transform:translateY(6px) scale(.96);pointer-events:none;transition:opacity .16s cubic-bezier(.2,0,.2,1),transform .16s cubic-bezier(.2,0,.2,1)}
.duic-ws[data-open="true"] .duic-wsMenu{opacity:1;transform:none;pointer-events:auto}
.duic-wsItem{display:flex;flex-direction:column;gap:1px;width:100%;box-sizing:border-box;padding:6px 10px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer;transition:background-color .14s cubic-bezier(.2,0,.2,1)}
.duic-wsItem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.duic-wsItem:disabled{cursor:default;opacity:.6}
.duic-wsItemLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.duic-wsItemPath{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.duic-wsItemCurrent .duic-wsItemLabel{color:var(--dsw-alias-brand-primary)}
.duic-wsEmpty{padding:6px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
`

/** Render the stylesheet: the badge rule, the accent override, the row, the chip, the caller's CSS. */
function stylesheetFor(options) {
  const badge = options.hidePreviewBadge ? `${PREVIEW_BADGE_SELECTOR} { display: none !important; }\n` : ''
  return badge + accentStylesheet(options.accent) + SETTINGS_CSS + WORKSPACE_CSS + options.css
}

/** A config value as a list of lines: a bare string counts as a one-line pool. */
function poolOf(value) {
  if (typeof value === 'string') return value === '' ? [] : [value]
  if (!Array.isArray(value)) return []
  return value.filter((line) => typeof line === 'string' && line !== '')
}

/** One line from the pool, never the line just shown when the pool allows it. */
function pickLine(pool, previous) {
  if (pool.length === 0) return null
  const candidates = pool.filter((line) => line !== previous)
  return candidates[Math.floor(Math.random() * candidates.length)] || pool[0]
}

/**
 * Swap the shipped headline for a pooled line.
 *
 * A line this plugin already wrote is left alone, so a re-render of unrelated
 * parts of the tree does not reshuffle the headline; only React writing the
 * shipped sentence back (a remount, or a language switch) draws a new line.
 *
 * @param table - the headline pools, keyed by language subtag.
 */
function applyHeadline(table) {
  const label = document.querySelector(HEADLINE_SELECTOR)
  if (label === null) return
  const pool = headlinePool(table)
  if (pool.length === 0 || pool.includes(label.textContent)) return
  const next = pickLine(pool, lastHeadline)
  if (next === null) return
  label.textContent = next
  lastHeadline = next
}

/**
 * Rewrite the empty-state hint and the aria-label that mirrors it.
 *
 * The state is identified by the shipped sentence React passes down, which is
 * the one thing on screen that never gets written here; the visible bubble being
 * already in the pool is what marks this pass as ours.
 *
 * @param table - shipped sentence to line pool map.
 */
function applyPlaceholders(table) {
  for (const scroll of document.querySelectorAll(COMPOSER_SCROLL_SELECTOR)) {
    const editable = scroll.querySelector(HINT_SOURCE_SELECTOR)
    if (editable === null) continue
    const shipped = editable.getAttribute('data-placeholder')
    const pool = shipped === null ? [] : poolOf(table[shipped])
    if (pool.length === 0) continue
    const bubble = scroll.querySelector(HINT_BUBBLE_SELECTOR)
    if (bubble === null || pool.includes(bubble.textContent)) continue
    const next = pickLine(pool, lastPlaceholder.get(shipped))
    if (next === null) continue
    lastPlaceholder.set(shipped, next)
    bubble.textContent = next
    if (editable.getAttribute('aria-label') === shipped) editable.setAttribute('aria-label', next)
  }
}

/** One pass over every rule. */
function applyCopy(options) {
  applyHeadline(options.headline)
  applyPlaceholders(options.placeholders)
}

/**
 * Install the stylesheet and the observer.
 *
 * @param options - normalized copy options; the accent is written back into
 *   this object rather than replaced, so the copy passes keep reading whatever
 *   the settings row last saved.
 * @returns a handle: `setAccent` repaints the accent block, `dispose` removes
 *   the stylesheet and the observer.
 */
function start(options) {
  const style = document.createElement('style')
  style.setAttribute('data-dsh-ui-copy', '')
  style.textContent = stylesheetFor(options)
  document.head.appendChild(style)

  // The observer is chatty while a response streams, so passes collapse into
  // one per frame.
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      applyCopy(options)
    })
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  schedule()

  return {
    /**
     * Repaint the accent block from a fresh config-form value. An unchanged
     * value is left alone, so the row's own subscription never rewrites the
     * sheet for nothing.
     */
    setAccent(accent) {
      if (accent.light === options.accent.light && accent.dark === options.accent.dark) return
      options.accent = accent
      style.textContent = stylesheetFor(options)
    },
    dispose() {
      observer.disconnect()
      style.remove()
    },
  }
}

/** Merge the cordis config over {@link DEFAULTS}, ignoring fields of the wrong shape. */
function normalizeConfig(config) {
  const input = isPlainObject(config) ? config : {}
  return {
    headline: isPlainObject(input.headline) ? input.headline : DEFAULTS.headline,
    placeholders: isPlainObject(input.placeholders) ? { ...DEFAULTS.placeholders, ...input.placeholders } : DEFAULTS.placeholders,
    accent: accentFrom(input.accent),
    hidePreviewBadge: typeof input.hidePreviewBadge === 'boolean' ? input.hidePreviewBadge : DEFAULTS.hidePreviewBadge,
    css: typeof input.css === 'string' ? input.css : DEFAULTS.css,
  }
}

window.__ModuleLoader__.load({
  id: 'dsh-ui-copy',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    /** This plugin rewrites DOM copy and contributes one settings row; it claims no client service. */
    const inject = []

    /**
     * The config form for this plugin's row.
     *
     * `null` is every shape of "no editable settings on this page": the seam
     * absent, the handle shaped differently after a release, or the lookup
     * itself throwing. Callers keep the built-in defaults in that case.
     *
     * @param scope - a context with `configForms` injected.
     * @returns the form handle, or null.
     */
    function configFormOf(scope) {
      try {
        const forms = scope.configForms
        if (forms === undefined || forms === null || typeof forms.get !== 'function') return null
        const form = forms.get(CONFIG_ENTRY_ID)
        if (form === undefined || form === null || typeof form.getSnapshot !== 'function') return null
        return form
      } catch {
        return null
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
     * One theme's colour: the native picker, the text field, and the clear
     * button that puts the theme back on the shipped colour.
     *
     * The text field is what carries syntax the picker cannot show (`oklch()`,
     * a colour name); both controls commit the same field, and an unchanged
     * value is never written back.
     */
    function AccentField({ t, labelKey, value, busy, onCommit }) {
      const [draft, setDraft] = React.useState(value)
      React.useEffect(() => setDraft(value), [value])

      const commitDraft = () => {
        if (draft !== value) onCommit(draft)
      }

      return h('div', { className: 'duic-field' }, [
        h('div', { className: 'duic-fieldLabel', key: 'label' }, t(labelKey)),
        h('input', {
          key: 'picker',
          className: value === '' ? 'duic-picker duic-picker-empty' : 'duic-picker',
          type: 'color',
          value: pickerHex(value),
          disabled: busy,
          'aria-label': t(labelKey),
          onChange: (event) => {
            setDraft(event.target.value)
            onCommit(event.target.value)
          },
        }),
        h('input', {
          key: 'text',
          className: 'duic-input',
          type: 'text',
          value: draft,
          disabled: busy,
          spellCheck: false,
          placeholder: t('inherit'),
          'aria-label': `${t('title')} · ${t(labelKey)}`,
          onChange: (event) => setDraft(event.target.value),
          onBlur: commitDraft,
          onKeyDown: (event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          },
        }),
        value === ''
          ? null
          : h('button', {
            key: 'clear',
            className: 'duic-clear',
            type: 'button',
            disabled: busy,
            onClick: () => onCommit(''),
          }, t('clear')),
      ])
    }

    /**
     * The Settings → General row.
     *
     * A save is one atomic namespace mutation carrying the nested path, so a
     * cleared colour really removes the key instead of storing an empty string,
     * and the two themes can never be written half-applied. The draft is
     * replaced whenever the stored value moves underneath it, so a save the
     * Host refused leaves the text in place to be submitted again.
     */
    function AccentRow({ t, form }) {
      const snapshot = useFormSnapshot(form)
      const accent = accentOf(snapshot)
      const [busy, setBusy] = React.useState(false)
      const [failed, setFailed] = React.useState(false)
      const unavailable = snapshot.status === 'unavailable'

      const commit = (theme, next) => {
        const value = sanitizeColor(next)
        if (value === accent[theme]) return
        setBusy(true)
        setFailed(false)
        const write = form.mutate([
          value === '' ? { op: 'unset', path: ['accent', theme] } : { op: 'set', path: ['accent', theme], value },
        ])
        Promise.resolve(write)
          .then((accepted) => {
            if (!accepted) setFailed(true)
          })
          .catch(() => setFailed(true))
          .finally(() => setBusy(false))
      }

      const notes = []
      if (failed) notes.push(h('div', { className: 'duic-note', key: 'failed' }, t('saveFailed')))
      if (unavailable) notes.push(h('div', { className: 'duic-note', key: 'unavailable' }, t('unavailable')))

      const control = unavailable
        ? null
        : h('div', { className: 'duic-control', key: 'control' }, [
          h(AccentField, { key: 'light', t, labelKey: 'light', value: accent.light, busy, onCommit: (next) => commit('light', next) }),
          h(AccentField, { key: 'dark', t, labelKey: 'dark', value: accent.dark, busy, onCommit: (next) => commit('dark', next) }),
        ])

      return h('div', { className: 'duic-row' }, [
        h('div', { className: 'duic-rowText', key: 'text' }, [
          h('div', { className: 'duic-title', key: 'title' }, t('title')),
          h('div', { className: 'duic-desc', key: 'desc' }, t('description')),
          ...notes,
        ]),
        control,
      ])
    }

    /**
     * Subscribe one component to a client store's snapshots.
     *
     * Both controllers publish plain snapshot stores, so a subscriber reads the
     * current value and re-renders whenever either side moves.
     *
     * @param store - a `list` handle exposing `getSnapshot` and `subscribe`.
     * @returns the current snapshot, refreshed on every change.
     */
    function useStoreSnapshot(store) {
      const [snapshot, setSnapshot] = React.useState(() => store.getSnapshot())
      React.useEffect(() => store.subscribe(() => setSnapshot(store.getSnapshot())), [store])
      return snapshot
    }

    /** A workspace's display name: its title, else the last path segment. */
    function workspaceLabelOf(workspace) {
      if (workspace === undefined || workspace === null) return null
      if (typeof workspace.title === 'string' && workspace.title.trim() !== '') return workspace.title
      if (typeof workspace.path === 'string') {
        const segments = workspace.path.split('/').filter((segment) => segment !== '')
        if (segments.length > 0) return segments[segments.length - 1]
      }
      return typeof workspace.workspaceId === 'string' ? workspace.workspaceId : null
    }

    /** The folder glyph on the trigger. */
    function folderGlyph() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M2 5.2A1.2 1.2 0 0 1 3.2 4h2.6l1.4 1.8h5.6A1.2 1.2 0 0 1 14 7v3.8A1.2 1.2 0 0 1 12.8 12H3.2A1.2 1.2 0 0 1 2 10.8V5.2Z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }))
    }

    /** The disclosure glyph on the trigger. */
    function chevronGlyph() {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M4 6.5 8 10.5l4-4',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }))
    }

    /**
     * The project chip in the composer dock.
     *
     * The current project is the workspace the main-view session belongs to; the
     * list comes from the workspace controller and the switch runs through the
     * workspace service, so this control duplicates no navigation logic. The
     * menu is local state, which is what makes its open and close animatable
     * without touching the host's own menus.
     */
    function WorkspaceChip({ t, workspaces, sessions, uiWorkspace }) {
      const list = useStoreSnapshot(workspaces.list)
      const sessionList = useStoreSnapshot(sessions.list)
      const [open, setOpen] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const root = React.useRef(null)

      React.useEffect(() => {
        if (!open) return undefined
        const close = (event) => {
          if (root.current !== null && event.target instanceof Node && root.current.contains(event.target)) return
          setOpen(false)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', close, true)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('pointerdown', close, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])

      const items = Array.isArray(list?.items) ? list.items : []
      const rows = Object.entries(sessionList?.byId ?? {}).map(([sessionId, row]) => ({ sessionId, ...row }))
      const mainRow = rows.find((row) => (row?.retainedBy?.mainView ?? 0) > 0)
      const currentSessionId = typeof mainRow?.sessionId === 'string' ? mainRow.sessionId : ''
      // The Session row owns no workspace id, so the current project comes from
      // the controller's own membership list, exactly as the host resolves it.
      const current = items.find((item) => (Array.isArray(item.sessionIds) && currentSessionId !== '' && item.sessionIds.includes(currentSessionId))
        || (typeof mainRow?.workspaceId === 'string' && item.workspaceId === mainRow.workspaceId))
      const currentId = typeof current?.workspaceId === 'string' ? current.workspaceId : ''
      const label = workspaceLabelOf(current) ?? t('workspacePick')

      const choose = (workspaceId) => {
        setOpen(false)
        if (workspaceId === currentId || busy) return
        setBusy(true)
        Promise.resolve()
          .then(() => uiWorkspace.openWorkspace(workspaceId))
          .catch(() => {})
          .then(() => setBusy(false))
      }

      const entries = items.length === 0
        ? h('div', { className: 'duic-wsEmpty', key: 'empty' }, t('workspaceEmpty'))
        : items.map((item) => h('button', {
          key: String(item.workspaceId),
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': item.workspaceId === currentId,
          className: item.workspaceId === currentId ? 'duic-wsItem duic-wsItemCurrent' : 'duic-wsItem',
          disabled: busy,
          onClick: () => choose(item.workspaceId),
        }, [
          h('span', { className: 'duic-wsItemLabel', key: 'label' }, workspaceLabelOf(item) ?? String(item.workspaceId)),
          typeof item.path === 'string' && item.path !== ''
            ? h('span', { className: 'duic-wsItemPath', key: 'path' }, item.path)
            : null,
        ]))

      return h('div', { className: 'duic-ws', ref: root, 'data-open': open ? 'true' : 'false' }, [
        h('button', {
          key: 'trigger',
          type: 'button',
          className: 'duic-wsTrigger',
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-label': t('workspaceSwitch'),
          disabled: busy,
          onClick: () => setOpen((value) => !value),
        }, [
          h('span', { className: 'duic-wsIcon', key: 'icon' }, folderGlyph()),
          h('span', { className: 'duic-wsLabel', key: 'label' }, label),
          h('span', { className: 'duic-wsChevron', key: 'chevron' }, chevronGlyph()),
        ]),
        h('div', { className: 'duic-wsMenu', key: 'menu', role: 'menu' }, entries),
      ])
    }

    /**
     * Install the copy overrides, the accent wiring and the settings row.
     *
     * The copy passes start at once because they need no service. The accent
     * follows the config form instead of the loader row: the form is the only
     * surface that can see the profile's configuration, and the host half is
     * what declares the volatile fields that make the form editable.
     *
     * @param ctx - client root context.
     */
    function apply(ctx) {
      const options = normalizeConfig()
      let running = null

      const mount = () => {
        running = start(options)
        return () => {
          const previous = running
          running = null
          if (previous !== null) previous.dispose()
        }
      }
      if (document.body) ctx.effect(mount, 'ui-copy: copy overrides')
      else document.addEventListener('DOMContentLoaded', () => ctx.effect(mount, 'ui-copy: copy overrides'), { once: true })

      ctx.inject(['configForms'], (scope) => {
        const form = configFormOf(scope)
        if (form === null) return
        const sync = () => {
          const accent = accentOf(form.getSnapshot())
          options.accent = accent
          if (running !== null) running.setAccent(accent)
        }
        scope.effect(() => form.subscribe(sync), 'ui-copy: accent changes')
        sync()
      })

      ctx.inject(['locale'], (scope) => {
        scope.effect(() => scope.locale.register(SETTINGS_NS, ROW_TEXT), 'ui-copy: dictionaries')
      })

      ctx.inject(['slots', 'locale', 'configForms'], (scope) => {
        const form = configFormOf(scope)
        if (form === null) return
        scope.slots.inject('settings.general.item', () => scope.slots.register({
          name: 'settings.general.item',
          id: SETTINGS_NS,
          order: 14,
          locale: SETTINGS_NS,
          inject: () => ({ form }),
        }, AccentRow))
      })

      ctx.inject(['slots', 'locale', 'workspaces', 'sessions', 'uiWorkspace'], (scope) => {
        scope.slots.inject('conversation.composer.dock', () => scope.slots.register({
          name: 'conversation.composer.dock',
          id: 'ui-copy-workspace',
          order: -10,
          locale: SETTINGS_NS,
          inject: () => ({
            workspaces: scope.workspaces,
            sessions: scope.sessions,
            uiWorkspace: scope.uiWorkspace,
          }),
        }, WorkspaceChip))
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
