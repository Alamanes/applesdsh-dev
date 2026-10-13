/**
 * `usage.json`: the skill feedback loop.
 *
 * Pure rules, zero tokens. Every finished session is scanned for two signals:
 * a strong one (a skill's own file was read, so the skill was really used) and
 * a weak one (the slug merely appears in the text, which may be no more than a
 * mention). Only a strong hit is attributed an outcome, and only the tail after
 * that hit counts, so an error that happened before the skill was read is not
 * blamed on it.
 *
 * The resulting record is what makes "does this skill still earn its context"
 * an answerable question instead of a guess, and it is deliberately
 * heuristic: the health report asks the user to decide, and points back at the
 * original trace for a second look.
 *
 * @module dsh-self-evolution/lib/usage
 */

import { readJson, writeJsonAtomic } from './store.js'
import { entryText, traceText } from './trace.js'

/** Negative words that read as a failed outcome. */
export const NEGATIVE_WORDS = [
  '失败', '不行', '没用', '还是错', '不对', '坏了', '算了', '放弃', '不弄',
  '崩溃', '打不开', '报错', '出错', '卡住', '没成功', '搞不定', '解决不了',
  '有问题', '假的', '骗人', '没有用', '白费', '退回', '删了吧',
]

/** Positive words that read as a succeeded outcome. */
export const POSITIVE_WORDS = [
  '好了', '搞定', '成功', '可以了', '能用了', '完美', '感谢', '谢谢',
  '赞', '没问题', '行了', '完成', '好用', '厉害', '棒', 'nice', 'great',
]

/** A session that reads this many skills at once is an inventory, not a use. */
export const ATTRIBUTION_SKIP_STRONG_HITS = 5

/** Empty usage file body. */
export function freshUsage() {
  return { updatedAt: null, skills: {} }
}

/** Read `usage.json`, repairing the shape for entries written by older builds. */
export function readUsage(paths) {
  const raw = readJson(paths.usage, null)
  const usage = raw !== null && typeof raw === 'object' ? raw : freshUsage()
  if (usage.skills === null || typeof usage.skills !== 'object') usage.skills = {}
  for (const key of Object.keys(usage.skills)) {
    const entry = usage.skills[key]
    if (entry === null || typeof entry !== 'object') continue
    if (entry.outcomes === null || typeof entry.outcomes !== 'object') {
      entry.outcomes = { success: 0, failure: 0, unknown: 0 }
    }
    if (!Array.isArray(entry.failReasons)) entry.failReasons = []
  }
  return usage
}

/** Persist `usage.json`. */
export function writeUsage(paths, usage) {
  writeJsonAtomic(paths.usage, usage)
}

/** Whether one entry's text mentions a skill's file or directory. */
function mentionsSkillFile(text, slug) {
  return text.includes(`skills/${slug}/SKILL.md`) || text.includes(`skills/${slug}/`)
}

/**
 * Attribute an outcome to one skill use.
 *
 * @param entries - the session's trace records.
 * @param fromIndex - the index of the record where the skill file was first read.
 * @returns the outcome and up to three failure reasons.
 */
export function judgeOutcome(entries, fromIndex) {
  let hasError = false
  const reasons = []
  let lastUserText = ''

  for (let index = fromIndex; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry === null || typeof entry !== 'object') continue
    if (entry.role === 'toolResult' && entry.isError === true) {
      hasError = true
      const text = String(entry.text ?? '').trim().slice(0, 200)
      if (text.length > 0 && reasons.length < 3) reasons.push(text)
    } else if (entry.role === 'user') {
      const text = String(entry.text ?? '').trim()
      if (text.length > 0 && !text.startsWith('/')) lastUserText = text
    }
  }

  if (hasError) return { outcome: 'failure', reasons }
  if (lastUserText.length > 0) {
    if (NEGATIVE_WORDS.some((word) => lastUserText.includes(word))) {
      return { outcome: 'failure', reasons: [`用户反馈: ${lastUserText.slice(0, 100)}`] }
    }
    if (POSITIVE_WORDS.some((word) => lastUserText.includes(word))) return { outcome: 'success', reasons: [] }
  }
  return { outcome: 'unknown', reasons: [] }
}

/**
 * Scan one session window and update the usage ledger.
 *
 * @param options - the scan inputs.
 * @param options.usage - the loaded usage object; mutated in place.
 * @param options.entries - the session's trace records.
 * @param options.skillNames - the enabled skill slugs.
 * @param options.session - the session key used for de-duplication.
 * @param options.now - the timestamp to stamp.
 * @returns a short human-readable account of what happened.
 */
export function trackUsage({ usage, entries, skillNames, session, now = new Date() }) {
  if (!Array.isArray(skillNames) || skillNames.length === 0) return '无已启用技能'
  if (!Array.isArray(entries) || entries.length === 0) return '会话无可分析内容'

  const text = traceText(entries)
  if (text.trim().length === 0) return '会话无可分析内容'

  const skills = usage.skills
  const iso = now.toISOString()

  // An inventory or review session reads many skills at once. Its unrelated
  // errors must not be attributed to any single skill, and its reads are not
  // uses, so nothing at all is recorded for it.
  let strongHits = 0
  for (const slug of skillNames) {
    for (const entry of entries) {
      if (mentionsSkillFile(entryText(entry), slug)) {
        strongHits += 1
        break
      }
    }
  }
  if (strongHits >= ATTRIBUTION_SKIP_STRONG_HITS) {
    return `盘点/审查类会话（强信号 ${strongHits} 个技能被批量读取），跳过记录`
  }

  let hit = 0
  for (const slug of skillNames) {
    const prev = skills[slug] !== null && typeof skills[slug] === 'object' ? skills[slug] : undefined
    if (prev !== undefined && prev.lastSession === session) continue

    let strongIndex = -1
    for (let index = 0; index < entries.length; index += 1) {
      if (mentionsSkillFile(entryText(entries[index]), slug)) {
        strongIndex = index
        break
      }
    }
    const strong = strongIndex >= 0
    const weak = !strong && text.includes(slug)
    if (!strong && !weak) continue

    const entry = {
      count: (prev?.count ?? 0) + 1,
      lastUsedAt: iso,
      lastSession: session,
      signal: strong ? 'strong' : 'weak',
      outcomes: prev?.outcomes ?? { success: 0, failure: 0, unknown: 0 },
      failReasons: prev?.failReasons ?? [],
    }
    entry.outcomes = { success: 0, failure: 0, unknown: 0, ...entry.outcomes }
    entry.failReasons = Array.isArray(entry.failReasons) ? entry.failReasons : []

    if (strong) {
      const { outcome, reasons } = judgeOutcome(entries, strongIndex)
      entry.outcomes[outcome] = (entry.outcomes[outcome] ?? 0) + 1
      if (reasons.length > 0) entry.failReasons = [...entry.failReasons, ...reasons].slice(-3)
    }
    skills[slug] = entry
    hit += 1
  }

  if (hit === 0) return '无技能使用信号'
  usage.updatedAt = iso
  return `已记录 ${hit} 个技能使用信号`
}
