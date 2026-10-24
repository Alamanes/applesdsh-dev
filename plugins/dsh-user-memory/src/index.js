// dsh-user-memory — host half.
//
// One agent, one Markdown memory. The engine (host/memory.js) owns the files, the
// three tools (host/tools.js) write them, the review (host/review.js) keeps them
// current after each turn, the panel (host/panel.js) serves the settings page, and
// this file wires all of it to the harness: one system-prompt section per Session,
// three tools, one turn/end listener, and the panel's routes.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createMemory } from './host/memory.js'
import { createReview } from './host/review.js'
import { createPanel } from './host/panel.js'
import { createTools } from './host/tools.js'

const ROUTE_BASE = '/api/dsh-user-memory'

function writeJson(res, status, value) {
  const text = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

export function apply(ctx, config) {
  const dshHome = config?.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const dataDir = config?.dataDir ?? join(dshHome, 'storages', 'user-memory')
  const root = join(dataDir, 'memory')
  const warn = (message) => {
    try {
      ctx.logger?.warn?.(message)
    } catch { /* no logger */ }
  }

  const memory = createMemory({ root, warn })
  const review = createReview({ memory, ctx, warn })
  const panel = createPanel({ memory, ctx, warn })
  const tools = createTools({ memory, warn })

  // The memory section: frozen per Session, so the prompt stays byte-stable and the
  // provider's prefix cache holds.
  ctx.inject(['systemPrompt'], (scope) => {
    scope.effect(() => scope.systemPrompt.section({
      name: 'user-memory',
      order: 645,
      text: (context) => {
        const id = context?.agent?.id ?? context?.session?.id
        return memory.sectionFor(id)
      },
    }), 'dsh-user-memory: prompt section')
  })

  ctx.inject(['tools'], (scope) => {
    scope.effect(() => {
      const disposers = tools.map(tool => scope.tools.register(tool)).filter(dispose => typeof dispose === 'function')
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'dsh-user-memory: tools')
  })

  // A turn that ends schedules its review; the queue runs one at a time.
  ctx.effect(() => {
    const off = ctx.on('session/event', (session, event) => {
      if (event?.type !== 'turn/end') return
      const id = session?.id
      if (typeof id === 'string') review.schedule(id)
    })
    return () => {
      if (typeof off === 'function') off()
      review.dispose()
    }
  }, 'dsh-user-memory: review')

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const routes = [
        {
          kind: 'exact',
          path: ROUTE_BASE + '/view',
          handler: (req, res) => {
            void (async () => {
              try {
                const url = new URL(req.url ?? '/', 'http://x')
                writeJson(res, 200, { ok: true, ...panel.view({ regenerate: url.searchParams.get('regenerate') === '1' }) })
              } catch (error) {
                writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
              }
            })()
          },
        },
        {
          kind: 'exact',
          path: ROUTE_BASE + '/ask',
          handler: (req, res) => {
            void (async () => {
              try {
                if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'POST only' })
                const body = await readJsonBody(req)
                writeJson(res, 200, { ok: true, ...(await panel.ask(body.text)) })
              } catch (error) {
                writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
              }
            })()
          },
        },
        {
          kind: 'exact',
          path: ROUTE_BASE + '/forget',
          handler: (req, res) => {
            void (async () => {
              try {
                if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'POST only' })
                const body = await readJsonBody(req)
                writeJson(res, 200, { ok: true, ...(await panel.forget({ text: body.text, topic: body.topic })) })
              } catch (error) {
                writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
              }
            })()
          },
        },
      ]
      const disposers = routes.map(route => scope.webServer.register(route))
      return () => {
        for (const dispose of disposers) if (typeof dispose === 'function') dispose()
      }
    }, 'dsh-user-memory: routes')
  })

  ctx.logger?.info?.('dsh-user-memory: memory at ' + root)
}
