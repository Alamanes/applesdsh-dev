/**
 * Host half of the dsh-ui-copy suite.
 *
 * One loader row (`ui-copy`) carries every browser component. The host half has
 * three duties, all of them about the page rather than about behaviour:
 *
 *   1. declare the configuration — one block per component plus the theme block,
 *      so the plugin page can switch components and the profile can set them;
 *   2. hand that configuration to the browser half, which cannot read it (a
 *      boot-graph row arrives as `{ id, url, rev }` and `apply(ctx, config)`
 *      always sees an empty config): one `<script>` in `<head>` carrying
 *      `globalThis.DSHUI_CONFIG`;
 *   3. inject the stylesheets — `styles/tokens.css` first, then one sheet per
 *      enabled component — reading them from disk on every page render, so a
 *      visual tweak is a browser refresh, not a reinstall.
 *
 * Why the sheets live on the host half: the loader serves exactly one browser
 * module per package, so a component can neither fetch its own CSS nor be a
 * second browser entry. The tap also keeps every sheet in `<head>` before any
 * component mounts, which is what stops the first paint from flashing shipped
 * colours.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'

import * as hostIdentity from './host/identity.js'
import * as hostPeakValley from './host/peak-valley.js'
import * as hostQuota from './host/quota.js'
import * as hostRestart from './host/restart.js'
import * as hostSessionDelete from './host/session-delete.js'
import * as hostSkillExplorer from './host/skill-explorer.js'
import * as hostWhale from './host/whale.js'

/**
 * Host halves of the components that need one, in load order.
 *
 * A component without a host half needs no entry: `ask`, `composer`, `menu`,
 * `sidebar`, `effortSlider` and `statusPhrases` are page-side only (their
 * configuration is declared in {@link Config} above).
 */
const HOSTS = [hostIdentity, hostSessionDelete, hostPeakValley, hostRestart, hostQuota, hostWhale, hostSkillExplorer]

/** Cordis plugin name; keep it equal to the loading row's id so diagnostics agree. */
export const name = 'ui-copy'

const LIB_DIR = fileURLToPath(new URL('./', import.meta.url))
const STYLES_DIR = fileURLToPath(new URL('./styles/', import.meta.url))
/** Page scripts a component ships to run in `<body>` before the browser half. */
const STYLES_SCRIPT_DIR = LIB_DIR

/** Sheets that are injected whatever the component switches say. */
const ALWAYS = new Set(['tokens.css'])

/**
 * Sheet owner -> config field.
 *
 * A sheet is injected only while its owner is enabled, so switching a component
 * off also removes its rules instead of leaving dead CSS scoped to a DOM the
 * component never renders. Sheets with no entry here are kept: a new component
 * that forgets to register still paints.
 */
const SWITCH_OF = {
  ask: 'ask',
  composer: 'composer',
  menu: 'menu',
  sidebar: 'sidebar',
  copy: 'copy',
  identity: 'identity',
  'session-delete': 'sessionDelete',
  'foot-panels': 'footPanels',
  'peak-valley': 'peakValley',
  'status-phrases': 'statusPhrases',
  restart: 'restart',
  quota: 'quota',
  'effort-slider': 'effortSlider',
  whale: 'whale',
  'skill-explorer': 'skillExplorer',
  suite: 'suite',
}

/**
 * One component's switchable block.
 *
 * `enabled` is the only field the runtime needs; the rest is free-form so a
 * component can declare its own fields here without a schema change. The
 * looseness is deliberate: a component that ships a new option must not require
 * a host upgrade before the plugin page can write it.
 */
function component(extra = {}) {
  return Schema.object({
    enabled: Schema.boolean().default(true).description('启用这个组件'),
    ...extra,
  })
}

/**
 * The profile-facing configuration.
 *
 * The theme block is the whole point of the suite: `light` and `dark` override
 * any `--dshui-*` role per theme, and every component reads roles instead of
 * literals, so a skin is one block of text rather than a component-by-component
 * edit.
 */
export const Config = Schema.object({
  theme: Schema.object({
    /** `--dshui-*` role overrides applied over the defaults, one map per theme. */
    light: Schema.dict(Schema.string()).description('浅色主题的令牌覆盖，键写角色名，如 brand、surface-2'),
    dark: Schema.dict(Schema.string()).description('深色主题的令牌覆盖，键写角色名，如 brand、surface-2'),
  }),
  /** The accent families every component paints with; empty keeps the shipped colour. */
  accent: Schema.object({
    light: Schema.string().volatile().description('浅色强调色，留空跟随官方'),
    dark: Schema.string().volatile().description('深色强调色，留空跟随官方'),
  }),
  copy: component({
    hidePreviewBadge: Schema.boolean().default(true).description('隐藏预览版徽章'),
  }),
  ask: component(),
  composer: component(),
  menu: component(),
  sidebar: component(),
  identity: component({
    name: Schema.string().volatile().description('侧栏左下角的名字'),
    avatar: Schema.string().volatile().description('侧栏左下角的头像路径'),
  }),
  sessionDelete: component({
    sessionsRoot: Schema.string().description('会话日志根目录，默认 <dsh home>/sessions'),
    projectionCacheRoot: Schema.string().description('投影缓存根目录，默认 <dsh home>/storages/session_projcache'),
  }),
  footPanels: component(),
  peakValley: component(),
  statusPhrases: component({
    phrases: Schema.string().description('状态行短语，一行一句'),
  }),
  restart: component(),
  quota: component(),
  effortSlider: component(),
  whale: component({
    quality: Schema.union(['auto', 'low', 'medium', 'high']).default('auto').description('粒子质量'),
    brightness: Schema.number().min(0.35).max(1.4).default(0.9).description('亮度'),
    scale: Schema.number().min(0.72).max(1.25).default(1).description('缩放'),
    interactionStrength: Schema.number().min(0).max(1.5).default(1).description('交互强度'),
    activeDimming: Schema.number().min(0.12).max(0.6).default(0.22).description('回合进行时的压暗'),
  }),
  skillExplorer: component({
    customSkillDirs: Schema.array(Schema.string()).description('额外的技能目录'),
  }),
  suite: component(),
})

/** `quota-surface.css` -> `quota`; `session-delete.css` -> `session-delete`. */
function ownerOf(file) {
  return file
    .replace(/\.css$/, '')
    .replace(/-surface$/, '')
    .replace(/-motion$/, '')
}

/** Is the component that owns this sheet enabled? Unknown sheets are kept. */
function sheetEnabled(file, config) {
  if (ALWAYS.has(file)) return true
  const key = SWITCH_OF[ownerOf(file)]
  if (key === undefined) return true
  const block = config !== null && typeof config === 'object' ? config[key] : undefined
  return !(block !== null && typeof block === 'object' && block.enabled === false)
}

/** Sanitize one token value: a colour, a length, a shadow, plain CSS. */
function tokenValue(value) {
  return typeof value === 'string' ? value.replace(/[;{}<>]/g, '').trim() : ''
}

/** `brand` -> `--dshui-brand`. A leading dash or `--` is accepted too. */
function tokenName(role) {
  const bare = String(role).trim().replace(/^--?/, '')
  return bare.startsWith('dshui-') ? `--${bare}` : `--dshui-${bare}`
}

/** One theme's override block, or `''` when nothing is configured. */
function overrideBlock(selector, tokens) {
  if (tokens === null || typeof tokens !== 'object') return ''
  const lines = []
  for (const [role, value] of Object.entries(tokens)) {
    const css = tokenValue(value)
    if (css === '') continue
    lines.push(`  ${tokenName(role)}: ${css};`)
  }
  if (lines.length === 0) return ''
  return `${selector} {\n${lines.join('\n')}\n}\n`
}

/** The accent families, written into both themes. */
function accentBlock(config) {
  const accent = config !== null && typeof config === 'object' && config.accent !== null && typeof config.accent === 'object'
    ? config.accent
    : {}
  const blocks = []
  const paint = (selector, value) => {
    const colour = tokenValue(value)
    if (colour === '') return
    blocks.push(`${selector} {
  --dshui-brand: ${colour};
  --dshui-brand-fill: ${colour};
  --dshui-link: ${colour};
  --dshui-business: ${colour};
}`)
  }
  paint('body:not([data-ds-dark-theme])', accent.light)
  paint('body[data-ds-dark-theme]', accent.dark)
  return blocks.length === 0 ? '' : `${blocks.join('\n')}\n`
}

/** Every sheet that should reach the page, tokens first. */
function sheetsFor(config) {
  let files = []
  try {
    files = readdirSync(STYLES_DIR).filter((file) => file.endsWith('.css'))
  } catch {
    return ''
  }
  files.sort((left, right) => {
    if (left === 'tokens.css') return -1
    if (right === 'tokens.css') return 1
    return left.localeCompare(right)
  })
  const parts = []
  for (const file of files) {
    if (!sheetEnabled(file, config)) continue
    let css = null
    try {
      css = readFileSync(STYLES_DIR + file, 'utf8')
    } catch {
      continue
    }
    parts.push(`/* ${file} */\n${css.trim()}`)
  }
  const theme = config !== null && typeof config === 'object' && config.theme !== null && typeof config.theme === 'object'
    ? config.theme
    : {}
  const overrides = overrideBlock('body:not([data-ds-dark-theme])', theme.light)
    + overrideBlock('body[data-ds-dark-theme]', theme.dark)
    + accentBlock(config)
  if (overrides !== '') parts.push(`/* profile overrides */\n${overrides.trim()}`)
  return parts.join('\n\n')
}

/** Read one page script, or `null` when it is absent. */
function readPageScript(file) {
  try {
    return readFileSync(STYLES_SCRIPT_DIR + file, 'utf8')
  } catch {
    return null
  }
}

/** Keep an injected script from closing its own element. */
function guard(source) {
  return source.replaceAll('</script', '<\\/script')
}

/**
 * Host body.
 *
 * The rows travel as structured `webserver/index-inject` entries rather than a
 * raw `tapIndex` transform: the desktop shell serves its index.html straight
 * from the app bundle and never runs index taps, while both carriers render
 * structured rows. Three rows, in this order:
 *
 *   1. `global` — the suite configuration as `globalThis.DSHUI_CONFIG`, which is
 *      the only channel the browser half has (see `src/core/entry.js`);
 *   2. `style`  — every enabled sheet, tokens first;
 *   3. `script` — a component's page script in `<body>`, when it ships one.
 *
 * Outside the web carrier there is no `webServer`, so the row contributes its
 * configuration (readable from the plugin page) and nothing else.
 */
export function apply(ctx, config) {
  const value = config !== null && typeof config === 'object' ? config : {}

  // Host halves first: they own routes and tools, and the browser half starts
  // from the same config block through the `global` row below.
  for (const host of HOSTS) {
    const block = value[host.KEY]
    if (block !== null && typeof block === 'object' && block.enabled === false) continue
    try {
      host.apply(ctx, block !== null && typeof block === 'object' ? block : {})
    } catch (error) {
      console.error(`[ui-copy/${host.KEY}] host half failed`, error)
    }
  }

  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: 'DSHUI_CONFIG', value })

    const css = sheetsFor(value)
    if (css !== '') table.push({ kind: 'style', text: `/* dsh-ui-copy suite */\n${css}` })

    if (!sheetEnabled('menu.css', value)) return
    const page = readPageScript('menu.page.js')
    if (page !== null) table.push({ kind: 'script', placement: 'body', text: guard(page) })
  })
}
