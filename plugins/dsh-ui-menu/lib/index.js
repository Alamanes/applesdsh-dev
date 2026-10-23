/**
 * dsh-ui-menu host half.
 *
 * This component is a stylesheet, so its host duty is to put the sheet on the
 * page: the token layer first, then its own table. Both are read from disk on
 * every render, so editing the CSS and reloading the page is enough.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'

export const name = 'ui-menu'

const LIB = fileURLToPath(new URL('./', import.meta.url))

export const Config = Schema.object({})

function read(file) {
  try {
    return readFileSync(LIB + file, 'utf8')
  } catch {
    return null
  }
}

function readScript(file) {
  return read(file)
}

function guard(source) {
  return source.replaceAll('</script', '<\\/script')
}

export function apply(ctx, config) {
  const value = config !== null && typeof config === 'object' ? config : {}
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: 'DSHUI_MENU', value })
    const tokens = read('styles/tokens.css')
    const sheet = read('styles/menu.css')
    const css = [tokens, sheet].filter((part) => part !== null).join('\n')
    if (css !== '') table.push({ kind: 'style', text: css })

      if (true) {
        const page = readScript("menu.page.js")
        if (page !== null) table.push({ kind: 'script', placement: 'body', text: guard(page) })
      }
  })
}
