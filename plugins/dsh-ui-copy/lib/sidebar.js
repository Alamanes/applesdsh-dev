/**
 * dsh-ui-copy — the sidebar quiet component.
 *
 * A fifth loader row of the same package (`dsh-ui-copy/sidebar`), so the bundle
 * shows five separately switchable components in the plugin page.
 *
 * One stylesheet, no behaviour: `sidebar-surface.css` repaints the sidebar's
 * New Session button as one more row of the global panel list. The file is
 * re-read every time the injection table is collected, so editing it and
 * reloading the page is enough — no rebuild, no restart, and no stylesheet
 * request that can go stale.
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

const STYLESHEET = fileURLToPath(new URL('./sidebar-surface.css', import.meta.url))
const ROUTE = '/dsh-ui-copy/sidebar-surface.css'

/** Leading comment identifying this sheet inside the served document. */
const MARKER = '/* dsh-ui-copy: sidebar quiet */'

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
  ctx.on('webserver/index-inject', (table) => {
    const { css, error } = readStylesheet()
    if (error !== undefined) {
      table.push({
        kind: 'script',
        placement: 'body',
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
