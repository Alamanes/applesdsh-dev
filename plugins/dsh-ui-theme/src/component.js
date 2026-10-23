function dshuiComponent_theme(rt) {
/** Settings locale namespace owned by this component. */
var SETTINGS_NS = 'ui-suite-theme'
/** Loader row id; `configForms.get` is keyed by it (it is the patch entry id). */
var CONFIG_ENTRY_ID = 'dshui-theme'
/** Override-layer identity in the shared theme service; one layer per package. */
var LAYER_SOURCE = 'ui-suite-theme'
/** Nav order: after the General section (0), before the Plugins section (15). */
var SECTION_ORDER = 12

var DEFAULTS = { theme: 'default' }

/* ---- colour helpers --------------------------------------------------- */

/** `#rrggbb` as space-separated RGB components. */
function channels(hex) {
  return [1, 3, 5].map(function (at) {
    return parseInt(hex.slice(at, at + 2), 16)
  })
}

/** `#rrggbb` plus an alpha, as a CSS colour the browser parses. */
function tint(hex, alpha) {
  var rgb = channels(hex)
  return 'rgb(' + rgb[0] + ' ' + rgb[1] + ' ' + rgb[2] + ' / ' + alpha + ')'
}

/* ---- role -> token table ---------------------------------------------- *
 *
 * A preset describes the interface by role; this table is the single place
 * that knows which `--dsw-*` (shipped) and `--dshui-*` (suite) custom
 * properties a role paints. The shipped presenter writes each of these onto
 * `body` as an inline property, so a preset overrides the shipped alias layer
 * rather than layering a second stylesheet on top of it: every component that
 * reads a `--dsw-*` alias follows, in and out of the suite.
 */
var ROLE_TOKENS = {
  layer1: [
    '--dsw-specific-input-major',
    '--dsw-alias-button-elevated-fill',
    '--dsw-alias-button-floating-fill',
    '--dsw-alias-markdown-code-segment-selected',
    '--dshui-neutral-fill',
    '--dshui-neutral-fill-raised',
  ],
  layer2: [
    '--dsw-specific-selector',
    '--dsw-specific-tip',
    '--dsw-alias-markdown-citation',
    '--dsw-alias-markdown-tag',
    '--dsw-alias-button-ghost-active-fill',
    '--dsw-alias-button-primary-dimmed',
    '--dshui-neutral-fill-sunken',
    '--dshui-surface-dock',
  ],
  layer3: [
    '--dsw-alias-button-ghost-active-hover',
    '--dsw-alias-markdown-code-segment-unselected',
  ],
  menu: [
    '--dsw-menu-surface-fill',
    '--dsw-alias-menu-group-header-fill',
    '--dsw-specific-menu',
  ],
  bubble: ['--dsw-specific-bubble'],
  bubbleHighlight: ['--dsw-specific-bubble-highlight'],
  text: [
    '--dsw-alias-label-primary',
    '--dsw-alias-label-primary-bluish',
    '--dsw-alias-label-primary-dimmed',
    '--dsw-alias-button-contrast-fill',
    '--dshui-ink-solid',
  ],
  textSecondary: ['--dsw-alias-label-secondary', '--dsw-alias-menu-icon'],
  textTertiary: ['--dsw-alias-label-tertiary'],
  textCaption: ['--dsw-alias-label-caption'],
  textDimmed: ['--dsw-alias-label-dimmed'],
  textOnBrand: [
    '--dsw-alias-label-primary-foreground',
    '--dsw-alias-label-primary-inverted',
    '--dshui-ink-on-solid',
    '--dshui-text-on-brand',
  ],
  border1: ['--dsw-alias-border-l1', '--dsw-alias-border-l2-darkmode-thin'],
  border2: ['--dsw-alias-border-l2'],
  border3: ['--dsw-alias-border-l3'],
  border4: ['--dsw-alias-border-l4', '--dsw-alias-button-ghost-active-border', '--dshui-neutral-stroke'],
  brand: [
    '--dsw-alias-brand-primary',
    '--dsw-alias-brand-primary-new-colorprimary-new-color',
    '--dsw-alias-brand-text',
    '--dsw-alias-button-primary-fill',
    '--dsw-alias-state-business-primary',
    '--dsw-focus-ring-color',
  ],
  brandHover: ['--dsw-alias-button-primary-hover'],
  link: ['--dsw-alias-link'],
  hoverWash: ['--dsw-alias-interactive-bg-hover', '--dshui-wash-hover'],
  activeWash: [
    '--dsw-alias-interactive-bg-active',
    '--dsw-alias-interactive-bg-hover-accent',
    '--dshui-wash-active',
  ],
  hoverSolid: ['--dsw-alias-interactive-bg-hover-solid', '--dsw-alias-button-floating-hover'],
  codeBlock: ['--dsw-alias-markdown-code-block', '--dsw-alias-markdown-code-block-banner'],
  codeInline: ['--dsw-alias-markdown-inline-code'],
  scrollbar: ['--dsw-alias-scrollbar-bg-l1', '--dsw-alias-scrollbar-bg-l2'],
  scrollbarHover: ['--dsw-alias-scrollbar-hover-l1', '--dsw-alias-scrollbar-hover-l2'],
  toastBg: ['--dsw-alias-toast-bg'],
  tooltipBg: ['--dsw-alias-tooltip-bg'],
  switchThumb: ['--dsw-alias-switch-thumb'],
}

/**
 * The tokens that must stay translucent while the whale wallpaper is mounted.
 *
 * The wallpaper package stacks its own alias layer over the app shell so its
 * canvas shows through; this package paints the same aliases. Writing a plain
 * colour here would cover the wallpaper no matter which layer landed last, so
 * each surface token is published as an indirection:
 *
 *     --dsw-alias-bg-base: var(--dshui-wallpaper-base, var(--dshui-palette-base, #f4f8fd))
 *
 * `--dshui-palette-*` is this package's own colour, and `--dshui-wallpaper-*` is
 * the same colour with the wallpaper's alpha, published by dsh-ui-whale when it
 * is mounted. Either order of the two layers resolves to the same result, and
 * with no wallpaper the palette colour shows through opaque.
 */
var SURFACE_TOKENS = [
  { token: '--dsw-alias-bg-base', role: 'base', suffix: 'base' },
  { token: '--dsw-alias-bg-layer-1', role: 'layer1', suffix: 'layer-1' },
  { token: '--dsw-alias-bg-layer-2', role: 'layer2', suffix: 'layer-2' },
  { token: '--dsw-alias-bg-layer-3', role: 'layer3', suffix: 'layer-3' },
  { token: '--dsw-alias-bg-overlay', role: 'layer3', suffix: 'layer-3' },
  { token: '--dsw-specific-sidebar-fill', role: 'sidebar', suffix: 'sidebar' },
]

/**
 * One palette spec as roles.
 *
 * A preset carries the handful of colours that decide how a theme reads -
 * canvas, three surface steps, the chrome bands, the ink ramp, one border pair
 * and the brand pair. Everything else is mixed from those, so the table below
 * stays short enough to keep each preset honest rather than hand-tuning 55
 * values six times.
 *
 * `hoverWash`, `activeWash`, `hoverSolid`, `scrollbar` and `scrollbarHover`
 * are optional overrides: a preset whose accent has to reach past the bubbles
 * states them outright, every other preset keeps the ink-derived mix.
 */
function rolesOf(spec) {
  var borderSoft = spec.borderSoft
  var borderStrong = spec.borderStrong
  return {
    base: spec.base,
    layer1: spec.layer1,
    layer2: spec.layer2,
    layer3: spec.layer3,
    sidebar: spec.sidebar,
    menu: tint(spec.menu, 0.95),
    bubble: spec.bubble,
    bubbleHighlight: spec.bubbleHighlight || spec.bubble,
    text: spec.text,
    textSecondary: spec.textSecondary,
    textTertiary: spec.textTertiary,
    textCaption: spec.textCaption || tint(spec.text, 0.42),
    textDimmed: spec.textDimmed || tint(spec.text, 0.22),
    textOnBrand: spec.brandInk,
    border1: tint(borderSoft, 0.6),
    border2: borderSoft,
    border3: tint(borderStrong, 0.8),
    border4: borderStrong,
    brand: spec.brand,
    brandHover: spec.brandHover,
    link: spec.link,
    hoverWash: spec.hoverWash || tint(spec.text, 0.06),
    activeWash: spec.activeWash || tint(spec.text, 0.1),
    hoverSolid: spec.hoverSolid || tint(spec.text, 0.07),
    codeBlock: spec.codeBlock || spec.layer2,
    codeInline: spec.codeInline || spec.layer2,
    scrollbar: spec.scrollbar || tint(spec.text, 0.16),
    scrollbarHover: spec.scrollbarHover || tint(spec.text, 0.28),
    toastBg: spec.toastBg,
    tooltipBg: spec.tooltipBg || spec.toastBg,
    switchThumb: spec.layer1,
  }
}

/** Fold one preset's two palettes into `{ token: { light, dark } }`. */
function tokensOf(preset) {
  var light = rolesOf(preset.light)
  var dark = rolesOf(preset.dark)
  var tokens = {}
  for (var role in ROLE_TOKENS) {
    if (!Object.prototype.hasOwnProperty.call(ROLE_TOKENS, role)) continue
    var names = ROLE_TOKENS[role]
    for (var index = 0; index < names.length; index += 1) {
      tokens[names[index]] = { light: light[role], dark: dark[role] }
    }
  }
  for (var position = 0; position < SURFACE_TOKENS.length; position += 1) {
    var surface = SURFACE_TOKENS[position]
    var paletteVar = '--dshui-palette-' + surface.suffix
    var wallpaperVar = '--dshui-wallpaper-' + surface.suffix
    tokens[paletteVar] = { light: light[surface.role], dark: dark[surface.role] }
    tokens[surface.token] = {
      light: 'var(' + wallpaperVar + ', var(' + paletteVar + ', ' + light[surface.role] + '))',
      dark: 'var(' + wallpaperVar + ', var(' + paletteVar + ', ' + dark[surface.role] + '))',
    }
  }
  return tokens
}

/* ---- presets ---------------------------------------------------------- *
 *
 * `default` is the absence of a layer: the shipped neutral palette shows
 * through untouched. Every other preset keeps the shipped light/dark switch
 * working - the theme service picks the light or dark half of each token from
 * the active color scheme, so these are palettes on top of a scheme, not a
 * replacement for it.
 */
var PRESETS = [
  {
    id: 'whale',
    light: {
      base: '#f4f8fd',
      layer1: '#ffffff',
      layer2: '#edf4fc',
      layer3: '#e3eefa',
      sidebar: '#eef4fc',
      menu: '#f7fafe',
      bubble: '#e8f1fd',
      text: '#0f1b2d',
      textSecondary: '#3f5670',
      textTertiary: '#6b829b',
      borderSoft: '#d3dfee',
      borderStrong: '#aec0d6',
      brand: '#2f6bea',
      brandHover: '#1f55c8',
      brandInk: '#ffffff',
      link: '#2f6bea',
      toastBg: '#1b2c44',
      tooltipBg: '#152438',
      codeBlock: '#f0f5fb',
      codeInline: '#eff4fa',
    },
    dark: {
      base: '#0a1524',
      layer1: '#101e30',
      layer2: '#16283c',
      layer3: '#1c3149',
      sidebar: '#0c1a2b',
      menu: '#101e30',
      bubble: '#16304a',
      text: '#e8f1fa',
      textSecondary: '#a7bdd4',
      textTertiary: '#7e96ae',
      borderSoft: '#26405e',
      borderStrong: '#3a5a80',
      brand: '#5e9bff',
      brandHover: '#7fb2ff',
      brandInk: '#06121f',
      link: '#7fb2ff',
      toastBg: '#22394f',
      tooltipBg: '#1a2c40',
      codeBlock: '#0d1b2b',
      codeInline: '#14273a',
    },
  },
  {
    id: 'sakura',
    light: {
      base: '#fdf7fa',
      layer1: '#ffffff',
      layer2: '#fcf1f6',
      layer3: '#f9e7ef',
      sidebar: '#fbf1f6',
      menu: '#fff8fb',
      bubble: '#fce9f1',
      text: '#2e1b25',
      textSecondary: '#6b4a5a',
      textTertiary: '#96788a',
      borderSoft: '#ebd5e0',
      borderStrong: '#d6b4c6',
      brand: '#d6467f',
      brandHover: '#b93569',
      brandInk: '#ffffff',
      link: '#c4407a',
      toastBg: '#3b2330',
      tooltipBg: '#33202b',
      codeBlock: '#fbf2f7',
      codeInline: '#faeff5',
    },
    dark: {
      base: '#191016',
      layer1: '#221619',
      layer2: '#2c1d24',
      layer3: '#37252e',
      sidebar: '#1c1218',
      menu: '#241820',
      bubble: '#341f2a',
      text: '#f7e9f0',
      textSecondary: '#d3b4c3',
      textTertiary: '#ac8b9b',
      borderSoft: '#422d38',
      borderStrong: '#5a4050',
      brand: '#f57eb0',
      brandHover: '#ff9cc6',
      brandInk: '#2a0e1a',
      link: '#f58fbb',
      toastBg: '#3a2630',
      tooltipBg: '#2f1e27',
      codeBlock: '#1b1117',
      codeInline: '#241820',
    },
  },
  {
    id: 'mint',
    light: {
      base: '#f4fbf8',
      layer1: '#ffffff',
      layer2: '#eaf7f2',
      layer3: '#def2ea',
      sidebar: '#eff9f4',
      menu: '#f7fdfa',
      bubble: '#e3f5ee',
      text: '#122520',
      textSecondary: '#3d5c53',
      textTertiary: '#67857a',
      borderSoft: '#d0e7de',
      borderStrong: '#a9ccbf',
      brand: '#12a67b',
      brandHover: '#0d8b67',
      brandInk: '#ffffff',
      link: '#0e9970',
      toastBg: '#1b3b32',
      tooltipBg: '#163128',
      codeBlock: '#f1faf6',
      codeInline: '#edf8f3',
    },
    dark: {
      base: '#0a1614',
      layer1: '#10201c',
      layer2: '#162a25',
      layer3: '#1d352f',
      sidebar: '#0c1a17',
      menu: '#10201c',
      bubble: '#16332c',
      text: '#e5f5ef',
      textSecondary: '#a6c7bc',
      textTertiary: '#7d9e93',
      borderSoft: '#26473f',
      borderStrong: '#3a6a5e',
      brand: '#35d3a2',
      brandHover: '#5ce3b8',
      brandInk: '#04120e',
      link: '#4fd9ad',
      toastBg: '#1f3e36',
      tooltipBg: '#193229',
      codeBlock: '#0d1a17',
      codeInline: '#13261f',
    },
  },
  {
    id: 'dusk',
    light: {
      base: '#f9f7fe',
      layer1: '#ffffff',
      layer2: '#f3effc',
      layer3: '#eae3f8',
      sidebar: '#f5f1fd',
      menu: '#fbf9ff',
      bubble: '#efe8fa',
      text: '#1e1830',
      textSecondary: '#4f4468',
      textTertiary: '#7b6e96',
      borderSoft: '#e4dbf3',
      borderStrong: '#c8b9e0',
      brand: '#6c4bd8',
      brandHover: '#5738c0',
      brandInk: '#ffffff',
      link: '#6243d4',
      toastBg: '#2e2545',
      tooltipBg: '#271f3b',
      codeBlock: '#f6f2fd',
      codeInline: '#f4effc',
    },
    dark: {
      base: '#12101c',
      layer1: '#1a1728',
      layer2: '#231e33',
      layer3: '#2c2640',
      sidebar: '#15121f',
      menu: '#1a1728',
      bubble: '#272038',
      text: '#efeafb',
      textSecondary: '#c3b8dd',
      textTertiary: '#9a8eb8',
      borderSoft: '#352e4f',
      borderStrong: '#4e436a',
      brand: '#a98bff',
      brandHover: '#c0a8ff',
      brandInk: '#140b2a',
      link: '#b59cff',
      toastBg: '#302747',
      tooltipBg: '#282040',
      codeBlock: '#14111e',
      codeInline: '#1c1829',
    },
  },
  {
    id: 'amber',
    light: {
      base: '#fdfaf3',
      layer1: '#ffffff',
      layer2: '#faf3e4',
      layer3: '#f6ead2',
      sidebar: '#fcf6ec',
      menu: '#fffcf6',
      bubble: '#faefdc',
      text: '#2a2115',
      textSecondary: '#5c4b33',
      textTertiary: '#8a7355',
      borderSoft: '#eddec5',
      borderStrong: '#d6c09c',
      brand: '#c77a0a',
      brandHover: '#a86305',
      brandInk: '#ffffff',
      link: '#b06a05',
      toastBg: '#3d3020',
      tooltipBg: '#34291b',
      codeBlock: '#fbf5ea',
      codeInline: '#faf3e6',
    },
    dark: {
      base: '#17130d',
      layer1: '#201a12',
      layer2: '#2a2218',
      layer3: '#352b1f',
      sidebar: '#1a150e',
      menu: '#201a12',
      bubble: '#332719',
      text: '#f7eddd',
      textSecondary: '#d3c1a5',
      textTertiary: '#ac9779',
      borderSoft: '#3f3425',
      borderStrong: '#59492f',
      brand: '#e9a93c',
      brandHover: '#f7bc5a',
      brandInk: '#241703',
      link: '#f0b452',
      toastBg: '#3a2e1e',
      tooltipBg: '#312718',
      codeBlock: '#19140e',
      codeInline: '#221b13',
    },
  },
]

for (var presetIndex = 0; presetIndex < PRESETS.length; presetIndex += 1) {
  PRESETS[presetIndex].tokens = tokensOf(PRESETS[presetIndex])
}

function presetOf(id) {
  for (var index = 0; index < PRESETS.length; index += 1) {
    if (PRESETS[index].id === id) return PRESETS[index]
  }
  return null
}

/* ---- applying a preset ------------------------------------------------ */

/** The shared theme service, once it is in scope. */
var themeService = null
/** Removes the layer this component stacked, if it stacked one. */
var layerOff = null
/** The preset id currently painted; `default` means "shipped palette". */
var appliedId = 'default'
/** The id to paint once the theme service arrives, when it was not yet in scope. */
var pendingId = 'default'

/**
 * Paint one preset.
 *
 * The service composes override layers on top of the active theme, so stacking
 * this package's layer replaces whatever it stacked before; `default` removes
 * the layer and lets the shipped palette show through again. No DOM writing
 * happens here: the service publishes and the shipped presenter applies.
 */
function applyTheme(id) {
  var preset = presetOf(id)
  pendingId = preset === null ? 'default' : id
  appliedId = pendingId
  if (themeService === null) return
  if (preset === null || preset.tokens === null) {
    if (layerOff !== null) layerOff()
    layerOff = null
    return
  }
  layerOff = themeService.overrideTokens(LAYER_SOURCE, preset.tokens)
}

/* ---- settings section ------------------------------------------------- */

var React = rt.require('react')
var h = React !== null && typeof React.createElement === 'function' ? React.createElement : null

/** The config form for this row, or `null` when the page has no settings seam. */
function configFormOf(scope) {
  try {
    var forms = scope.configForms
    if (forms === undefined || forms === null || typeof forms.get !== 'function') return null
    var form = forms.get(CONFIG_ENTRY_ID)
    if (form === undefined || form === null || typeof form.getSnapshot !== 'function') return null
    return form
  } catch (error) {
    return null
  }
}

/** The preset id a form snapshot carries. */
function themeOf(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') return 'default'
  var value = snapshot.value
  if (value === null || typeof value !== 'object') return 'default'
  var id = value.theme
  return typeof id === 'string' && id !== '' ? id : 'default'
}

/**
 * One form snapshot, refreshed on every accepted write.
 *
 * The hook count stays fixed when there is no form, so this component can
 * render the section on a page whose settings document is unavailable.
 */
function useThemeSnapshot(form) {
  var pair = React.useState(function () {
    return form === null ? null : form.getSnapshot()
  })
  var snapshot = pair[0]
  var setSnapshot = pair[1]
  React.useEffect(function () {
    if (form === null) return undefined
    return form.subscribe(function () {
      setSnapshot(form.getSnapshot())
    })
  }, [form])
  return snapshot
}

/** The translations, registered into the settings locale namespace. */
var TEXT = {
  'nav': '主题',
  'title': '主题设置',
  'intro': '一套配色换掉整个界面，深浅色仍由「通用 → 外观」控制，每套主题在两种模式下各有一组取值。',
  'saveFailed': '保存失败，本次切换只对当前页面生效',
  'unavailable': '这台机器上没有可写的设置文档，切换只在本次刷新内有效。',
  'name.default': '官方配色',
  'name.whale': '鲸海',
  'name.sakura': '樱',
  'name.mint': '薄荷',
  'name.dusk': '暮紫',
  'name.amber': '琥珀',
  'note.default': '跟随 DSH 自带的中性灰蓝，不做任何覆盖',
  'note.whale': '深海里的一层蓝，冷调但不刺眼',
  'note.sakura': '樱粉配梅子夜色，浅处温柔深处沉静',
  'note.mint': '薄荷青绿，干净、清透',
  'note.dusk': '暮色紫罗兰，安静的一层雾',
  'note.amber': '琥珀暖米金，像灯下的纸',
}

var TEXT_EN = {
  'nav': 'Theme',
  'title': 'Theme',
  'intro': 'One palette for the whole interface. Light and dark still come from General → Appearance; each theme carries a value set for both.',
  'saveFailed': 'Could not save; this switch only lasts for this page',
  'unavailable': 'No writable settings document on this machine; the switch lasts until the page reloads.',
  'name.default': 'Shipped',
  'name.whale': 'Whale',
  'name.sakura': 'Sakura',
  'name.mint': 'Mint',
  'name.dusk': 'Dusk',
  'name.amber': 'Amber',
  'note.default': 'The shipped neutral blue-grey, untouched',
  'note.whale': 'A deep-sea blue, cool without glare',
  'note.sakura': 'Sakura pink over plum night',
  'note.mint': 'Clean, bright mint green',
  'note.dusk': 'Dusky violet, quiet as fog',
  'note.amber': 'Warm amber, like paper under a lamp',
}

/** The section's own chrome; names are prefixed so nothing here can collide. */
var THEME_CSS = `
.duit-section{display:flex;flex-direction:column;gap:12px;box-sizing:border-box;max-width:760px;color:var(--dsw-alias-label-primary)}
.duit-heading{margin:0;font-size:18px;font-weight:600;line-height:26px}
.duit-intro{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.duit-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:10px;margin-top:2px}
.duit-card{display:flex;flex-direction:column;padding:0;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;cursor:pointer;text-align:left;font:inherit;color:var(--dsw-alias-label-primary);transition:border-color .12s ease,box-shadow .12s ease}
.duit-card:hover{border-color:var(--dsw-alias-border-l4);box-shadow:0 2px 10px rgb(0 0 0 / 8%)}
.duit-card[data-active=true]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary) inset}
.duit-card:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.duit-shot{display:flex;align-items:center;gap:7px;box-sizing:border-box;height:64px;padding:10px 12px}
.duit-shotSide{width:12px;align-self:stretch;border-radius:5px}
.duit-shotMain{display:flex;flex:1;flex-direction:column;gap:5px;min-width:0}
.duit-shotLine{height:9px;border-radius:4px;box-sizing:border-box;border:.5px solid transparent}
.duit-shotLineShort{width:56%}
.duit-shotDot{flex:none;width:13px;height:13px;border-radius:50%}
.duit-body{display:flex;align-items:center;gap:8px;padding:9px 12px 3px}
.duit-name{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.duit-check{flex:none;width:14px;height:14px;color:var(--dsw-alias-brand-primary);opacity:0;transition:opacity .12s ease}
.duit-card[data-active=true] .duit-check{opacity:1}
.duit-note{margin:0;padding:0 12px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
.duit-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
`

/** A small tick, drawn inline so the section needs no icon dependency. */
function Tick() {
  return h('svg', {
    className: 'duit-check',
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': 'true',
  }, h('path', {
    d: 'M3.5 8.5l3 3 6-6.5',
    stroke: 'currentColor',
    strokeWidth: '1.6',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }))
}

/** The preview: canvas, sidebar band, two surfaces and the brand dot. */
function Swatch(props) {
  var preset = props.preset
  var light = preset === null ? null : preset.light
  var colors = light === null
    ? { base: '#f5f5f7', sidebar: '#e8e8ec', layer1: '#ffffff', bubble: '#ececef', brand: '#9aa0aa', border: '#d8d8dd' }
    : {
      base: light.base,
      sidebar: light.sidebar,
      layer1: light.layer1,
      bubble: light.bubble,
      brand: light.brand,
      border: light.borderSoft,
    }

  return h('div', { className: 'duit-shot', style: { background: colors.base } }, [
    h('span', { className: 'duit-shotSide', key: 'side', style: { background: colors.sidebar } }),
    h('div', { className: 'duit-shotMain', key: 'main' }, [
      h('span', {
        className: 'duit-shotLine',
        key: 'one',
        style: { background: colors.layer1, borderColor: colors.border },
      }),
      h('span', {
        className: 'duit-shotLine duit-shotLineShort',
        key: 'two',
        style: { background: colors.bubble },
      }),
    ]),
    h('span', { className: 'duit-shotDot', key: 'dot', style: { background: colors.brand } }),
  ])
}

/** One preset card. */
function ThemeCard(props) {
  var t = props.t
  var preset = props.preset
  var selected = props.selected
  var busy = props.busy
  var onPick = props.onPick
  var id = preset === null ? 'default' : preset.id

  return h('button', {
    type: 'button',
    className: 'duit-card',
    'data-active': selected ? 'true' : 'false',
    'aria-pressed': selected ? 'true' : 'false',
    disabled: busy,
    onClick: function () {
      onPick(id)
    },
  }, [
    h(Swatch, { key: 'swatch', preset: preset }),
    h('div', { className: 'duit-body', key: 'body' }, [
      h('span', { className: 'duit-name', key: 'name' }, t('name.' + id)),
      h(Tick, { key: 'tick' }),
    ]),
    h('p', { className: 'duit-note', key: 'note' }, t('note.' + id)),
  ])
}

/**
 * The Settings → Theme section.
 *
 * Picking a card paints at once, then writes the id through this row's config
 * form so the next page load starts on the same palette. A refused write keeps
 * the palette on screen and says so, rather than reverting the user's click.
 */
function ThemeSection(props) {
  var t = props.t
  var form = props.form
  var snapshot = useThemeSnapshot(form)
  var stored = themeOf(snapshot)

  var selectedPair = React.useState(stored)
  var selected = selectedPair[0]
  var setSelected = selectedPair[1]

  var busyPair = React.useState(false)
  var busy = busyPair[0]
  var setBusy = busyPair[1]

  var failedPair = React.useState(false)
  var failed = failedPair[0]
  var setFailed = failedPair[1]

  React.useEffect(function () {
    setSelected(stored)
  }, [stored])

  var pick = function (id) {
    if (id === selected) return
    setSelected(id)
    applyTheme(id)
    if (form === null || form === undefined) return
    setBusy(true)
    setFailed(false)
    var write
    try {
      write = form.mutate([{ op: 'set', path: ['theme'], value: id }])
    } catch (error) {
      setFailed(true)
      setBusy(false)
      return
    }
    Promise.resolve(write)
      .then(function (accepted) {
        if (!accepted) setFailed(true)
      })
      .catch(function () {
        setFailed(true)
      })
      .then(function () {
        setBusy(false)
      })
  }

  var cards = PRESETS.map(function (preset) {
    return h(ThemeCard, {
      key: preset.id,
      t: t,
      preset: preset,
      selected: preset.id === selected,
      busy: busy,
      onPick: pick,
    })
  })
  cards.unshift(h(ThemeCard, {
    key: 'default',
    t: t,
    preset: null,
    selected: selected === 'default',
    busy: busy,
    onPick: pick,
  }))

  var unavailable = snapshot !== null && snapshot !== undefined && snapshot.status === 'unavailable'

  return h('div', { className: 'duit-section' }, [
    h('h2', { className: 'duit-heading', key: 'heading' }, t('title')),
    h('p', { className: 'duit-intro', key: 'intro' }, t('intro')),
    h('div', { className: 'duit-grid', key: 'grid', role: 'group', 'aria-label': t('title') }, cards),
    failed ? h('p', { className: 'duit-error', key: 'failed' }, t('saveFailed')) : null,
    unavailable ? h('p', { className: 'duit-note', key: 'unavailable', style: { padding: 0 } }, t('unavailable')) : null,
  ])
}

/* ---- install ---------------------------------------------------------- */

function install(ctx) {
  ctx.effect(function () {
    return rt.style('theme', THEME_CSS)
  }, 'ui-theme: section sheet')

  // The theme service is provided by the shipped ui-theme package; it may
  // arrive after this row mounts, so the initial paint waits for it.
  ctx.inject(['theme'], function (scope) {
    themeService = scope.theme
    scope.effect(function () {
      return function () {
        if (layerOff !== null) layerOff()
        layerOff = null
        themeService = null
      }
    }, 'ui-theme: release palette layer')
    // `rt.config` is the injected block, and a volatile field with no stored
    // value arrives as `{}`; the accepted value comes from the settings form,
    // which the second injection below adopts.
    var injected = typeof rt.config.theme === 'string' ? rt.config.theme : pendingId
    applyTheme(injected)
  })

  ctx.inject(['slots', 'locale', 'configForms'], function (scope) {
    var form = configFormOf(scope)

    scope.effect(function () {
      return scope.locale.register(SETTINGS_NS, { zh: TEXT, en: TEXT_EN })
    }, 'ui-theme: dictionaries')

    // The accepted value lives in the settings document, not in the injected
    // block (a volatile field arrives as `{}` until a page writes it): read it
    // once the form exists, then adopt every later change. The local paint
    // already won for the click that produced one.
    if (form !== null) {
      var stored = themeOf(form.getSnapshot())
      if (stored !== appliedId) applyTheme(stored)
      scope.effect(function () {
        return form.subscribe(function () {
          var next = themeOf(form.getSnapshot())
          if (next !== appliedId) applyTheme(next)
        })
      }, 'ui-theme: adopt stored preset')
    }

    if (h === null) return
    var t = scope.locale.bind(SETTINGS_NS)
    scope.slots.inject('settings.section', function () {
      return scope.slots.register({
        name: 'settings.section',
        id: 'suite-theme',
        order: SECTION_ORDER,
        label: function () {
          return t('nav')
        },
        locale: SETTINGS_NS,
        inject: function () {
          return { form: form }
        },
      }, ThemeSection)
    })
  })
}

install(rt.ctx)
}
