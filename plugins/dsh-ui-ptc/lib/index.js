/**
 * dsh-ui-ptc host half.
 *
 * Page-side only: the component contributes no route and no tool. The one host
 * duty is handing the browser half its configuration — a boot-graph row arrives
 * as `{ id, url, rev }` and never sees the profile config.
 */

export const name = 'ui-ptc'

export function apply(ctx, config) {
  const value = config !== null && typeof config === 'object' ? config : {}
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: 'DSHUI_PTC', value })
  })
}
