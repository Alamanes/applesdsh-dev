/**
 * dsh-ui-copy — the composer card component.
 *
 * A third loader row of the same package (`dsh-ui-copy/composer`), so the bundle
 * shows three separately switchable components in the plugin page: the copy
 * rewrites, the ask surface, and the input card.
 *
 * The stylesheet lives on disk and is re-read every time the injection table is
 * collected, so editing `composer-surface.css` and reloading the page is enough
 * — no rebuild, no restart, and no stylesheet request that can go stale. The
 * route is kept as well, so the sheet can be inspected at
 * /dsh-ui-copy/composer-surface.css while debugging.
 *
 * The sheet travels as a structured `webserver/index-inject` row instead of a
 * raw `tapIndex` transform. The desktop shell serves its index.html straight
 * from the app bundle and never runs index taps, while both carriers render
 * structured rows; a raw tap therefore reaches browsers only.
 *
 * A carrier that never collects the injection table renders no sheet.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const STYLESHEET = fileURLToPath(new URL('./composer-surface.css', import.meta.url))
const ROUTE = '/dsh-ui-copy/composer-surface.css'

/** Leading comment identifying this sheet inside the served document. */
const MARKER = '/* dsh-ui-copy: composer surface */'

/** Read the stylesheet, reporting a readable reason rather than throwing. */
function readStylesheet() {
  try {
    return { css: readFileSync(STYLESHEET, 'utf8') }
  } catch (error) {
    return { error: `dsh-ui-copy: cannot read ${STYLESHEET}: ${String(error?.message ?? error)}` }
  }
}

function serveStylesheet(_req, res) {
  const { css, error } = readStylesheet()
  if (error !== undefined) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`${error}\n`)
    return
  }
  res.writeHead(200, {
    'content-type': 'text/css; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(css),
  })
  res.end(css)
}

export function apply(ctx) {
  // A structured row is the one form both carriers render: the web server
  // renders it into the served index.html, the desktop shell ships the same row
  // through its boot payload.
  ctx.on('webserver/index-inject', (table) => {
    const { css, error } = readStylesheet()
    if (error !== undefined) {
      table.push({
        kind: 'script',
        placement: 'head',
        text: `console.error(${JSON.stringify(error).replaceAll('<', '\\u003c')})`,
      })
      return
    }
    table.push({ kind: 'style', text: `${MARKER}\n${css}` })
  })

  // The route stays for debugging: the desktop shell forwards it to this server.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE, handler: serveStylesheet }))
  })
}
