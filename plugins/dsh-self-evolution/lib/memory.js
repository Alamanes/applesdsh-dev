/**
 * The durable memory store: the article, its inbox, and the injected view.
 *
 * Three files carry the whole long-term memory of the system:
 *
 * - `memory/PROFILE.md` — the portrait article, rewritten in full by each
 *   Dream. It is the one memory that reaches every later session.
 * - `memory/inbox/` — one extract per idle session, waiting to be merged.
 * - `memory/archive/YYYY-MM/` — the extracts a Dream has already consumed,
 *   kept for provenance rather than deleted.
 *
 * The article is never injected as it stands: it is rendered through
 * {@link buildInjection}, which frames it and converts its second person into
 * the third. Rendering itself is stateless: the harness's runtime-context
 * projection already drops an identical snapshot per session, so a steady
 * article costs nothing per turn without a memo in this module.
 *
 * @module dsh-self-evolution/lib/memory
 */

import { join } from 'node:path'
import { exists, listDir, readText, removeFile, writeTextAtomic } from './store.js'
import { buildInjection } from './memory-article.js'
import { slugify } from './text.js'

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
 * Render the article into the text published to the model.
 *
 * Returns an empty string while there is no article. The rendering is not
 * memoized: the plugin instance outlives every session, so a process-wide
 * "unchanged since the last call" would publish the portrait to whichever
 * session asked first and starve every session after it. The caller dedupes
 * per session instead.
 *
 * @param paths - the layout table.
 * @returns the published text, or an empty string.
 */
export function createArticleRenderer(paths) {
  return function render() {
    const article = readArticle(paths).trim()
    if (article.length === 0) return ''
    return buildInjection(article).content
  }
}
