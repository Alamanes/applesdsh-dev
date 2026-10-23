/**
 * dsh-ui-theme host half.
 *
 * One duty: hand the browser half this row's configuration. The theme presets
 * themselves are registered in the browser through `ctx.theme`, because that is
 * the service the shipped presenter applies: it writes every key of the active
 * theme's token map onto `body` as an inline custom property, which is what
 * makes one preset repaint the whole interface instead of just the suite.
 *
 * The chosen preset persists as this row's `theme` config field. The Settings →
 * Theme section writes that field through `configForms`, so it is declared
 * `volatile`: a value a page may edit without reloading the host.
 *
 * The configuration travels as a `global` injection row (`window.DSHUI_THEME`),
 * which is the only channel a boot-graph row has: it arrives as `{ id, url, rev }`
 * and `apply(ctx, config)` always sees an empty config.
 */

import Schema from '@deepseek-ai/schemastery'

/** Cordis plugin name; keep it equal to the loading row's id so diagnostics agree. */
export const name = 'ui-theme'

/**
 * Declared configuration.
 *
 * `theme` is a preset id (`default` paints nothing and leaves the shipped
 * palette alone). The browser half ignores an id it does not know, so a stale
 * value saved by an older release degrades to the shipped colours.
 */
export const Config = Schema.object({
  theme: Schema.string()
    .default('default')
    .volatile()
    .description('主题预设：default / whale / sakura / mint / dusk / amber'),
})

export function apply(ctx, config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  // A volatile field with no stored value arrives as `{}` rather than as its
  // schema default, so the injected row always carries a usable id.
  const theme = typeof raw.theme === 'string' && raw.theme !== '' ? raw.theme : 'default'
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: 'DSHUI_THEME', value: { theme } })
  })
}
