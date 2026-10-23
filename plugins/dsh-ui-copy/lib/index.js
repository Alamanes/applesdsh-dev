/**
 * Host half of dsh-ui-copy.
 *
 * One component, one duty: hand the browser half its configuration and put the
 * suite's token layer on the page. The copy rewrites are all browser-side;
 * nothing here serves a route.
 *
 * The configuration travels as a `global` injection row (`window.DSHUI_COPY`),
 * which is the only channel a boot-graph row has: it arrives as `{ id, url, rev }`
 * and `apply(ctx, config)` always sees an empty config.
 *
 * The suite's accent row used to live here. It is gone: `dsh-ui-theme` owns the
 * whole interface's palette now, and a second per-theme accent field would fight
 * that layer instead of composing with it.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'

/** Cordis plugin name; keep it equal to the loading row's id so diagnostics agree. */
export const name = 'ui-copy'

const LIB = fileURLToPath(new URL('./', import.meta.url))

/** Declared configuration. */
export const Config = Schema.object({
  hidePreviewBadge: Schema.boolean().default(true).description('隐藏预览版徽章'),
})

function read(relative) {
  try {
    return readFileSync(LIB + relative, 'utf8')
  } catch {
    return null
  }
}

export function apply(ctx, config) {
  const value = config !== null && typeof config === 'object' ? config : {}
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: 'DSHUI_COPY', value })
    const tokens = read('styles/tokens.css')
    if (tokens !== null) table.push({ kind: 'style', text: tokens })
  })
}
