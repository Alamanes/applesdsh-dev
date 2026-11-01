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
    },
  },
  {
    id: 'graphite',
    light: {
      base: '#f6f7f8', layer1: '#ffffff', layer2: '#eef0f2', layer3: '#e4e7ea',
      sidebar: '#f1f3f5', menu: '#fafbfc', bubble: '#e9ecef',
      text: '#15181b', textSecondary: '#4a5058', textTertiary: '#78818b',
      borderSoft: '#dfe3e7', borderStrong: '#c3c9d0',
      brand: '#3a4450', brandHover: '#2a323c', brandInk: '#ffffff', link: '#2f6bb0',
      toastBg: '#2b3038', tooltipBg: '#23282e', codeBlock: '#f2f4f6', codeInline: '#eef1f3',
    },
    dark: {
      base: '#131518', layer1: '#1a1d21', layer2: '#22262b', layer3: '#2a2f35',
      sidebar: '#16191d', menu: '#1a1d21', bubble: '#262b31',
      text: '#eef1f4', textSecondary: '#b3bac2', textTertiary: '#868f99',
      borderSoft: '#31373e', borderStrong: '#474f58',
      brand: '#9aa6b4', brandHover: '#b6c1cd', brandInk: '#101316', link: '#7fa8d8',
      toastBg: '#2c323a', tooltipBg: '#232830', codeBlock: '#15181c', codeInline: '#1d2126',
    },
  },
  {
    id: 'clay',
    light: {
      base: '#fbf6f2', layer1: '#ffffff', layer2: '#f7ede6', layer3: '#f1e0d5',
      sidebar: '#f9f1ea', menu: '#fdf9f5', bubble: '#f4e4d9',
      text: '#2b1d16', textSecondary: '#5f4435', textTertiary: '#8f6f5c',
      borderSoft: '#e9d5c6', borderStrong: '#d2b19b',
      brand: '#b5563a', brandHover: '#96422a', brandInk: '#ffffff', link: '#a34a30',
      toastBg: '#3e2a20', tooltipBg: '#352219', codeBlock: '#f9f2ec', codeInline: '#f7ede5',
    },
    dark: {
      base: '#191310', layer1: '#221a16', layer2: '#2c221d', layer3: '#372a23',
      sidebar: '#1c1512', menu: '#221a16', bubble: '#35251d',
      text: '#f7ece4', textSecondary: '#d5baa9', textTertiary: '#ad8e7b',
      borderSoft: '#42322a', borderStrong: '#5c463a',
      brand: '#e08060', brandHover: '#f09a7c', brandInk: '#2a120a', link: '#e8967a',
      toastBg: '#3c2b22', tooltipBg: '#32241c', codeBlock: '#1b1411', codeInline: '#241b16',
    },
  },
  {
    id: 'forest',
    light: {
      base: '#f4f9f4', layer1: '#ffffff', layer2: '#e9f3e9', layer3: '#dceddc',
      sidebar: '#eff7ef', menu: '#f8fcf8', bubble: '#e2f0e2',
      text: '#152414', textSecondary: '#3d5a3a', textTertiary: '#6b8a67',
      borderSoft: '#d4e5d3', borderStrong: '#b0cdaf',
      brand: '#2f7a3c', brandHover: '#226430', brandInk: '#ffffff', link: '#2b7038',
      toastBg: '#24382a', tooltipBg: '#1d3024', codeBlock: '#f2f8f2', codeInline: '#eaf4ea',
    },
    dark: {
      base: '#0f1710', layer1: '#151f16', layer2: '#1c281d', layer3: '#243226',
      sidebar: '#121b13', menu: '#151f16', bubble: '#223024',
      text: '#e7f1e6', textSecondary: '#b0c8ad', textTertiary: '#86a183',
      borderSoft: '#2b3b2c', borderStrong: '#3e5440',
      brand: '#66b573', brandHover: '#86cb91', brandInk: '#08140a', link: '#7fc48a',
      toastBg: '#26372a', tooltipBg: '#1f2e22', codeBlock: '#111a12', codeInline: '#182117',
    },
  },
  {
    id: 'sunset',
    light: {
      base: '#fef8f4', layer1: '#ffffff', layer2: '#fdf0e8', layer3: '#fbe3d5',
      sidebar: '#fdf4ed', menu: '#fffaf7', bubble: '#fce8da',
      text: '#2d1b12', textSecondary: '#6a4632', textTertiary: '#9a7059',
      borderSoft: '#f0dbcb', borderStrong: '#dcb9a1',
      brand: '#e2622e', brandHover: '#c44e1f', brandInk: '#ffffff', link: '#cf5626',
      toastBg: '#40281c', tooltipBg: '#372116', codeBlock: '#fdf5ef', codeInline: '#fceee4',
    },
    dark: {
      base: '#1a110c', layer1: '#231710', layer2: '#2d1e15', layer3: '#39261b',
      sidebar: '#1d130d', menu: '#231710', bubble: '#3a2418',
      text: '#f9eadf', textSecondary: '#dab9a4', textTertiary: '#b48e75',
      borderSoft: '#45301f', borderStrong: '#5f4330',
      brand: '#ff8b52', brandHover: '#ffa473', brandInk: '#2c1205', link: '#ff9d68',
      toastBg: '#3f2a1c', tooltipBg: '#352215', codeBlock: '#1c1310', codeInline: '#261a14',
    },
  },
  {
    id: 'lavender',
    light: {
      base: '#f8f6fd', layer1: '#ffffff', layer2: '#f1edfa', layer3: '#e8e1f6',
      sidebar: '#f4f1fc', menu: '#fbf9fe', bubble: '#ece5f8',
      text: '#1e1830', textSecondary: '#4c4070', textTertiary: '#7b6d9d',
      borderSoft: '#ded5f0', borderStrong: '#c2b6e2',
      brand: '#7357c9', brandHover: '#5b41ab', brandInk: '#ffffff', link: '#6a4fc0',
      toastBg: '#2e2647', tooltipBg: '#261f3c', codeBlock: '#f6f3fc', codeInline: '#f1ecfa',
    },
    dark: {
      base: '#131020', layer1: '#1a1628', layer2: '#221c34', layer3: '#2b2441',
      sidebar: '#15121f', menu: '#1a1628', bubble: '#2a2242',
      text: '#efeaf9', textSecondary: '#c3b8dd', textTertiary: '#9789b5',
      borderSoft: '#332b4a', borderStrong: '#473d63',
      brand: '#a792f0', brandHover: '#bfaefd', brandInk: '#120c22', link: '#b4a1f5',
      toastBg: '#2c2542', tooltipBg: '#241e37', codeBlock: '#151221', codeInline: '#1d1830',
    },
  },
  {
    id: 'sky',
    light: {
      base: '#f3f9fd', layer1: '#ffffff', layer2: '#e8f4fc', layer3: '#d9ecfa',
      sidebar: '#eef7fd', menu: '#f8fcfe', bubble: '#e0f1fb',
      text: '#0f2434', textSecondary: '#3a5b70', textTertiary: '#6a8ba1',
      borderSoft: '#cfe4f2', borderStrong: '#a8cbe3',
      brand: '#1783d4', brandHover: '#0f6cb3', brandInk: '#ffffff', link: '#1477c2',
      toastBg: '#1d3446', tooltipBg: '#162b3b', codeBlock: '#f0f8fd', codeInline: '#e9f5fc',
    },
    dark: {
      base: '#0b1823', layer1: '#101f2c', layer2: '#162838', layer3: '#1d3347',
      sidebar: '#0d1a26', menu: '#101f2c', bubble: '#1a3245',
      text: '#e5f2fb', textSecondary: '#a8c6dc', textTertiary: '#7d9db4',
      borderSoft: '#22394d', borderStrong: '#325169',
      brand: '#52aef2', brandHover: '#7cc4fb', brandInk: '#05131f', link: '#6fbbf7',
      toastBg: '#1f3549', tooltipBg: '#182b3c', codeBlock: '#0e1b27', codeInline: '#152433',
    },
  },
  {
    id: 'sand',
    light: {
      base: '#faf8f2', layer1: '#ffffff', layer2: '#f4efe3', layer3: '#ece4d2',
      sidebar: '#f7f4ec', menu: '#fcfaf5', bubble: '#f0e8d8',
      text: '#26221a', textSecondary: '#55503f', textTertiary: '#857e68',
      borderSoft: '#e4dcc9', borderStrong: '#cbbfa3',
      brand: '#8a7434', brandHover: '#6f5d27', brandInk: '#ffffff', link: '#7d6a2e',
      toastBg: '#35301f', tooltipBg: '#2c281a', codeBlock: '#f8f5ee', codeInline: '#f4efe3',
    },
    dark: {
      base: '#16140f', layer1: '#1d1a14', layer2: '#25221a', layer3: '#2e2a20',
      sidebar: '#191612', menu: '#1d1a14', bubble: '#2c281c',
      text: '#f3efe2', textSecondary: '#cdc4ac', textTertiary: '#a39a80',
      borderSoft: '#373225', borderStrong: '#4d4733',
      brand: '#d0b062', brandHover: '#e3c47b', brandInk: '#241f0e', link: '#d9bc74',
      toastBg: '#332e20', tooltipBg: '#2a2619', codeBlock: '#18150f', codeInline: '#211d15',
    },
  },
  {
    id: 'rosewood',
    light: {
      base: '#fbf5f5', layer1: '#ffffff', layer2: '#f6eaea', layer3: '#efdcdc',
      sidebar: '#f9f0f0', menu: '#fdf8f8', bubble: '#f2e2e2',
      text: '#2a1518', textSecondary: '#5e3b40', textTertiary: '#8e676c',
      borderSoft: '#e6cfd1', borderStrong: '#cfa9ad',
      brand: '#a83646', brandHover: '#8a2735', brandInk: '#ffffff', link: '#9c2f3f',
      toastBg: '#3a1f24', tooltipBg: '#31191e', codeBlock: '#faf3f3', codeInline: '#f6ebeb',
    },
    dark: {
      base: '#180f11', layer1: '#201417', layer2: '#2a1a1e', layer3: '#342127',
      sidebar: '#1b1113', menu: '#201417', bubble: '#362025',
      text: '#f6e7e9', textSecondary: '#d3b1b6', textTertiary: '#ab8189',
      borderSoft: '#3f282d', borderStrong: '#583a41',
      brand: '#e2737f', brandHover: '#f0909b', brandInk: '#2a0c11', link: '#ea8b96',
      toastBg: '#382026', tooltipBg: '#2f1b20', codeBlock: '#1a1012', codeInline: '#231519',
    },
  },
  {
    id: 'mono',
    light: {
      base: '#ffffff', layer1: '#ffffff', layer2: '#f5f5f5', layer3: '#eaeaea',
      sidebar: '#f7f7f7', menu: '#ffffff', bubble: '#f0f0f0',
      text: '#000000', textSecondary: '#3d3d3d', textTertiary: '#6b6b6b',
      borderSoft: '#e0e0e0', borderStrong: '#bdbdbd',
      brand: '#111111', brandHover: '#000000', brandInk: '#ffffff', link: '#000000',
      toastBg: '#1a1a1a', tooltipBg: '#111111', codeBlock: '#f7f7f7', codeInline: '#f2f2f2',
    },
    dark: {
      base: '#000000', layer1: '#0a0a0a', layer2: '#141414', layer3: '#1e1e1e',
      sidebar: '#060606', menu: '#0a0a0a', bubble: '#1c1c1c',
      text: '#ffffff', textSecondary: '#c4c4c4', textTertiary: '#8f8f8f',
      borderSoft: '#232323', borderStrong: '#3a3a3a',
      brand: '#f2f2f2', brandHover: '#ffffff', brandInk: '#000000', link: '#e6e6e6',
      toastBg: '#1a1a1a', tooltipBg: '#111111', codeBlock: '#060606', codeInline: '#101010',
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
  'name.graphite': '石墨',
  'name.clay': '陶土',
  'name.forest': '森林',
  'name.sunset': '落日',
  'name.lavender': '薰衣草',
  'name.sky': '晴空',
  'name.sand': '沙丘',
  'name.rosewood': '玫瑰木',
  'name.mono': '纯黑白',
  'note.graphite': '冷调灰阶，安静不抢戏',
  'note.clay': '暖砖红，像晒过的一面墙',
  'note.forest': '深林绿，沉下来的安静',
  'note.sunset': '橘红余晖，落在纸上的暖',
  'note.lavender': '淡紫一层雾，轻轻压着页面',
  'note.sky': '清亮的蓝，像正午的天',
  'note.sand': '米沙色，晒暖的纸',
  'note.rosewood': '酒红木纹，深色的体面',
  'note.mono': '去掉所有颜色，只剩黑白灰',
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
  'name.graphite': 'Graphite',
  'name.clay': 'Clay',
  'name.forest': 'Forest',
  'name.sunset': 'Sunset',
  'name.lavender': 'Lavender',
  'name.sky': 'Sky',
  'name.sand': 'Sand',
  'name.rosewood': 'Rosewood',
  'name.mono': 'Mono',
  'note.graphite': 'Cool greys, quiet in the background',
  'note.clay': 'Warm brick red, like a sun-warmed wall',
  'note.forest': 'Deep green, settled and still',
  'note.sunset': 'Orange afterglow on warm paper',
  'note.lavender': 'A pale violet haze over the page',
  'note.sky': 'Clear bright blue, like noon',
  'note.sand': 'Sun-warmed paper in dune beige',
  'note.rosewood': 'Wine-red woodgrain, dark and composed',
  'note.mono': 'No colour at all, only black and white',
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
