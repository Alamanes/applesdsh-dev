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
 * Copy lives in {@link DEFAULTS} and can be overridden field by field through
 * the plugin's cordis config (the profile's cordis.patch.yml row).
 */

/** Headline label inside the Hero's title group; the badge is its sibling. */
const HEADLINE_SELECTOR = '[class*="titleGroup"] > span:first-child'
/** The 预览版 badge sharing that title group. */
const PREVIEW_BADGE_SELECTOR = '[class*="previewBadge"]'
/** The composer's scrollport: one per mounted composer occurrence. */
const COMPOSER_SCROLL_SELECTOR = '[data-input-scroll]'
/** React's own copy of the current hint, on the editable surface. */
const HINT_SOURCE_SELECTOR = '[data-placeholder]'
/** The visible hint bubble. */
const HINT_BUBBLE_SELECTOR = '[data-composer-placeholder]'

/** Editable copy. Overridable field by field through the plugin's cordis config. */
const DEFAULTS = {
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
let lastHeadline = null
/** Same, per shipped hint sentence (the key names a state and a language). */
const lastPlaceholder = new Map()

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
const ACCENT_TOKENS = [
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

/** Render the stylesheet: the badge rule, the accent override, the caller's CSS. */
function stylesheetFor(options) {
  const badge = options.hidePreviewBadge ? `${PREVIEW_BADGE_SELECTOR} { display: none !important; }\n` : ''
  return badge + accentStylesheet(options.accent) + options.css
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
 * @param options - normalized copy options.
 * @returns disposer removing both.
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

  return () => {
    observer.disconnect()
    style.remove()
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

    /** This plugin rewrites DOM copy only; it claims no client service. */
    const inject = []

    /**
     * Install the copy overrides.
     * @param ctx - client root context.
     * @param config - the plugin row's cordis config, when the profile sets one.
     */
    function apply(ctx, config) {
      const options = normalizeConfig(config)
      const install = () => start(options)
      if (document.body) ctx.effect(install, 'ui-copy: copy overrides')
      else document.addEventListener('DOMContentLoaded', () => ctx.effect(install, 'ui-copy: copy overrides'), { once: true })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
