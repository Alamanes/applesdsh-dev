/**
 * dsh-ui-status-phrases host half.
 *
 * Page-side only: the component contributes no route or tool. The row still has
 * one host duty — hand the browser half its configuration and the token layer,
 * because a boot-graph row arrives as `{ id, url, rev }` and never sees the
 * profile config.
 */

import Schema from '@deepseek-ai/schemastery'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const name = 'ui-status-phrases'

/**
 * Declared configuration.
 *
 * `phrases` holds the whole list as one multi-line string, one phrase per line.
 * It is volatile so the Settings → General box can edit it; leaving it unset
 * means "use the built-in list" rather than "show nothing".
 */
export const Config = Schema.object({
  phrases: Schema.string().volatile().description('状态行短语，一行一句'),
})

/** Package root, for the bundled token sheet. */
const LIB = fileURLToPath(new URL('./', import.meta.url))

export function apply(ctx, config) {
  const value = config !== null && typeof config === 'object' ? config : {}
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: 'DSHUI_STATUS_PHRASES', value })
    let tokens = null
    try {
      tokens = readFileSync(LIB + 'styles/tokens.css', 'utf8')
    } catch {
      tokens = null
    }
    if (tokens !== null) table.push({ kind: 'style', text: tokens })
  })
}
