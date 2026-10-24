/**
 * dsh-ui-chat-diff host half.
 *
 * Page-side only: the component contributes no route and no tool. The one host
 * duty is handing the browser half its configuration and the suite's token
 * layer — a boot-graph row arrives as `{ id, url, rev }` and never sees the
 * profile config.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const name = 'ui-chat-diff'

/** Package root, for the bundled token sheet. */
const LIB = fileURLToPath(new URL('./', import.meta.url))

export function apply(ctx, config) {
  const value = config !== null && typeof config === 'object' ? config : {}
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: 'DSHUI_CHAT_DIFF', value })
    let tokens = null
    try {
      tokens = readFileSync(LIB + 'styles/tokens.css', 'utf8')
    } catch {
      tokens = null
    }
    if (tokens !== null) table.push({ kind: 'style', text: tokens })
  })
}
