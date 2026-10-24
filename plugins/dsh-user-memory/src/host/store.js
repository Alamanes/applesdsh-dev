// Memory files in the Agent Memory Repo layout: one entry per bullet line ending in
// `[key: value; …]` metadata, a MEMORY.md entry point whose `## Index` links topic
// files as [[topic]], and a journal of every change beside them.
//
// This module holds the format: parsing, the one place that decides whether a line
// can be an entry, and the two protections (size, secrets) that every write goes
// through. Nothing here touches the host context.

/** Fixed sizes, in characters. Everything is counted in characters, not bytes. */
export const MEMORY_LIMITS = { entry: 300, main: 4_000, topic: 16_000, topics: 40 }

export const MAIN = 'MEMORY.md'
export const EMPTY_MAIN = '# Memory\n\n## Index\n'

const INDEX = /^##\s+index\s*$/i
const HEADING = /^#{1,6}\s/
const META = /\s*\[([A-Za-z][\w-]*:[^\];]*(?:;\s*[A-Za-z][\w-]*:[^\];]*)*)\]\s*$/

/** Split an entry line into its text and its trailing metadata pairs. */
export function splitMeta(body) {
  const found = META.exec(body)
  if (found === null) return { text: body.trim(), meta: {} }
  const meta = {}
  for (const pair of found[1].split(';')) {
    const at = pair.indexOf(':')
    if (at === -1) continue
    const key = pair.slice(0, at).trim().toLowerCase()
    if (key !== '') meta[key] = pair.slice(at + 1).trim()
  }
  return { text: body.slice(0, found.index).trim(), meta }
}

const metaValue = value => String(value ?? '').replace(/[;[\]\n]/g, ' ').replace(/\s+/g, ' ').trim()

/** Render one entry line, metadata included. */
export function formatEntry(text, meta = {}) {
  const pairs = Object.entries(meta).filter(([, value]) => metaValue(value) !== '').map(([key, value]) => `${key}: ${metaValue(value)}`)
  return `- ${text}${pairs.length > 0 ? ` [${pairs.join('; ')}]` : ''}`
}

/** One entry's text, without a bullet or metadata of its own: the writer adds those. */
export function cleanEntry(raw) {
  const line = String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/^(?:[-*•]\s+)+/, '')
  return splitMeta(line).text
}

/** A flat topic name: lower case, no spaces, because file systems fold case. */
export function cleanTopic(raw) {
  const name = String(raw ?? '').trim().replace(/^\[\[|\]\]$/g, '').replace(/\.md$/i, '').trim().toLowerCase().replace(/\s+/g, '-')
  return /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,47}$/u.test(name) && name !== 'memory' ? name : undefined
}

/** Parse a memory file into its lines, its entries and the topic links of its Index. */
export function parseMemory(content) {
  const lines = String(content ?? '').replace(/\r\n?/g, '\n').split('\n')
  while (lines.length > 0 && lines.at(-1).trim() === '') lines.pop()
  const entries = []
  const links = []
  let inIndex = false
  lines.forEach((line, index) => {
    if (HEADING.test(line)) {
      inIndex = INDEX.test(line.trim())
      return
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet === null) return
    if (inIndex) {
      for (const match of bullet[1].matchAll(/\[\[([^\]]+)\]\]/g)) links.push(match[1].trim())
      return
    }
    const { text, meta } = splitMeta(bullet[1])
    if (text !== '') entries.push({ line: index, text, meta })
  })
  return { lines, entries, links }
}

export const joinLines = lines => `${lines.join('\n')}\n`

/** Insert a new entry above the Index heading, or at the end of a topic file. */
export function insertEntry(lines, line) {
  const index = lines.findIndex(item => INDEX.test(item.trim()))
  const end = index === -1 ? lines.length : index
  let at = end
  while (at > 0 && lines[at - 1].trim() === '') at -= 1
  const head = lines.slice(0, at)
  if (head.length > 0 && HEADING.test(head.at(-1))) head.push('')
  const tail = lines.slice(end)
  return [...head, line, ...(tail.length > 0 ? ['', ...tail] : [])]
}

/** Add [[topic]] to the Index, creating the heading when the file has none. */
export function addLink(lines, topic) {
  const next = [...lines]
  let index = next.findIndex(item => INDEX.test(item.trim()))
  if (index === -1) {
    if (next.length > 0) next.push('')
    next.push('## Index')
    index = next.length - 1
  }
  let end = next.findIndex((item, at) => at > index && HEADING.test(item))
  if (end === -1) end = next.length
  let at = end
  while (at > index + 1 && next[at - 1].trim() === '') at -= 1
  next.splice(at, 0, `- [[${topic}]]`)
  return next
}

/** Drop one [[topic]] line from the Index. */
export function removeLink(lines, topic) {
  return lines.filter(line => !/^\s*[-*]\s+\[\[([^\]]+)\]\]\s*$/.test(line) || /\[\[([^\]]+)\]\]/.exec(line)[1].trim() !== topic)
}

export const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** The entry a request means: the exact text, else every entry that contains it. */
export function matchEntries(entries, wanted) {
  const key = squash(cleanEntry(wanted))
  if (key === '') return []
  const exact = entries.find(entry => squash(entry.text) === key)
  if (exact !== undefined) return [exact]
  return entries.filter(entry => squash(entry.text).includes(key))
}

const KEY_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bhf_[A-Za-z0-9]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
]

/** Known key shapes, or a long mixed-case run of letters and digits outside a link. */
export function looksLikeKey(text) {
  if (KEY_PATTERNS.some(pattern => pattern.test(text))) return true
  const bare = text.replace(/\bhttps?:\/\/\S+/g, ' ')
  return (bare.match(/[A-Za-z0-9+=]{32,}/g) ?? []).some(run => /[a-z]/.test(run) && /[A-Z]/.test(run) && /\d/.test(run))
}

const PASSWORD_GIVEN = /(?:密码(?!管理|策略|规则)|口令|验证码|校验码|\bpassw(?:or)?d\b(?!\s*(?:managers?|polic(?:y|ies)|rules?|resets?|strength|less)\b)|\bpwd\b|\bpin(?: code)?\b|\bpass(?:code|phrase)\b|\b(?:otp|cvv|cvc)\b|\b(?:security|verification) code\b)[^\n.。;；,，]{0,40}?(?:是|(?<![因作认成以行])为|还是|改成|改为|换成|设为|设成|用(?![户于来途])(?!\s*\S+\s*(?:管理|保存|存|记))|叫|:|：|=|\b(?:is|are|was|remains|stays|becomes)\b|\b(?:set|changed) to\b)\s*\S/i
const PASSWORD_AFTER = /(?:\b(?:use[sd]?|using|set|sets|chose|chosen|picked|picks)\s+(?:[^\s,.;]+\s+){1,8}?(?:as|for)\s+(?:[\w'-]+\s+){0,3}?(?:passw(?:or)?d\b(?!\s*(?:managers?|polic(?:y|ies)|rules?|resets?|strength|fields?|prompts?|screens?|box(?:es)?)\b)|pwd\b|pin\b(?!\s*(?:pads?|entry|fields?|prompts?|screens?)\b)|pass(?:code|phrase)\b|otp\b)|用(?![户于来途])[^\n,，。;；]{1,40}?(?:当作?|作为?|做)\s*\S{0,6}?(?:密码(?!管理)|口令|验证码))/i
const ID_GIVEN = /(?:\bssn\b|\bsocial security\b|\bpassport\b|\btax (?:id|number)\b|\bdriver'?s licen[cs]e\b|\bnational (?:id|insurance)\b|\bid (?:card|number)\b|护照|身份证|社保|税号|驾驶证|驾照)[^\n.。;；,，]{0,30}?(?<![A-Za-z0-9-])(?!\d{4}-\d{1,2}-\d{1,2}(?!\d))[a-z]{0,2}\d[\d -]{4,}\d/i

/** A key, a password given as one, a labelled ID number, or 15+ unbroken digits. */
export function looksSecret(text) {
  if (looksLikeKey(text)) return true
  if (PASSWORD_GIVEN.test(text) || PASSWORD_AFTER.test(text) || ID_GIVEN.test(text)) return true
  return /\d{15,}/.test(text.replace(/\bhttps?:\/\/\S+/g, ' ').replace(/(?<=\d) (?=\d)/g, '').replace(/(?<=\d{3})-(?=\d{3})/g, ''))
}

/** Pull the first JSON object out of a model answer, tolerating a code fence. */
export function firstJson(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    return value !== null && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

/** The memory panel's answer: {"reply": …, "changes": […]}; prose keeps as a reply. */
export function parseAsk(text) {
  const value = firstJson(text)
  if (value === undefined) return { reply: text.trim(), changes: [] }
  return { reply: String(value.reply ?? '').trim(), changes: Array.isArray(value.changes) ? value.changes : [] }
}

/** The review's answer: every change well formed, or undefined so the review retries. */
export function parseReview(text) {
  const value = firstJson(text)
  if (value === undefined || !Array.isArray(value.changes)) return undefined
  const changes = []
  for (const change of value.changes) {
    if (change === null || typeof change !== 'object') return undefined
    const op = String(change.op ?? '')
    if (op !== 'add' && op !== 'edit' && op !== 'remove') return undefined
    const item = { op, text: typeof change.text === 'string' ? change.text : undefined }
    if (op !== 'add') {
      const entry = Number(change.entry)
      if (!Number.isInteger(entry) || entry < 1) return undefined
      item.entry = entry
    }
    if (op === 'add' && typeof change.topic === 'string' && change.topic.trim() !== '') item.topic = change.topic
    if (op === 'add' && change.team === true) item.team = true
    changes.push(item)
  }
  return changes
}

const wordsOf = (text) => {
  const lower = squash(text)
  const words = new Set(lower.match(/[a-z0-9]{3,}/g) ?? [])
  for (const run of lower.match(/[\u4e00-\u9fff]{2,}/g) ?? []) for (let at = 0; at + 1 < run.length; at += 1) words.add(run.slice(at, at + 2))
  return words
}

/**
 * What the review sees of memory: MEMORY.md whole, then topic entries while they fit,
 * those sharing words with the user's new lines first.
 */
export function reviewEntries(files, budget, about = '') {
  const tagged = files.flatMap(file => file.entries.map(entry => ({ ...entry, file })))
  const main = files.slice(0, 1).flatMap(file => file.entries.map(entry => ({ ...entry, file })))
  const topics = files.slice(1).flatMap(file => file.entries.map(entry => ({ ...entry, file })))
  let used = main.reduce((sum, entry) => sum + entry.text.length, 0)
  const asked = wordsOf(about)
  const shared = entry => [...wordsOf(`${entry.text} ${entry.file.topic ?? ''}`)].filter(word => asked.has(word)).length
  const newest = topics.map((entry, at) => ({ entry, at, score: shared(entry) }))
    .sort((a, b) => b.score - a.score || String(b.entry.meta?.added ?? '').localeCompare(String(a.entry.meta?.added ?? '')) || a.at - b.at)
  const shown = new Set()
  for (const { entry } of newest) {
    if (used + entry.text.length > budget) continue
    used += entry.text.length
    shown.add(entry)
  }
  return { numbered: [...main, ...topics.filter(entry => shown.has(entry))], left: topics.length - shown.size, all: tagged }
}
