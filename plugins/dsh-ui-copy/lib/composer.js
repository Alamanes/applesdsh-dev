/**
 * dsh-ui-copy — the composer card component.
 *
 * A third loader row of the same package (`dsh-ui-copy/composer`), so the bundle
 * shows three separately switchable components in the plugin page: the copy
 * rewrites, the ask surface, and the input card.
 *
 * The stylesheet lives on disk and is read at render time, so editing
 * `composer-surface.css` and reloading the page is enough — no rebuild, no
 * restart, and no stylesheet request that can go stale. The route is kept as
 * well, so the sheet can be inspected at /dsh-ui-copy/composer-surface.css
 * while debugging.
 *
 * Outside the web carrier there is no `webServer` to inject into, so this row
 * does nothing there.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const STYLESHEET = fileURLToPath(new URL('./composer-surface.css', import.meta.url))
const ROUTE = '/dsh-ui-copy/composer-surface.css'

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
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.webServer

    webCtx.effect(() => {
      const removeRoute = webServer.register({ kind: 'exact', path: ROUTE, handler: serveStylesheet })

      // A raw tap runs after structured rows, so the block lands last in <head>.
      const removeTap = webServer.tapIndex((html) => {
        if (!html.includes('</head>')) return html
        const { css, error } = readStylesheet()
        if (error !== undefined) {
          return html.replace('</head>', `<script>console.error(${JSON.stringify(error)})</script></head>`)
        }
        return html.replace('</head>', `<style data-dsh-ui-copy-composer>${css}</style>\n</head>`)
      })

      return () => {
        removeTap()
        removeRoute()
      }
    })
  })
}
