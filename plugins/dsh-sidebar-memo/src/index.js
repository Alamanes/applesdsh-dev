// dsh-sidebar-memo — host half.
//
// The store (host/store.js) owns the files, the two tools (host/tools.js) are
// what the model writes with, the prompts (host/scribe.js) turn the user's own
// words into her diary and a goal into a critique, and this file wires them to
// the harness: one short prompt section, two tools, the panel's routes under
// api/dsh-memo, and the two background writes the panel asks for.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore, isDate, today } from './host/store.js'
import { createTools } from './host/tools.js'
import { composeDiary, composePlan, composeReview } from './host/scribe.js'

const ROUTE_BASE = '/api/dsh-memo'
/** The panel stylesheet ships as a real file and is served to the browser half. */
const STYLE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'memo.css')
/** The round mark the guide capsule and the tab title show. */
const AVATAR_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'avatar.png')

const MEMO_SECTION = [
  '## 备忘录',
  '右侧边栏的「备忘录」有三页：清单、目标、计划。',
  '清单是待办，用 memo 的 op 读写：一条标题，可选的备注和步骤。',
  '目标是她自己立下的，用 memo 的 goal 参数读写；立下之后用 log 记进展，它不是会话里的 Goal 工具，别用 create_goal 去改她的目标。',
  '计划是她日历上的每日安排，一个目标一份，用 memo 的 plan 参数写：set 整份重排，add 往后追加，每条落到当天能做完的具体动作。她只负责勾完成，你别替她勾。她说要排日程、拆解目标、定一段时间怎么做，你就用 plan 排出来。',
  '日记在目标页里：她口述今天做了什么，你用她的第一人称写成日记，素材里有什么写什么，不编细节。面板自己也会写，别把已经写好的整页重写一遍。',
  '用户说要记的事，直接写进去，不用再问。',
].join('\n')

function writeJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 2_000_000) {
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
  const dataDir = config?.dataDir ?? join(dshHome, 'storages', 'dsh-memo')
  const warn = (message) => {
    try {
      ctx.logger?.warn?.(message)
    } catch { /* no logger */ }
  }

  const store = createStore({ root: dataDir, warn })
  const tools = createTools({ store })

  // What the panel asked for and the model is still working on.
  const jobs = {
    diary: { date: '', running: false, error: '', at: 0 },
    review: { id: '', running: false, error: '', at: 0 },
    plan: { id: '', running: false, error: '', at: 0 },
  }
  let chain = Promise.resolve()

  function runInBackground(task) {
    const next = chain.then(task, task)
    chain = next.then(() => {}, () => {})
    return next
  }

  /** Write today's page from the notes the panel just saved. */
  function writeDiaryNow(date) {
    jobs.diary = { date, running: true, error: '', at: Date.now() }
    return runInBackground(async () => {
      try {
        const notes = await store.readRaw(date)
        if (notes.trim() === '') throw new Error('这一天还没有口述')
        const current = await store.readDiary(date)
        const text = await composeDiary(ctx, { date, notes, current, warn })
        await store.writeDiary(date, text, 'replace')
        jobs.diary = { date, running: false, error: '', at: Date.now() }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        jobs.diary = { date, running: false, error: message, at: Date.now() }
        warn('dsh-sidebar-memo: diary write failed: ' + message)
      }
    })
  }

  /** Read the goal against the days since it was set and store the critique. */
  function reviewGoalNow(id) {
    jobs.review = { id: String(id ?? ''), running: true, error: '', at: Date.now() }
    return runInBackground(async () => {
      let goalId = ''
      try {
        const goal = await store.findGoal(id)
        goalId = goal.id
        const snapshot = await store.state()
        const pages = await store.diaryBetween(goal.since, today(), 14_000)
        const text = await composeReview(ctx, {
          goal,
          pages,
          mood: snapshot.mood,
          custom: snapshot.custom,
          warn,
        })
        await store.reviewGoal(goal.id, { text, mode: snapshot.mood })
        jobs.review = { id: goal.id, running: false, error: '', at: Date.now() }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        jobs.review = { id: goalId, running: false, error: message, at: Date.now() }
        warn('dsh-sidebar-memo: goal review failed: ' + message)
      }
    })
  }

  /** Lay the next stretch of days out for one goal, keeping what is already there. */
  function writePlanNow(id) {
    jobs.plan = { id: String(id ?? ''), running: true, error: '', at: Date.now() }
    return runInBackground(async () => {
      let goalId = ''
      try {
        const goal = await store.findGoal(id)
        goalId = goal.id
        const pages = await store.diaryBetween(goal.since, today(), 10_000)
        const plan = await store.planOf(goal.id)
        const days = await composePlan(ctx, { goal, pages, plan, date: today(), warn })
        await store.addPlanDays({ goalId: goal.id, days })
        jobs.plan = { id: goal.id, running: false, error: '', at: Date.now() }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        jobs.plan = { id: goalId, running: false, error: message, at: Date.now() }
        warn('dsh-sidebar-memo: plan write failed: ' + message)
      }
    })
  }

  ctx.inject(['systemPrompt'], (scope) => {
    scope.effect(() => scope.systemPrompt.section({
      name: 'sidebar-memo',
      order: 646,
      text: () => MEMO_SECTION,
    }), 'dsh-sidebar-memo: prompt section')
  })

  ctx.inject(['tools'], (scope) => {
    scope.effect(() => {
      const disposers = tools.map(tool => scope.tools.register(tool)).filter(dispose => typeof dispose === 'function')
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'dsh-sidebar-memo: tools')
  })

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const state = async (date) => ({ ...(await store.state(date)), jobs })

      const post = (path, run) => ({
        kind: 'exact',
        path: ROUTE_BASE + path,
        handler: (req, res) => {
          void (async () => {
            try {
              if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'POST only' })
              const body = await readJsonBody(req)
              writeJson(res, 200, { ok: true, ...(await run(body)) })
            } catch (error) {
              writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
            }
          })()
        },
      })

      const routes = [
        {
          kind: 'exact',
          path: ROUTE_BASE + '/style',
          handler: (req, res) => {
            void (async () => {
              try {
                const css = await readFile(STYLE_FILE, 'utf8')
                res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-cache' })
                res.end(css)
              } catch (error) {
                res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
                res.end('/* dsh-sidebar-memo: stylesheet missing */')
              }
            })()
          },
        },
        {
          kind: 'exact',
          path: ROUTE_BASE + '/avatar',
          handler: (req, res) => {
            void (async () => {
              try {
                const png = await readFile(AVATAR_FILE)
                res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' })
                res.end(png)
              } catch (error) {
                res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
                res.end('no avatar')
              }
            })()
          },
        },
        {
          kind: 'exact',
          path: ROUTE_BASE + '/state',
          handler: (req, res) => {
            void (async () => {
              try {
                const url = new URL(req.url ?? '/', 'http://x')
                const date = url.searchParams.get('date') ?? ''
                writeJson(res, 200, { ok: true, ...(await state(isDate(date) ? date : today())) })
              } catch (error) {
                writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
              }
            })()
          },
        },
        post('/todo', async (body) => {
          const op = String(body?.op ?? '')
          if (op === 'add') {
            const item = await store.addTodo({ text: body?.text, note: body?.note, steps: body?.steps, by: 'user' })
            return { item, ...(await state(body?.date)) }
          }
          if (op === 'edit') {
            const patch = {}
            if (body?.text !== undefined) patch.text = body.text
            if (body?.note !== undefined) patch.note = body.note
            if (body?.steps !== undefined) patch.steps = body.steps
            if (Object.keys(patch).length === 0) throw new Error('edit 至少要给出 text、note、steps 其中一项')
            const item = await store.updateTodo(String(body?.id ?? ''), patch, 'user')
            return { item, ...(await state(body?.date)) }
          }
          if (op === 'toggle') {
            await store.setTodoDone(String(body?.id ?? ''), body?.done === true)
            return { ...(await state(body?.date)) }
          }
          if (op === 'step') {
            await store.setStepDone(String(body?.id ?? ''), body?.index, body?.done === true)
            return { ...(await state(body?.date)) }
          }
          if (op === 'del') {
            await store.removeTodo(String(body?.id ?? ''))
            return { ...(await state(body?.date)) }
          }
          if (op === 'clear') {
            await store.clearDone()
            return { ...(await state(body?.date)) }
          }
          throw new Error('未知的待办操作：' + op)
        }),
        post('/goal', async (body) => {
          const op = String(body?.op ?? '')
          if (op === 'set') {
            const item = await store.saveGoal({
              id: body?.id,
              text: body?.text,
              note: body?.note,
            })
            const fresh = body?.id === undefined || body?.id === ''
            if (fresh) void reviewGoalNow(item.id)
            return { item, ...(await state(body?.date)) }
          }
          if (op === 'log') {
            const item = await store.logGoal(body?.id, body?.log)
            return { item, ...(await state(body?.date)) }
          }
          if (op === 'done') {
            const item = await store.setGoalDone(body?.id, body?.done !== false)
            return { item, ...(await state(body?.date)) }
          }
          if (op === 'drop') {
            await store.removeGoal(body?.id)
            return { ...(await state(body?.date)) }
          }
          throw new Error('未知的目标操作：' + op)
        }),
        post('/goal/review', async (body) => {
          const id = String(body?.id ?? '')
          const goal = await store.findGoal(id)
          void reviewGoalNow(goal.id)
          return { goal: goal.id, ...(await state(body?.date)) }
        }),
        post('/plan/generate', async (body) => {
          const goal = await store.findGoal(body?.goalId)
          void writePlanNow(goal.id)
          return { goal: goal.id, ...(await state(body?.date)) }
        }),
        post('/plan/done', async (body) => {
          const day = isDate(body?.day) ? body.day : today()
          await store.setPlanItemDone({
            goalId: body?.goalId,
            date: day,
            id: String(body?.id ?? ''),
            done: body?.done !== false,
          })
          return { ...(await state(body?.date)) }
        }),
        post('/raw', async (body) => {
          const date = isDate(body?.date) ? body.date : today()
          await store.appendRaw(date, body?.text)
          void writeDiaryNow(date)
          return { ...(await state(date)) }
        }),
        post('/diary/retry', async (body) => {
          const date = isDate(body?.date) ? body.date : today()
          void writeDiaryNow(date)
          return { ...(await state(date)) }
        }),
        post('/mood', async (body) => {
          await store.setMood(body?.mood, body?.custom)
          return { ...(await state(body?.date)) }
        }),
      ]

      const disposers = routes.map(route => scope.webServer.register(route))
      return () => {
        for (const dispose of disposers) if (typeof dispose === 'function') dispose()
      }
    }, 'dsh-sidebar-memo: routes')
  })

  ctx.logger?.info?.('dsh-sidebar-memo: memo at ' + dataDir)
}
