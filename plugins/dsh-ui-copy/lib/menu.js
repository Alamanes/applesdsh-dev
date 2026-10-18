/**
 * dsh-ui-copy — the menu motion component.
 *
 * A fourth loader row of the same package (`dsh-ui-copy/menu`), so the bundle
 * shows four separately switchable components in the plugin page: the copy
 * rewrites, the ask surface, the input card, and this one.
 *
 * Two files travel together, and both are re-read every time the injection
 * table is collected, so editing either one and reloading the page is enough —
 * no rebuild, no restart, and no stylesheet request that can go stale:
 *
 *   - `menu-motion.css` rides as a `style` row into `<head>`;
 *   - `menu-motion.page.js` rides as a `script` row into `<body>`.
 *
 * The sheet is presentation only, so a failure to read it costs the motion and
 * nothing else; the script is the observer that drives it, and it is written to
 * fail soft as well. Either failure is reported on the page console instead of
 * being thrown, because a missing file must not take the host down.
 *
 * The rows travel as structured `webserver/index-inject` entries rather than
 * raw `tapIndex` transforms: the desktop shell serves its index.html straight
 * from the app bundle and never runs index taps, while both carriers render
 * structured rows.
 *
 * The routes stay for debugging: `/dsh-ui-copy/menu-motion.css` and
 * `/dsh-ui-copy/menu-motion.js` always answer with what the page is running.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SHEET = fileURLToPath(new URL('./menu-motion.css', import.meta.url))
const SCRIPT = fileURLToPath(new URL('./menu-motion.page.js', import.meta.url))

const SHEET_ROUTE = '/dsh-ui-copy/menu-motion.css'
const SCRIPT_ROUTE = '/dsh-ui-copy/menu-motion.js'

/** Leading comment identifying this component inside the served document. */
const MARKER = '/* dsh-ui-copy: menu motion */'

/** Read one file, reporting a readable reason rather than throwing. */
function read(path) {
  try {
    return { text: readFileSync(path, 'utf8') }
  } catch (error) {
    return { error: `dsh-ui-copy: cannot read ${path}: ${String(error?.message ?? error)}` }
  }
}

/** Keep an injected script from closing its own element. */
function guard(source) {
  return source.replaceAll('</script', '<\\/script')
}

/** Answer a debug route with the file as it stands on disk right now. */
function serve(path, type) {
  return (_req, res) => {
    const { text, error } = read(path)
    if (error !== undefined) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`${error}\n`)
      return
    }
    res.writeHead(200, {
      'content-type': `${type}; charset=utf-8`,
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(text),
    })
    res.end(text)
  }
}

/** Report a read failure on the page console, where the maintainer is looking. */
function report(table, error) {
  table.push({
    kind: 'script',
    placement: 'body',
    text: `console.error(${JSON.stringify(error).replaceAll('<', '\\u003c')})`,
  })
}

export function apply(ctx) {
  // A structured row is the one form both carriers render: the web server
  // renders it into the served index.html, the desktop shell ships the same row
  // through its boot payload.
  ctx.on('webserver/index-inject', (table) => {
    const sheet = read(SHEET)
    if (sheet.error === undefined) table.push({ kind: 'style', text: `${MARKER}\n${sheet.text}` })
    else report(table, sheet.error)

    const script = read(SCRIPT)
    if (script.error === undefined) {
      table.push({ kind: 'script', placement: 'body', text: `${MARKER}\n${guard(script.text)}` })
    } else {
      report(table, script.error)
    }
  })

  // The routes stay for debugging: the desktop shell forwards them to this server.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const removeSheet = webCtx.webServer.register({ kind: 'exact', path: SHEET_ROUTE, handler: serve(SHEET, 'text/css') })
      const removeScript = webCtx.webServer.register({
        kind: 'exact',
        path: SCRIPT_ROUTE,
        handler: serve(SCRIPT, 'text/javascript'),
      })
      return () => {
        removeScript()
        removeSheet()
      }
    })
  })
}
