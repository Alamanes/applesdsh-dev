/**
 * The durable memory store: the article, its inbox, and its provenance.
 *
 * The whole long-term memory of the system is plain files here:
 *
 * - `memory/PROFILE.md` — the portrait article, installed only when a human
 *   accepts a draft. It is the one memory later sessions can read, through the
 *   `memory` tool, and it is never carried in the prompt on its own.
 * - `memory/inbox/` — one extract per idle session, waiting to be merged.
 * - `memory/drafts/<id>/` — a Dream's proposed rewrite, waiting for review.
 * - `memory/archive/YYYY-MM/` — the extracts a Dream has already merged, and
 *   `memory/archive/drafts/<id>/` — every draft with its verdict, both kept for
 *   provenance rather than deleted.
 *
 * The article is not served as it stands: it is rendered through
 * {@link renderForModel}, which frames it and converts its second person into
 * the third, so a portrait written for a human cannot be read as the model's own
 * persona.
 *
 * @module dsh-self-evolution/lib/memory
 */

import { statSync } from 'node:fs'
import { join } from 'node:path'
import { exists, listDir, readText, removeFile, writeTextAtomic } from 'dsh-self-evolution-core/lib/store.js'
import { ARTICLE_LEAD_SECTION, toThirdPerson } from './memory-article.js'
import { slugify } from 'dsh-self-evolution-core/lib/text.js'

/** Fresh `logs/experience-log.md`. */
export const EXPERIENCE_LOG_TEMPLATE = `# 经验沉淀日志（Experience Log）

> 由 dsh-self-evolution 自动维护。记录每次技能沉淀的来源、结论与去向，保证可追溯。

| 时间 | 来源会话 | 类型 | 摘要 | 去向 |
| --- | --- | --- | --- | --- |
`

/**
 * Create what a fresh data root needs.
 *
 * The article is deliberately not created: it appears with the first Dream, and
 * an empty article means nothing is injected at all.
 */
export function ensureMemoryFiles(paths) {
  if (!exists(paths.experienceLog)) writeTextAtomic(paths.experienceLog, EXPERIENCE_LOG_TEMPLATE)
}

/** Read the portrait article. */
export function readArticle(paths) {
  return readText(paths.profile, '')
}

/** Write the portrait article atomically. */
export function writeArticle(paths, text) {
  writeTextAtomic(paths.profile, text)
}

/** The inbox file names, sorted so processing order is stable. */
export function inboxFiles(paths) {
  return listDir(paths.inbox)
    .filter((name) => !name.startsWith('.'))
    .sort()
}

/** Read every inbox extract, skipping unreadable ones. */
export function readInbox(paths) {
  const out = []
  for (const name of inboxFiles(paths)) {
    const body = readText(join(paths.inbox, name), '').trim()
    if (body.length > 0) out.push({ name, body })
  }
  return out
}

/**
 * Write one session's extract into the inbox.
 *
 * The file name carries the session slug and the time, so several extracts from
 * one long session each keep their own record.
 *
 * @param paths - the layout table.
 * @param session - the session key.
 * @param body - the `- ` bullet list.
 * @param now - the current time.
 * @returns the written file name.
 */
export function writeExtract(paths, session, body, now = new Date()) {
  const name = `${slugify(session) || 'session'}-${now.getTime()}.md`
  writeTextAtomic(join(paths.inbox, name), `${String(body).trim()}\n`)
  return name
}

/**
 * Move the consumed extracts into the month's archive.
 *
 * @param paths - the layout table.
 * @param names - the inbox file names to consume.
 * @param now - the current time.
 * @returns the archive directory.
 */
export function archiveInbox(paths, names, now = new Date()) {
  const dest = join(paths.memoryArchive, now.toISOString().slice(0, 7))
  for (const name of names) {
    const from = join(paths.inbox, name)
    try {
      const body = readText(from, '')
      writeTextAtomic(join(dest, name), body)
      removeFile(from)
    } catch {
      // A failed archive keeps the extract in the inbox for the next Dream,
      // which is the safer direction: re-merging a fact costs nothing.
    }
  }
  return dest
}

/**
 * Split the article into its `##` sections, for on-demand reading.
 *
 * A reader asking about the user rarely wants all 3000 characters, so the
 * sections are addressable by their heading. Text before the first heading is
 * returned as a section named `（前言）`, because dropping it silently would be
 * worse than naming it oddly.
 *
 * @param article - the raw article.
 * @returns `{ name, body, chars }[]`.
 */
export function articleSections(article) {
  const lines = String(article ?? '').split('\n')
  const out = []
  let current = { name: '（前言）', lines: [] }
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      out.push(current)
      current = { name: heading[1].replace(/[：:]\s*$/, '').trim(), lines: [] }
      continue
    }
    current.lines.push(line)
  }
  out.push(current)
  return out
    .map((section) => ({ name: section.name, body: section.lines.join('\n').trim() }))
    .filter((section) => section.body.length > 0)
    .map((section) => ({ ...section, chars: section.body.length }))
}

/**
 * Find the paragraphs of the article that match a keyword.
 *
 * Matching is deliberately literal: this answers "did we ever record something
 * about X", and a fuzzy answer to that question is worse than none.
 *
 * @param article - the raw article.
 * @param keyword - the needle.
 * @returns `{ section, text }[]`, capped by the caller's own budget.
 */
export function searchArticle(article, keyword) {
  const needle = String(keyword ?? '').trim().toLowerCase()
  if (needle.length === 0) return []
  const hits = []
  for (const section of articleSections(article)) {
    for (const paragraph of section.body.split(/\n{2,}/)) {
      const text = paragraph.trim()
      if (text.length > 0 && text.toLowerCase().includes(needle)) hits.push({ section: section.name, text })
    }
  }
  return hits
}

/** Longest identity line kept in the prompt, in characters. */
export const IDENTITY_MAX_CHARS = 220

/**
 * The one-line identity taken from the article's lead section.
 *
 * The point of this line is the opposite of the article: it is what makes the
 * assistant behave as if it already knows who it is talking to, without a read
 * and without anything to recite. So it is deliberately small and deliberately
 * boring — who the user is — and it carries only the lead section's **first
 * sentence**.
 *
 * The restriction to one sentence is the load-bearing part. A portrait's lead
 * section quickly moves from "who she is" to "how she likes things", and those
 * sentences steer behaviour: an identity line that ends with "she likes
 * exclamation marks" is a standing instruction nobody asked for. Preferences,
 * opinions and projects stay behind the `memory` tool, where a step has to ask
 * for them and the ask is visible.
 *
 * @param article - the raw article.
 * @param maxChars - the truncation guard for an over-long first sentence.
 * @returns the identity line, or an empty string when there is nothing usable.
 */
export function identityLine(article, maxChars = IDENTITY_MAX_CHARS) {
  const lead = articleSections(article).find((section) => section.name === ARTICLE_LEAD_SECTION)
  if (lead === undefined) return ''
  // The article is written in the second person for its human reader; in a
  // prompt slot that 「你」 would read as the assistant describing itself.
  const sentences = toThirdPerson(lead.body.replace(/\s*\n\s*/g, ''))
    .text.split(/(?<=。)/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
  const first = sentences[0] ?? ''
  if (first.length <= maxChars) return first
  // A first sentence that blows the budget is kept as its opening clause, so the
  // line neither disappears nor grows.
  return `${first.slice(0, maxChars - 1)}…`
}

/**
 * Read the identity line for the prompt, re-reading only when the file changes.
 *
 * The prompt is assembled before every model step, so this runs often; the
 * article only changes when a human accepts a draft. An mtime check keeps the
 * steady state to one `stat` instead of one read, and a failed stat falls back
 * to the last text rather than dropping the line mid-session.
 *
 * @param paths - the layout table.
 * @returns a function returning the current identity line.
 */
export function createIdentityReader(paths) {
  let stamp
  let line = ''
  return function identity() {
    try {
      const current = statSync(paths.profile).mtimeMs
      if (current === stamp) return line
      line = identityLine(readText(paths.profile, ''))
      stamp = current
      return line
    } catch {
      stamp = undefined
      return line
    }
  }
}
