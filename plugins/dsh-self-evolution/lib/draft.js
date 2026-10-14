/**
 * The portrait draft: the review gate between a Dream and the standing article.
 *
 * The skill leg has always quarantined what the collector drafts; the memory leg
 * did not, so a model-written portrait became standing memory the moment the
 * Dream finished. That asymmetry is what this module removes. A Dream now writes
 * `memory/drafts/<id>/` instead of `memory/PROFILE.md`, and nothing it produced
 * can be read by a later session until a human accepts it.
 *
 * One draft is three files, so the decision can be made from the draft alone:
 *
 * - `article.md` — the proposed article, byte-for-byte what promotion installs.
 * - `review.md` — the human-facing view: where it came from, what changed, and
 *   the full text, so the reader never has to reconstruct context.
 * - `meta.json` — the machine record: which extracts it consumed, the size
 *   delta, and the verdict once there is one.
 *
 * The inbox extracts a draft consumed are archived at **promotion**, never at
 * draft time. A rejected draft therefore consumes nothing: the same facts are
 * merged again by the next Dream, which is the whole point of reviewing before
 * installing.
 *
 * @module dsh-self-evolution/lib/draft
 */

import { join } from 'node:path'
import { exists, listDir, readJson, readText, removeTree, writeJsonAtomic, writeTextAtomic } from './store.js'
import { archiveInbox } from './memory.js'

/** Files every draft owns. */
const ARTICLE = 'article.md'
const REVIEW = 'review.md'
const META = 'meta.json'

/** Longest side of the line diff, in lines. Past this the draft is shown whole. */
const DIFF_LINE_LIMIT = 400

/** A filesystem-safe directory name for one draft. */
export function draftId(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-')
}

/** Absolute directory of one draft. */
export function draftDirOf(paths, id) {
  return join(paths.drafts, id)
}

/** Every draft id, oldest first. */
export function listDrafts(paths) {
  return listDir(paths.drafts)
    .filter((name) => !name.startsWith('.'))
    .sort()
}

/**
 * The newest draft, which is the one a review would be about.
 *
 * Drafts are named by timestamp, so lexicographic order is chronological order.
 *
 * @param paths - the layout table.
 * @returns the draft id, or undefined when nothing is pending.
 */
export function pendingDraftId(paths) {
  const all = listDrafts(paths)
  return all.length === 0 ? undefined : all[all.length - 1]
}

/**
 * Read one draft.
 *
 * @param paths - the layout table.
 * @param id - the draft id.
 * @returns the draft's parts, or undefined when it is not readable.
 */
export function readDraft(paths, id) {
  const dir = draftDirOf(paths, id)
  if (!exists(join(dir, ARTICLE))) return undefined
  return {
    id,
    dir,
    article: readText(join(dir, ARTICLE), ''),
    review: readText(join(dir, REVIEW), ''),
    meta: readJson(join(dir, META), {}),
    reviewPath: join(dir, REVIEW),
  }
}

/**
 * Line-level diff of two texts, as unified-diff-ish lines.
 *
 * The article is a few dozen lines by construction, so a plain longest-common-
 * subsequence walk is enough and the result is the whole file rather than
 * hunks: a reviewer comparing a 3000-character portrait wants to see all of it.
 * Past {@link DIFF_LINE_LIMIT} lines on either side the diff is abandoned in
 * favour of a size line, because a quadratic walk on a runaway file is not
 * worth a nicer review.
 *
 * @param before - the installed article.
 * @param after - the proposed article.
 * @returns `{ lines, omitted }`.
 */
export function diffLines(before, after) {
  const a = splitLines(before)
  const b = splitLines(after)
  if (a.length > DIFF_LINE_LIMIT || b.length > DIFF_LINE_LIMIT) {
    return { lines: [], omitted: `规模超限（${a.length} → ${b.length} 行），差异未逐行展开` }
  }

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const lines = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`)
      i += 1
      j += 1
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push(`- ${a[i]}`)
      i += 1
    } else {
      lines.push(`+ ${b[j]}`)
      j += 1
    }
  }
  while (i < a.length) {
    lines.push(`- ${a[i]}`)
    i += 1
  }
  while (j < b.length) {
    lines.push(`+ ${b[j]}`)
    j += 1
  }
  return { lines, omitted: undefined }
}

/** Split text into diffable lines, ignoring a trailing newline. */
function splitLines(text) {
  const body = String(text ?? '').replace(/\n+$/, '')
  return body.length === 0 ? [] : body.split('\n')
}

/**
 * The review document a human reads before deciding.
 *
 * Everything the decision needs is here: which extracts were merged, what the
 * size change is, the line diff against the installed article, and the full
 * proposed text. Reading `article.md` alone would answer "what will be
 * installed" but not "what is changing", and reading the diff alone would hide
 * the fact that a Dream rewrites the article whole.
 *
 * @param options - the review inputs.
 * @param options.id - the draft id.
 * @param options.article - the proposed article.
 * @param options.previous - the installed article, if any.
 * @param options.sources - the inbox file names this draft consumed.
 * @param options.at - the generation time.
 * @returns the Markdown review.
 */
export function renderReview({ id, article, previous, sources, at }) {
  const diff = diffLines(previous, article)
  const before = previous.trim().length
  const after = article.trim().length
  const delta = after - before
  return [
    '# 画像草稿（待审）',
    '',
    `- 草稿: ${id}`,
    `- 生成时间: ${at.toISOString()}`,
    `- 正文字符: ${before} → ${after}（${delta >= 0 ? '+' : ''}${delta}）`,
    `- 来源提取: ${sources.length === 0 ? '（无）' : sources.join(' / ')}`,
    '',
    '接受后这份正文会成为 `memory/PROFILE.md`，此后由 `memory` 工具按需读取；拒绝则什么都不改动，收件箱里的提取留给下一次 Dream 重新合并。',
    '',
    '## 差异（`-` 当前 → `+` 草稿）',
    '',
    '```diff',
    diff.omitted ?? diff.lines.map((line) => (line === '' ? ' ' : line)).join('\n'),
    '```',
    '',
    '## 草稿正文',
    '',
    article.trim(),
    '',
  ].join('\n')
}

/**
 * Write one Dream's output as a pending draft.
 *
 * @param paths - the layout table.
 * @param options - the draft inputs.
 * @param options.article - the validated article.
 * @param options.previous - the currently installed article.
 * @param options.sources - the inbox file names the merge consumed.
 * @param options.stats - extra fields for `meta.json` (paragraphs, chain, …).
 * @param options.now - the generation time.
 * @returns the new draft's id, directory and review path.
 */
export function writeDraft(paths, { article, previous, sources, stats = {}, now = new Date() }) {
  const id = draftId(now)
  const dir = draftDirOf(paths, id)
  writeTextAtomic(join(dir, ARTICLE), article)
  writeTextAtomic(join(dir, REVIEW), renderReview({ id, article, previous, sources, at: now }))
  writeJsonAtomic(join(dir, META), {
    id,
    at: now.toISOString(),
    articleChars: article.trim().length,
    previousChars: String(previous ?? '').trim().length,
    sources: [...sources],
    ...stats,
  })
  return { id, dir, reviewPath: join(dir, REVIEW) }
}

/**
 * Install a draft as the standing article and archive it as accepted.
 *
 * The inbox extracts the draft consumed are archived here, so nothing is
 * consumed by a draft that was never accepted.
 *
 * @param paths - the layout table.
 * @param id - the draft id.
 * @param options - the acceptance inputs.
 * @param options.now - the decision time.
 * @returns `{ articleChars, sources, archived }`, or undefined when unreadable.
 */
export function promoteDraft(paths, id, { now = new Date() } = {}) {
  const draft = readDraft(paths, id)
  if (draft === undefined) return undefined
  const sources = Array.isArray(draft.meta.sources) ? draft.meta.sources : []
  writeTextAtomic(paths.profile, draft.article)
  archiveInbox(paths, sources, now)
  archiveDraft(paths, id, { verdict: 'accepted', reason: '人工确认采用', now })
  return { articleChars: draft.article.trim().length, sources, reviewPath: draft.reviewPath }
}

/**
 * Reject a draft: nothing is installed and no extract is consumed.
 *
 * @param paths - the layout table.
 * @param id - the draft id.
 * @param options - the rejection inputs.
 * @param options.reason - why it was rejected, kept with the draft.
 * @param options.now - the decision time.
 * @returns the archive directory, or undefined when the draft is unreadable.
 */
export function discardDraft(paths, id, { reason = '未提供原因', now = new Date() } = {}) {
  if (readDraft(paths, id) === undefined) return undefined
  return archiveDraft(paths, id, { verdict: 'discarded', reason, now })
}

/**
 * Move a decided draft out of the pending area, keeping every file.
 *
 * The verdict is written into `meta.json` and appended to `review.md`, so the
 * archive answers "why is this not the portrait" without consulting the log.
 *
 * @param paths - the layout table.
 * @param id - the draft id.
 * @param options - the verdict.
 * @returns the archive directory.
 */
function archiveDraft(paths, id, { verdict, reason, now }) {
  const draft = readDraft(paths, id)
  const dest = join(paths.draftsArchive, id)
  if (draft !== undefined) {
    writeTextAtomic(join(dest, ARTICLE), draft.article)
    writeTextAtomic(
      join(dest, REVIEW),
      `${draft.review.trimEnd()}\n\n## 处置\n\n- ${verdict === 'accepted' ? '已接受' : '已拒绝'}: ${reason}\n- 时间: ${now.toISOString()}\n`,
    )
    writeJsonAtomic(join(dest, META), { ...draft.meta, verdict, reason, verdictAt: now.toISOString() })
    removeTree(draft.dir)
  }
  return dest
}
