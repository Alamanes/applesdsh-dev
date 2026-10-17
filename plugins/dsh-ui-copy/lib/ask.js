/**
 * dsh-ui-copy — the ask surface component.
 *
 * A second loader row of the same package (`dsh-ui-copy/ask`), so the bundle
 * shows two separately switchable components in the plugin page: the copy
 * rewrites, and this one.
 *
 * The stylesheet lives on disk and is read at render time, so editing
 * `ask-surface.css` and reloading the page is enough — no rebuild, no restart,
 * and no stylesheet request that can go stale. The route is kept as well, so the
 * sheet can be inspected at /dsh-ui-copy/ask-surface.css while debugging.
 *
 * Outside the web carrier there is no `webServer` to inject into, so this row
 * does nothing there.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const STYLESHEET = fileURLToPath(new URL('./ask-surface.css', import.meta.url))
const ROUTE = '/dsh-ui-copy/ask-surface.css'

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
        return html.replace('</head>', `<style data-dsh-ui-copy-ask>${css}</style>\n</head>`)
      })

      return () => {
        removeTap()
        removeRoute()
      }
    })
  })
}
