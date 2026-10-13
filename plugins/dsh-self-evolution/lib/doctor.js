/**
 * Integrity check for the data root.
 *
 * The original shipped `healthcheck.sh`, and its finish step refused to write
 * anything when the check failed: state counters and the experience log must
 * not claim a round that did not really happen. The checks that mattered there
 * were "is the core sound" and "do the flow's referenced files exist". Inside a
 * package, core soundness is the loader's job and the referenced files travel
 * with the code, so the equivalent question here is different and more useful:
 *
 * - is the data root actually writable, so a round is not half-recorded;
 * - does every file the system reads still parse, above all the enabled skills:
 *   a skill whose frontmatter is malformed is silently dropped by the skill
 *   registry, which looks to the user like the skill vanishing;
 * - does the portrait article still hold together, since it is republished to
 *   every session and a broken one would be injected as-is;
 * - is the collector backend reachable, so "nothing was collected" is
 *   distinguishable from "collection is broken".
 *
 * Findings are split by consequence. A hard finding aborts the finish step; a
 * soft one is reported and left to the flow's judgement.
 *
 * @module dsh-self-evolution/lib/doctor
 */

import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { exists, listDir, readJson, readText } from './store.js'
import { parseSkill, enabledSkillNames } from './skills.js'
import { buildInjection, parseArticle } from './memory-article.js'
import { DOCS } from './docs.js'

/**
 * Run the integrity check.
 *
 * @param options - the check inputs.
 * @param options.settings - resolved settings.
 * @param options.llm - the collector's LLM facade, for the backend finding.
 * @param options.agent - the session's agent, so the chain can use its model.
 * @returns `{ hard, soft, notes }`.
 */
export async function runDoctor({ settings, llm, agent }) {
  const { paths } = settings
  const hard = []
  const soft = []

  // 1. The data root must accept a write, or a round cannot be recorded.
  const probe = join(paths.root, '.write-probe')
  try {
    writeFileSync(probe, 'ok')
    unlinkSync(probe)
  } catch (error) {
    hard.push(`数据根不可写：${paths.root}（${String(error?.message ?? error).slice(0, 120)}）`)
  }

  // 2. State and usage must at least parse; a corrupt file is repaired on the
  //    next write, so this is worth knowing but not worth aborting for.
  for (const [label, path] of [
    ['state.json', paths.state],
    ['usage.json', paths.usage],
    ['config.json', paths.config],
  ]) {
    if (!exists(path)) {
      soft.push(`${label} 尚不存在（首次写入时创建）`)
      continue
    }
    const value = readJson(path, undefined)
    if (value === undefined) soft.push(`${label} 无法解析，将在下次写入时重建`)
  }

  // 3. The memory directories are where the memory leg writes. The article may
  //    legitimately be absent (it appears with the first Dream), so only the
  //    directories are hard, and the article is checked for shape when present.
  for (const [label, path] of [
    ['memory/inbox/', paths.inbox],
    ['memory/archive/', paths.memoryArchive],
  ]) {
    if (!exists(path)) hard.push(`缺 ${label}（数据根初始化不完整）`)
  }
  if (exists(paths.profile)) {
    const article = readText(paths.profile, '')
    if (article.trim().length > 0) {
      const parsed = parseArticle(article)
      if (!parsed.ok) soft.push(`memory/PROFILE.md 结构不符（${parsed.reason}），注入的画像可能读不成散文段落`)
      else {
        const rendered = buildInjection(article)
        if (rendered.replaced === 0 && /你/.test(article)) {
          soft.push('memory/PROFILE.md 渲染后降人称 0 处，但正文含「你」：注入可能被读成人设')
        }
      }
    }
  }

  // 4. Every enabled skill must parse, or the registry drops it silently.
  const names = enabledSkillNames(paths.skills)
  const broken = []
  for (const name of names) {
    const raw = readText(join(paths.skills, name, 'SKILL.md'), '')
    const parsed = parseSkill(raw)
    if (parsed === undefined) broken.push(name)
    else if (parsed.name !== name) soft.push(`技能目录 ${name} 的 name 字段是 ${parsed.name}（注册表按 name 收录）`)
  }
  if (broken.length > 0) soft.push(`启用技能无法解析，模型看不到：${broken.join(', ')}`)

  // 5. The bundled flow skill is what routes the manual flow.
  if (settings.flowSkill) {
    const flow = parseSkill(readText(join(DOCS.flowSkill), ''))
    if (flow === undefined) hard.push(`内置流程技能无法解析：${DOCS.flowSkill}`)
  }

  // 6. The reference documents the flow is told to read on demand.
  for (const [label, path] of [
    ['候选审查细则', DOCS.candidateReview],
    ['技能体检细则', DOCS.skillHealth],
    ['报告模板', DOCS.reportTemplate],
  ]) {
    if (!exists(path)) soft.push(`缺 ${label}：${path}`)
  }

  // 7. The collector backend. A missing chain is not a reason to block the
  //    flow: an evolution round with the collector down is still a valid round.
  if (llm === undefined) {
    soft.push('采集后端不可用：未提供 LLM 门面')
  } else if (!llm.available()) {
    soft.push('采集后端不可用：宿主没有 llm 服务，自动采集不会发生')
  } else {
    try {
      const { chain, discarded } = await llm.resolveChain({ agent })
      if (chain.length === 0) soft.push('采集链为空：自动采集不会发生，可在 config.json 钉扎 collector.models')
      else if (discarded.length > 0) soft.push(`采集链已丢弃 ${discarded.length} 项：${discarded.map((item) => item.reason).join('；')}`)
    } catch (error) {
      soft.push(`采集链解析失败：${String(error?.message ?? error).slice(0, 120)}`)
    }
  }

  // 8. The inbox cap: a full inbox means the Dream has not run for a while.
  const inboxCount = listDir(paths.inbox).filter((name) => !name.startsWith('.')).length
  if (inboxCount >= settings.limits.maxExtracts) {
    soft.push(`记忆收件箱已满（${inboxCount} 份），提取暂停：请运行一次 evolve action="dream"`)
  }

  const candidateCount = listDir(paths.candidates).filter((name) => !name.startsWith('.')).length

  return {
    hard,
    soft,
    ok: hard.length === 0,
    notes: {
      skills: names.length,
      candidates: candidateCount,
      inbox: inboxCount,
      article: exists(paths.profile) ? readText(paths.profile, '').trim().length : 0,
    },
  }
}

/** Render one check result for a report. */
export function renderDoctor(result) {
  const lines = ['== 完整性检查 ==']
  if (result.hard.length === 0) lines.push('✓ 硬性问题 0')
  for (const item of result.hard) lines.push(`✗ ${item}`)
  lines.push(result.soft.length === 0 ? '✓ 提示项 0' : `提示项 ${result.soft.length}`)
  for (const item of result.soft) lines.push(`?  ${item}`)
  return lines.join('\n')
}
