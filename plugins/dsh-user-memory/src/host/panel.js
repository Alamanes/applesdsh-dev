// The memory panel: a summary the model writes over the entries, the entries
// themselves, and one ask-or-update call whose changes take the same path as the tools.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanEntry, cleanTopic, parseAsk, MEMORY_LIMITS } from './store.js'
import { askOnce } from './model.js'

const SUMMARY_MAX = 8_000
const ASK_MAX = 2_000
const CHANGES_MAX = 20

const summarySystem = () => '你在给用户写一份关于她本人的画像摘要，显示在一个叫「记忆」的面板里。你只复述已经存下的条目，绝不添加新的内容。读起来要像一个熟悉她的人对她的了解，不能写成项目清单或技术备忘录。'

const summaryRequest = ({ lines, language }) => [
  '下面是这份记忆里所有的条目，每行一条，[[name]] 表示一个主题文件。',
  '',
  ...(lines.length > 0 ? lines : ['(还没有条目)']),
  '',
  '用' + language + '写摘要，用「你」称呼用户，写的是她这个人。格式固定成这样：',
  '',
  '第一行是「## 总览」，下面两到四句话，概括她最要紧的几点：她是谁、怎么说话、最近在忙什么、在意什么。',
  '之后按内容分一到四节。每节标题是二到六个字的名词短语，概括一个领域，例如「交流偏好」「学习与计划」「AI 与技术兴趣」「设备与创作」「兴趣」。标题必须是名词短语：不许用问句，不许用句子，不许把某一条事实本身当标题。',
  '每节写一段三到六句的连贯叙述，把相关的条目编织进句子里。不分点、不加粗、不用表格。同一主题下的多条事实必须合进同一节，撑不起两句话的主题并进最接近的那一节，不要单独成节。',
  '同一件事只说一次。只写条目里有的内容：不要猜测，不要建议，不要写来源和日期。标题之外不要出现任何文字，第一个标题之前和最后一段之后都不要有。',
].join('\n')

const askSystem = () => [
  '你负责维护这个助手的一份长期记忆，用户正在「记忆」面板里跟你说话。你能看到全部条目，已经编号。你只根据这些条目回答，或者按用户的要求改动它们。',
  '只回一个 JSON 对象：{"reply": "…", "changes": […]}',
  '- reply：一到三句，对用户说的话。说清楚你改了什么，或者回答问题；条目里没有的就说没有。用户看不到条目编号，所以绝不要提编号。',
  '- changes：除非用户要求新增、修改或删除，否则是空数组。每条是下面之一：',
  '  {"op": "add", "text": "…"}  新增一条',
  '  {"op": "edit", "entry": 3, "text": "…"}  替换第 3 条',
  '  {"op": "remove", "entry": 3}  删除第 3 条',
  '- 一条是 ' + MEMORY_LIMITS.entry + ' 字以内、能独立看懂、说清是关于谁的一句事实。绝不保存密钥或密码。',
].join('\n')

const askRequest = ({ numbered, language, text }) => [
  '记忆里现有的条目：',
  ...(numbered.length > 0 ? numbered.map((item, index) => '[' + (index + 1) + ']' + (item.file.topic ? ' (topic ' + item.file.topic + ')' : '') + ' ' + item.text) : ['(还没有)']),
  '',
  'reply 和新写的条目都用' + language + '。用户说：',
  text,
].join('\n')

/**
 * Build the panel operations around one memory engine.
 * @param params.memory - the engine from createMemory.
 * @param params.ctx - host plugin context.
 * @param params.warn - logger for non-fatal problems.
 */
export function createPanel({ memory, ctx, warn = () => {} }) {
  const summaryPath = join(memory.root, 'summaries', 'panel.json')
  let cached
  const saved = () => {
    if (cached !== undefined) return cached
    try {
      const value = JSON.parse(readFileSync(summaryPath, 'utf8'))
      if (typeof value?.hash === 'string' && typeof value.text === 'string') {
        cached = value
        return value
      }
    } catch { /* none yet */ }
    return undefined
  }
  const linesOf = () => memory.allEntries(memory.load()).map(entry => (entry.file.topic ? '[[' + entry.file.topic + ']] ' : '') + entry.text)

  const entries = () => memory.allEntries(memory.load()).map(entry => ({
    topic: entry.file.topic ?? null,
    text: entry.text,
    added: entry.meta.added ?? null,
    source: entry.meta.source ?? null,
  }))

  const sizes = () => {
    const files = memory.load()
    return { main: files[0].content.length, topics: files.slice(1).map(file => ({ topic: file.topic, size: file.content.length })) }
  }

  let summarizing = false
  let failures = new Map()
  async function refreshSummary(hash, language) {
    if (summarizing) return
    summarizing = true
    try {
      const text = await askOnce(ctx, { system: summarySystem(), text: summaryRequest({ lines: linesOf(), language }), warn })
      const value = { hash, text: text.slice(0, SUMMARY_MAX), at: Date.now() }
      cached = value
      await memory.writeText(summaryPath, JSON.stringify(value, null, 2))
      failures.delete(hash)
    } catch (error) {
      failures.set(hash, error?.message ?? String(error))
      warn('dsh-user-memory: summary failed: ' + (error?.message ?? error))
    } finally {
      summarizing = false
    }
  }

  /** Everything the panel shows; starts a summary refresh in the background. */
  function view({ regenerate = false } = {}) {
    const list = entries()
    const sizesNow = sizes()
    const hash = createHash('sha256').update(JSON.stringify(linesOf())).digest('hex')
    const current = saved()
    const stale = current?.hash !== hash
    if (list.length > 0 && (regenerate || stale) && !summarizing) void refreshSummary(hash, '中文')
    return {
      entries: list,
      sizes: sizesNow,
      limits: MEMORY_LIMITS,
      summary: list.length > 0 && current !== undefined ? { text: current.text, at: current.at } : null,
      fresh: list.length === 0 || current?.hash === hash,
      summarizing,
      error: stale ? failures.get(hash) ?? null : null,
    }
  }

  /** One question or change from the panel; its changes take the tools' path. */
  async function ask(raw) {
    const text = String(raw ?? '').trim().slice(0, ASK_MAX)
    if (text === '') throw new Error('先写一句要问的或要改的。')
    const numbered = memory.allEntries(memory.load())
    const answer = parseAsk(await askOnce(ctx, {
      system: askSystem(),
      text: askRequest({ numbered, language: '中文', text }),
      warn,
    }))
    const meta = { source: '面板', added: new Date().toLocaleDateString('en-CA') }
    const changes = []
    for (const change of answer.changes.slice(0, CHANGES_MAX)) {
      const op = String(change?.op ?? '')
      const target = numbered[Number(change?.entry) - 1]
      const next = cleanEntry(change?.text)
      try {
        if (op !== 'add' && target === undefined) throw new Error('没有第 ' + change?.entry + ' 条。')
        if (op === 'add' || op === 'edit') {
          const problem = memory.entryProblem(next)
          if (problem) throw new Error(problem)
        }
        if (op === 'add') await memory.addEntry({ topic: change?.topic !== undefined ? cleanTopic(String(change.topic)) : undefined, text: next, meta })
        else if (op === 'edit') await memory.replaceEntry({ topic: target.file.topic, match: target.text, text: next, meta })
        else if (op === 'remove') await memory.removeEntry({ topic: target.file.topic, match: target.text })
        else continue
        changes.push({ op, text: op === 'remove' ? target.text : next, ok: true })
      } catch (error) {
        changes.push({ op, text: op === 'remove' ? target?.text ?? '' : next, ok: false, error: error.message })
      }
    }
    return { reply: answer.reply, changes, view: view() }
  }

  /** Remove one entry from the list. */
  async function forget({ text, topic }) {
    await memory.removeEntry({ topic: topic === null || topic === undefined ? undefined : cleanTopic(topic), match: String(text ?? '') })
    return view()
  }

  return { view, ask, forget }
}
