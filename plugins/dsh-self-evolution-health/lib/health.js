/**
 * The skill scorecard: which skills deserve their context, and why.
 *
 * Three dimensions, from `usage.json` only: freshness (40), usage (30) and
 * reliability (30). Hard rules outrank the score, because a skill that has
 * failed twice is a problem whatever its arithmetic says.
 *
 * Read-only by design: the scorecard never archives, rewrites or deletes
 * anything. It produces the list, and the user decides.
 *
 * @module dsh-self-evolution/lib/health
 */

/** Skills that define the flow itself; exempt from archiving and compression. */
export const EXEMPT = new Set(['self-evolve', 'self-evolve-maintenance'])

/** A skill unused this long enters the archive-candidate pool. */
export const IDLE_DAYS = 15
/** A high-use skill gets a longer leash before it becomes an archive candidate. */
export const IDLE_DAYS_HIGH_USE = 30
/** "High use" line for the longer leash. */
export const HIGH_USE_COUNT = 10
/** "Recently used" line for the excellent grade. */
export const FRESH_DAYS = 14
/** Score at which a fresh, failure-free skill is called excellent. */
export const EXCELLENT_SCORE = 70
/** Size above which a skill is listed as a compression candidate. */
export const MAX_SKILL_CHARS = 8000

/** Grade labels, in report order. */
export const GRADES = {
  problem: '⚠️ 问题',
  meta: '🛡️ 元技能',
  idle: '😴 闲置',
  dormant: '🌙 沉睡',
  unobserved: '❓ 未观测',
  excellent: '🌟 优秀',
  healthy: '✅ 健康',
}

/** Sort order across grades, most attention-worthy first. */
const ORDER = {
  [GRADES.problem]: 0,
  [GRADES.meta]: 1,
  [GRADES.idle]: 3,
  [GRADES.dormant]: 4,
  [GRADES.unobserved]: 5,
  [GRADES.excellent]: 6,
  [GRADES.healthy]: 7,
}

/** Days since an ISO timestamp, or undefined when it cannot be read. */
export function daysSince(iso, now = new Date()) {
  if (typeof iso !== 'string' || iso.length === 0) return undefined
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return undefined
  return (now.getTime() - parsed) / 86400000
}

/**
 * Score one skill.
 *
 * @param name - the skill slug.
 * @param info - its `usage.json` entry, if any.
 * @param size - its `SKILL.md` size in bytes.
 * @param now - the reference time.
 * @returns the scorecard row.
 */
export function scoreOne(name, info, size, now = new Date()) {
  const record = info !== null && typeof info === 'object' ? info : {}
  const count = Number.isFinite(record.count) ? record.count : 0
  const signal = typeof record.signal === 'string' ? record.signal : 'weak'
  const outcomes = record.outcomes !== null && typeof record.outcomes === 'object' ? record.outcomes : {}
  const succ = Number.isFinite(outcomes.success) ? outcomes.success : 0
  const fail = Number.isFinite(outcomes.failure) ? outcomes.failure : 0
  const judged = succ + fail
  const failRate = judged > 0 ? fail / judged : 0
  const days = daysSince(record.lastUsedAt, now)
  const unreliable = record.recencyUnreliable === true || days === undefined

  let freshness = 0
  if (!unreliable) {
    if (days <= 3) freshness = 40
    else if (days >= IDLE_DAYS) freshness = 0
    else freshness = 40 * (1 - (days - 3) / (IDLE_DAYS - 3))
  }
  let usageScore = Math.min(count / 10, 1) * 30
  if (signal === 'weak') usageScore *= 0.5
  const reliability = judged < 2 ? 15 : 30 * (succ / judged)
  const total = Math.round(freshness + usageScore + reliability)

  const notes = []
  let grade = GRADES.healthy
  if (EXEMPT.has(name)) {
    grade = GRADES.meta
    notes.push('流程定义文件：豁免闲置归档与自动压缩')
    if (size > MAX_SKILL_CHARS) {
      notes.push(`超长 ${size} > ${MAX_SKILL_CHARS}：结构优化须用户决策，不自动执行`)
    }
  } else if (fail >= 2 && failRate > 0.3) {
    grade = GRADES.problem
    notes.push(`失败率 ${Math.round(failRate * 100)}%（${fail}/${judged}），复核 failReasons 是否假失败`)
  } else if (unreliable) {
    grade = GRADES.unobserved
    notes.push('无可信使用时间（观察期，等待使用记录重新积累）')
  } else if (days >= IDLE_DAYS) {
    if (days >= IDLE_DAYS_HIGH_USE || count < HIGH_USE_COUNT) {
      grade = GRADES.idle
      const why = days >= IDLE_DAYS_HIGH_USE ? '' : `，累计使用仅 ${count} 次`
      notes.push(`${Math.round(days)} 天未用${why} → 归档候选`)
    } else {
      grade = GRADES.dormant
      notes.push(`${Math.round(days)} 天未用但累计使用 ${count} 次 → 沉睡高产，满 ${IDLE_DAYS_HIGH_USE} 天仍未用才列为归档候选`)
    }
  } else if (total >= EXCELLENT_SCORE && days <= FRESH_DAYS && fail === 0) {
    grade = GRADES.excellent
  }
  if (signal === 'weak' && count >= 10) notes.push('弱信号高频：可能只是常被提及，从未真读（count 含水分）')
  if (size > MAX_SKILL_CHARS && grade !== GRADES.meta) notes.push(`超长 ${size} > ${MAX_SKILL_CHARS} 字符，列入压缩候选`)

  return {
    name,
    grade,
    total,
    count,
    days,
    signal,
    succ,
    fail,
    failRate,
    size,
    notes,
    failReasons: Array.isArray(record.failReasons) ? record.failReasons.slice(0, 2) : [],
  }
}

/**
 * Score every enabled skill and summarise the result.
 *
 * @param options - the scorecard inputs.
 * @param options.skillNames - enabled slugs.
 * @param options.usage - the loaded `usage.json`.
 * @param options.sizeOf - maps a slug to its `SKILL.md` size in bytes.
 * @param options.now - the reference time.
 * @returns rows, counts and the two decision lists.
 */
export function scorecard({ skillNames, usage, sizeOf, now = new Date() }) {
  const skills = usage?.skills !== null && typeof usage?.skills === 'object' ? usage.skills : {}
  const rows = skillNames.map((name) => scoreOne(name, skills[name], sizeOf(name), now))
  rows.sort((left, right) => (ORDER[left.grade] ?? 99) - (ORDER[right.grade] ?? 99) || right.total - left.total)

  const counts = {}
  for (const row of rows) counts[row.grade] = (counts[row.grade] ?? 0) + 1

  return {
    rows,
    counts,
    archiveCandidates: rows.filter((row) => row.grade === GRADES.idle).map((row) => row.name),
    problemSkills: rows.filter((row) => row.grade === GRADES.problem).map((row) => row.name),
    oversized: rows.filter((row) => row.size > MAX_SKILL_CHARS && row.grade !== GRADES.meta).map((row) => row.name),
  }
}

/**
 * Render the scorecard as the compact text a flow step reads.
 *
 * @param result - the {@link scorecard} result.
 * @param options - rendering options.
 * @param options.all - include healthy skills.
 * @returns the report text.
 */
export function renderScorecard(result, { all = false } = {}) {
  const shown = all ? result.rows : result.rows.filter((row) => row.grade !== GRADES.healthy)
  const lines = [`技能记分卡：启用 ${result.rows.length} 个 | 显示 ${all ? '全量' : '非健康项'}`]
  for (const row of shown) {
    const recency = row.days === undefined ? '无记录' : `${Math.round(row.days)}天前`
    lines.push(`${row.grade} ${String(row.total).padStart(3)}分  ${row.name}  [${row.signal.slice(0, 1)}信号 ${row.count}次 / 最近 ${recency} / 失败${row.fail}]`)
    for (const note of row.notes) lines.push(`        - ${note}`)
    for (const reason of row.failReasons) lines.push(`        · ${String(reason).slice(0, 80)}`)
  }
  const labels = [GRADES.excellent, GRADES.healthy, GRADES.unobserved, GRADES.problem, GRADES.idle, GRADES.dormant, GRADES.meta]
  lines.push(`\n小结：${labels.map((label) => `${label} ${result.counts[label] ?? 0}`).join(' / ')}`)
  lines.push(`技能总量：${result.rows.length}/40`)
  if (result.archiveCandidates.length > 0) {
    lines.push('\n归档候选（逐项征求用户决策后才可执行，绝不自行删除）：')
    for (const name of result.archiveCandidates) lines.push(`  - ${name}`)
  }
  if (result.problemSkills.length > 0) {
    lines.push('\n问题技能（人工复核假失败后再定处置）：')
    for (const name of result.problemSkills) lines.push(`  - ${name}`)
  }
  if (result.oversized.length > 0) {
    lines.push('\n超长技能（压缩须用户决策）：')
    for (const name of result.oversized) lines.push(`  - ${name}`)
  }
  return lines.join('\n')
}
