/**
 * The candidate queue and the skill archive.
 *
 * A draft the collector produced lives in `candidates/<slug>/` and is invisible
 * to every model until the evolve flow moves it. That quarantine is the point
 * of the whole system: automatic writing may propose, and only a reviewed
 * promotion may take effect.
 *
 * `meta.md` carries the provenance a reviewer needs — which session, how many
 * tool calls, how many errors — and, once decided, the verdict.
 *
 * @module dsh-self-evolution-candidates/lib/candidates
 */

import { cpSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { exists, listDir, readText, removeTree, writeTextAtomic } from 'dsh-self-evolution-core/lib/store.js'
import { isLegalSlug, similarity, slugify } from 'dsh-self-evolution-core/lib/text.js'

/** Ending tokens that suggest a truncated draft. */
const TRUNC_TAILS = ['→', '：', ':', '、', '，', '；', '-', '|', '*', '(', '（', '【', '《', '…']
/** Ending tokens that suggest a complete draft. */
const OK_TAILS = ['。', '）', ')', '」', '】', '》', '"', '`']
/** Description budget enforced by the format rule. */
const MAX_DESCRIPTION_CHARS = 1024

/**
 * Parse a SKILL.md frontmatter block without a YAML dependency.
 *
 * @param raw - the file text.
 * @returns the parsed fields and structural findings.
 */
export function parseFrontmatter(raw) {
  const lines = String(raw ?? '').split('\n')
  const issues = []
  const warnings = []
  let frontmatter = []
  if (lines.length === 0 || lines[0].trim() !== '---') {
    issues.push('首行非 ---（frontmatter 缺失）')
  } else {
    let end = -1
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index].trim() === '---') {
        end = index
        break
      }
    }
    if (end < 0) issues.push('frontmatter 未闭合（无第二个 ---）')
    else frontmatter = lines.slice(1, end)
  }

  let name = ''
  let description = ''
  let hasDescription = false
  let descriptionBare = false
  for (const line of frontmatter) {
    const nameMatch = /^name\s*:\s*["']?([^"'\r\n]+)["']?\s*$/.exec(line)
    if (nameMatch) name = nameMatch[1].trim()
    if (/^description\s*:\s*\S/i.test(line)) {
      hasDescription = true
      if (description.length === 0) description = line.replace(/^description\s*:\s*/i, '').trim()
    } else if (/^description\s*:\s*$/i.test(line)) {
      hasDescription = true
      descriptionBare = true
    }
  }
  if (name.length === 0) issues.push('缺 name 字段')
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) issues.push(`name 含非法字符（须小写字母数字连字符）: ${name}`)
  else if (name.length > 64) issues.push(`name 超长（${name.length} > 64）`)
  if (!hasDescription) issues.push('缺 description 字段')
  else if (descriptionBare) warnings.push('description 值为空或多行折叠，人工确认是否有实质内容')
  else if (description.length > MAX_DESCRIPTION_CHARS) {
    issues.push(`description 超长（${description.length} > ${MAX_DESCRIPTION_CHARS}）`)
  }
  return { name, description, issues, warnings }
}

/**
 * Run the deterministic preflight on one candidate.
 *
 * @param options - the check inputs.
 * @param options.slug - the candidate directory name.
 * @param options.raw - the candidate's `SKILL.md` text.
 * @param options.hasMeta - whether `meta.md` exists.
 * @param options.maxSkillChars - the size ceiling.
 * @param options.enabled - map of enabled skill name to its description.
 * @returns hard issues and warnings for a human to judge.
 */
export function preflight({ slug, raw, hasMeta, maxSkillChars, enabled }) {
  const parsed = parseFrontmatter(raw)
  const issues = [...parsed.issues]
  const warnings = [...parsed.warnings]
  const lines = String(raw ?? '').split('\n')

  if (!hasMeta) warnings.push('缺少 meta.md（来源记录缺失）')
  if (raw.length > maxSkillChars) issues.push(`超长 ${raw.length} > ${maxSkillChars} 字符`)
  if ((raw.match(/```/g)?.length ?? 0) % 2 === 1) issues.push('代码围栏不闭合（疑似截断）')

  const nonEmpty = lines.map((line) => line.replace(/\s+$/, '')).filter((line) => line.trim().length > 0)
  if (nonEmpty.length > 0) {
    const last = nonEmpty[nonEmpty.length - 1]
    if (TRUNC_TAILS.some((tail) => last.endsWith(tail)) && !OK_TAILS.some((tail) => last.endsWith(tail))) {
      warnings.push(`尾部疑似截断: …${last.slice(-30)}`)
    }
  }
  if (parsed.name.length > 0 && slug !== parsed.name) warnings.push(`目录名 ${slug} ≠ name ${parsed.name}`)

  if (parsed.name.length > 0 && enabled[parsed.name] !== undefined) {
    issues.push(`与已启用技能完全同名: ${parsed.name}`)
  } else {
    let bestName = ''
    let bestNameRatio = 0
    let bestDesc = ''
    let bestDescRatio = 0
    for (const [otherName, otherDesc] of Object.entries(enabled)) {
      const nameRatio = similarity(parsed.name, otherName)
      if (nameRatio > bestNameRatio) {
        bestName = otherName
        bestNameRatio = nameRatio
      }
      if (parsed.description.length > 0 && otherDesc.length > 0) {
        const descRatio = similarity(parsed.description.slice(0, 300), otherDesc.slice(0, 300))
        if (descRatio > bestDescRatio) {
          bestDesc = otherName
          bestDescRatio = descRatio
        }
      }
    }
    if (bestNameRatio >= 0.8) {
      warnings.push(`name 与已启用技能 ${bestName} 高相似（${Math.round(bestNameRatio * 100)}%），人工判断是否同源`)
    }
    if (bestDescRatio >= 0.55) {
      warnings.push(
        `description 与已启用技能 ${bestDesc} 相似度 ${Math.round(bestDescRatio * 100)}%，人工判断是否语义重复（零 token 预查，最终以人工审读为准）`,
      )
    }
  }
  return { issues, warnings, name: parsed.name, description: parsed.description }
}

/** Extract the `description` of every enabled skill, for the duplicate check. */
export function enabledDescriptions(skillsDir, skillNames) {
  const out = {}
  for (const name of skillNames) {
    const raw = readText(join(skillsDir, name, 'SKILL.md'), '')
    out[name] = parseFrontmatter(raw).description
  }
  return out
}

/** One candidate directory, read for review. */
export function readCandidate(candidatesDir, slug) {
  const dir = join(candidatesDir, slug)
  const skillPath = join(dir, 'SKILL.md')
  return {
    slug,
    dir,
    skillPath,
    raw: exists(skillPath) ? readText(skillPath, '') : '',
    hasMeta: exists(join(dir, 'meta.md')),
    meta: readText(join(dir, 'meta.md'), ''),
    size: sizeOf(skillPath),
  }
}

/** List candidate directory names, sorted. */
export function listCandidates(candidatesDir) {
  return listDir(candidatesDir)
    .filter((name) => !name.startsWith('.') && exists(join(candidatesDir, name, 'SKILL.md')))
    .sort()
}

/** File size in bytes, or zero when unreadable. */
export function sizeOf(path) {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/**
 * Write one drafted candidate.
 *
 * A slug collision against an existing candidate is not an error: identical
 * content is treated as a duplicate collection, and different content lands
 * under a `-N` variant so nothing is overwritten.
 *
 * @param options - the write inputs.
 * @returns the final slug, or a rejection reason.
 */
export function writeCandidate({ candidatesDir, raw, name, meta, now = new Date() }) {
  const slug = slugify(name || 'untitled-skill')
  let finalSlug = slug
  const target = join(candidatesDir, finalSlug)
  if (exists(join(target, 'SKILL.md'))) {
    if (readText(join(target, 'SKILL.md'), '') === raw) return { duplicate: true, slug: finalSlug }
    let variant = 2
    while (exists(join(candidatesDir, `${slug}-${variant}`, 'SKILL.md'))) variant += 1
    finalSlug = `${slug}-${variant}`
  }
  const dir = join(candidatesDir, finalSlug)
  mkdirSync(dir, { recursive: true })
  writeTextAtomic(join(dir, 'SKILL.md'), raw)
  writeTextAtomic(
    join(dir, 'meta.md'),
    [
      '---',
      `candidate-source-session: ${meta.session}`,
      `candidate-tool-calls: ${meta.toolCalls}`,
      `candidate-errors: ${meta.errors}`,
      `candidate-created: ${now.toISOString()}`,
      '---',
      '',
    ].join('\n'),
  )
  return { slug: finalSlug }
}

/**
 * Record a candidate's verdict and drop its directory.
 *
 * The queue keeps no processed directories: leaving them behind would make the
 * next run review the same drafts again.
 *
 * @param options - the verdict inputs.
 * @returns the archived meta text path that was discarded, for the caller's log.
 */
export function recordVerdict({ candidatesDir, archiveDir, slug, verdict, reason, now = new Date() }) {
  const candidate = readCandidate(candidatesDir, slug)
  const meta = [
    candidate.meta.trimEnd(),
    candidate.hasMeta ? '' : '---',
    `candidate-verdict: ${verdict}`,
    `candidate-verdict-reason: ${reason}`,
    `candidate-verdict-at: ${now.toISOString()}`,
    '',
  ].join('\n')
  if (archiveDir !== undefined) {
    mkdirSync(join(archiveDir, slug), { recursive: true })
    writeTextAtomic(join(archiveDir, slug, 'SKILL.md'), candidate.raw)
    writeTextAtomic(join(archiveDir, slug, 'meta.md'), meta)
  }
  removeTree(candidate.dir)
  return { slug, verdict, reason }
}

/**
 * Promote a candidate into the enabled skill set.
 *
 * Promotion is a move of the candidate directory's contents into
 * `skills/<name>/`. In DSH no symlink is involved: the skill registry is served
 * by this plugin's provider, so a directory under `skills/` is live.
 *
 * @param options - the promotion inputs.
 * @returns the enabled skill name.
 */
export function enableCandidate({ candidatesDir, skillsDir, archivedDir, slug, name, reason, archiveCandidate = true }) {
  const source = join(candidatesDir, slug)
  const skillName = isLegalSlug(name) ? name : slug
  const target = join(skillsDir, skillName)
  mkdirSync(skillsDir, { recursive: true })
  if (exists(target)) renameSync(target, join(archivedDir, `${skillName}-replaced-${Date.now()}`))
  cpSync(source, target, { recursive: true })
  if (archiveCandidate) {
    recordVerdict({ candidatesDir, archiveDir: archivedDir, slug, verdict: 'enabled', reason })
  } else {
    removeTree(source)
  }
  return skillName
}

/** Move one enabled skill into the archive. */
export function archiveSkill({ skillsDir, archivedDir, name }) {
  const source = join(skillsDir, name)
  if (!exists(source)) return false
  mkdirSync(archivedDir, { recursive: true })
  renameSync(source, join(archivedDir, name))
  return true
}

/** Move one archived skill back into the enabled set. */
export function restoreSkill({ skillsDir, archivedDir, name }) {
  const source = join(archivedDir, name)
  if (!exists(join(source, 'SKILL.md'))) return false
  mkdirSync(skillsDir, { recursive: true })
  renameSync(source, join(skillsDir, name))
  return true
}

/** Read every enabled skill as `{ name: { raw, description, size } }`. */
export function readEnabledSkills(skillsDir, skillNames) {
  const out = {}
  for (const name of skillNames) {
    const raw = readText(join(skillsDir, name, 'SKILL.md'), '')
    out[name] = { raw, description: parseFrontmatter(raw).description, size: raw.length }
  }
  return out
}
