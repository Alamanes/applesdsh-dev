/**
 * The evolve flow: the deliberate half of the system.
 *
 * Nothing here happens on its own. The flow is a conversation the user starts
 * ("进化" / "总结一天的工作"), and every step is a deterministic operation the
 * model invokes. Splitting it this way is what keeps the expensive, judgement
 * heavy part manual and the cheap, mechanical part out of the model's hands
 * entirely: counting, validating, deduplicating, grading, promoting, archiving
 * and bookkeeping are all plain code with no tokens attached.
 *
 * The original expressed exactly this split as shell scripts plus a flow skill.
 * Here the same operations are host functions and the flow skill routes to
 * them, so there is no subprocess, no shell quoting and no `rg` fallback path
 * to maintain.
 *
 * @module dsh-self-evolution/lib/evolve
 */

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { exists, listDir, logExperience, readText, rotateExperienceLog, snapshotLedger, stamp, withLock } from './store.js'
import { DOCS } from './docs.js'
import { renderDoctor, runDoctor } from './doctor.js'
import { readState, writeState, bump } from './state.js'
import {
  archiveSkill,
  enabledDescriptions,
  enableCandidate,
  listCandidates,
  preflight,
  readCandidate,
  recordVerdict,
  restoreSkill,
  sizeOf,
} from './candidates.js'
import { GRADES, renderScorecard, scorecard } from './health.js'
import { buildTraceSummary } from './trace.js'
import { ensureMemoryFiles, inboxFiles, readArticle } from './memory.js'
import { renderForModel } from './memory-article.js'
import { discardDraft, listDrafts, pendingDraftId, promoteDraft, readDraft } from './draft.js'
import { enabledSkillNames, hostSkillCatalog } from './skills.js'
import { readUsage } from './usage.js'

/** Re-exported so callers can reach the reference paths without a second import. */
export { DOCS }

/**
 * Create the flow facade.
 *
 * @param options - the wiring inputs.
 * @param options.settings - resolved settings.
 * @param options.ctx - the plugin context, for the host skill catalog.
 * @param options.llm - the collector's LLM facade, for the chain view.
 * @param options.memory - the memory leg, for the manual round.
 * @param options.invalidateSkills - republish the served skill catalog.
 * @param options.traceStateFor - reads one session's projection state.
 * @param options.sessionQuery - reads the session query service, when mounted.
 * @returns the flow methods.
 */
export function createEvolve({ settings, ctx, invalidateSkills, traceStateFor, llm, memory, sessionQuery }) {
  const { paths, limits } = settings

  /**
   * Run one mutating action under the data root's cross-process lock.
   *
   * The original's finish step held an exclusive lock so two evolution rounds
   * could not interleave their writes into `state.json`. The same guard now
   * covers every action that changes the enabled set or the counters.
   *
   * @param label - what is being attempted, for the busy message.
   * @param body - the mutation.
   * @returns the body's result, or the busy message when the lock is held.
   */
  async function mutate(label, body) {
    const result = await withLock(paths, async () => body())
    if (result === undefined) return `⚠️ 另一个进化流程正在运行（数据根锁被占用），${label}未执行`
    return result
  }

  /**
   * The integrity check, as the original's `healthcheck.sh` plus its
   * "check before writing" rule.
   *
   * @param options - the check inputs.
   * @returns the check result.
   */
  async function doctor({ agent } = {}) {
    return runDoctor({ settings, llm, agent })
  }

  /** The memory state a round and the panel both need. */
  function memoryInfo() {
    const article = readArticle(paths)
    const inbox = inboxFiles(paths)
    const pending = pendingDraftId(paths)
    const draft = pending === undefined ? undefined : readDraft(paths, pending)
    const rendered = article.trim().length === 0 ? { content: '', replaced: 0 } : renderForModel(article)
    return {
      articleChars: article.trim().length,
      articleBytes: Buffer.byteLength(article, 'utf8'),
      inbox,
      drafts: listDrafts(paths).length,
      draftId: pending,
      draftReviewPath: draft?.reviewPath,
      draftChars: draft === undefined ? 0 : Number(draft.meta.articleChars ?? draft.article.trim().length),
      draftSources: draft === undefined ? 0 : Array.isArray(draft.meta.sources) ? draft.meta.sources.length : 0,
      modelViewChars: rendered.content.length,
      thirdPerson: rendered.replaced,
    }
  }

  /** Everything the flow needs to know before choosing a route. */
  function inspect() {
    ensureMemoryFiles(paths)
    const state = readState(paths)
    const skillNames = enabledSkillNames(paths.skills)
    const usage = readUsage(paths)
    const card = scorecard({
      skillNames,
      usage,
      sizeOf: (name) => sizeOf(join(paths.skills, name, 'SKILL.md')),
    })
    return {
      state,
      skillNames,
      usage,
      card,
      candidates: listCandidates(paths.candidates),
      memory: memoryInfo(),
      archived: listDir(paths.archived).filter((name) => exists(join(paths.archived, name, 'SKILL.md'))),
      oversized: card.oversized,
    }
  }

  /** A compact status line for the panel, the command and quick answers. */
  function status() {
    const info = inspect()
    return {
      root: paths.root,
      candidates: info.candidates.length,
      inbox: info.memory.inbox.length,
      articleChars: info.memory.articleChars,
      modelViewChars: info.memory.modelViewChars,
      drafts: info.memory.drafts,
      draftId: info.memory.draftId,
      draftChars: info.memory.draftChars,
      skills: info.skillNames.length,
      archived: info.archived.length,
      lastEvolutionAt: info.state.lastEvolutionAt,
      lastCollectionAt: info.state.lastCollectionAt,
      lastDreamAt: info.state.lastDreamAt,
      collectorUnavailable: info.state.collectorUnavailable === true,
      collectorUnavailableReason: info.state.collectorUnavailableReason,
      stats: info.state.stats,
      grades: info.card.counts,
      recentRejections: info.state.rejections.slice(-5).reverse(),
    }
  }

  /**
   * The one-probe brief: state, queue, drafts, health, size limits, log volume,
   * the route this round should take, and any host-skill name collision.
   */
  async function brief({ agent } = {}) {
    const info = inspect()
    const lines = []
    lines.push('== 进化探测 ==')
    lines.push(`数据根: ${paths.root}`)
    lines.push(
      `统计: 会话 ${info.state.stats.sessionsAnalyzed} / 候选生成 ${info.state.stats.candidatesCreated} / 自动跳过 ${info.state.stats.collectorSkips ?? 0} / 候选拒绝 ${info.state.stats.candidatesRejected} / 记忆提取 ${info.state.stats.memoryExtracts ?? 0} / Dream ${info.state.stats.dreams ?? 0}`,
    )
    lines.push(
      `上次采集: ${info.state.lastCollectionAt ?? '无'} | 上次 Dream: ${info.state.lastDreamAt ?? '无'} | 上次进化: ${info.state.lastEvolutionAt ?? '无'}`,
    )
    if (info.state.collectorUnavailable === true) {
      lines.push(`!! 采集后端不可用: ${info.state.collectorUnavailableReason ?? '原因未记录'}`)
    }

    lines.push('\n== 候选区 ==')
    if (info.candidates.length === 0) lines.push('（空）')
    for (const slug of info.candidates) {
      const candidate = readCandidate(paths.candidates, slug)
      const meta = candidate.meta.replace(/---/g, '').split('\n').filter((line) => line.includes(':')).join(' ')
      lines.push(`- ${slug}  [${candidate.size} 字节]  ${meta.trim()}`)
    }

    lines.push('\n== 记忆（收件箱、画像文章与待审草稿）==')
    lines.push(
      `画像文章 ${info.memory.articleChars} 字符（模型读取时 ${info.memory.modelViewChars} 字符，降人称 ${info.memory.thirdPerson} 处） | 收件箱 ${info.memory.inbox.length} 份（上限 ${limits.maxExtracts}） | 待审草稿 ${info.memory.drafts} 份`,
    )
    lines.push('画像不常驻注入：模型用 memory 工具按需读取，本轮只在这里核对它的体量与待审状态。')
    if (info.memory.draftId !== undefined) {
      lines.push(
        `- 待审: ${info.memory.draftId}（草稿 ${info.memory.draftChars} 字符，来源提取 ${info.memory.draftSources} 份）`,
      )
      lines.push(`  review: ${info.memory.draftReviewPath}`)
      lines.push('→ 读上面这个 review.md（含与现行文章的逐行差异与完整草稿），把差异摆给用户，等用户决定后用 action="promote" 采用或 action="discard" 丢弃。采用前不要自行判断通过。')
    }
    if (info.memory.inbox.length > 0) {
      for (const name of info.memory.inbox.slice(-10)) lines.push(`- ${name}`)
      lines.push('→ 收件箱有未合并内容：可用 evolve action="dream" 立即跑一次记忆轮次（提取 + Dream）。有成稿待审时 Dream 会跳过，先处置草稿。')
    }

    lines.push('\n== 技能健康 ==')
    lines.push(renderScorecard(info.card))
    if (info.oversized.length > 0) lines.push(`超长清单: ${info.oversized.join(', ')}`)

    lines.push('\n== 日志与记忆体量 ==')
    const logLines = readText(paths.experienceLog, '').split('\n').length
    lines.push(`experience-log 行数 ${logLines}（超 100 行由收尾自动归档）`)
    lines.push(`PROFILE.md ${info.memory.articleBytes} 字节 | 收件箱 ${info.memory.inbox.length} 份 | 待审草稿 ${info.memory.drafts} 份 | 已归档提取 ${listDir(join(paths.memoryArchive, new Date().toISOString().slice(0, 7))).length} 份（本月）`)

    lines.push('\n== 宿主技能目录同名检查 ==')
    const host = await hostSkillCatalog(ctx, currentCwd())
    const collisions = info.skillNames.filter((name) => host[name] !== undefined)
    lines.push(collisions.length === 0 ? '（无同名冲突）' : collisions.map((name) => `- ${name}（宿主来源：${host[name]}）`).join('\n'))

    const problem = info.card.counts[GRADES.problem] ?? 0
    const idle = info.card.counts[GRADES.idle] ?? 0
    lines.push('\n== 本轮走向 ==')
    lines.push(
      `候选 ${info.candidates.length} / 收件箱 ${info.memory.inbox.length} / 待审草稿 ${info.memory.drafts} / 问题技能 ${problem} / 闲置技能 ${idle}`,
    )
    const quiet =
      info.candidates.length === 0 &&
      info.memory.inbox.length === 0 &&
      info.memory.drafts === 0 &&
      problem === 0 &&
      idle === 0
    if (quiet) {
      lines.push('→ 快速通道：本轮无事可做，只需 ① 本探测 ② finish 一条命令收尾 ③ 按报告模板输出简报。跳过全量体检复核与逐项陈述。')
    } else {
      lines.push('→ 常规路线：有对象待处理，按流程技能第二至第五步执行。仅在技能失败归因需要回查轨迹时用 trail 定点抽取，禁止整读轨迹。')
    }

    lines.push(`\n${renderDoctor(await doctor({ agent }))}`)

    lines.push('\n== 按需读取的细则 ==')
    lines.push(`- 候选审查细则: ${DOCS.candidateReview}`)
    lines.push(`- 技能体检细则: ${DOCS.skillHealth}`)
    lines.push(`- 报告模板: ${DOCS.reportTemplate}`)
    lines.push(`- 流程技能: ${DOCS.flowSkill}`)
    return lines.join('\n')
  }

  /** The current session's working directory, for the host skill catalog. */
  function currentCwd() {
    try {
      return process.cwd()
    } catch {
      return undefined
    }
  }

  /** Mechanical preflight over one, several or every candidate. */
  function preflightAll(slugs) {
    const targets = Array.isArray(slugs) && slugs.length > 0 ? slugs : listCandidates(paths.candidates)
    if (targets.length === 0) return '候选区为空，无需预检'
    const enabled = enabledDescriptions(paths.skills, enabledSkillNames(paths.skills))
    const lines = []
    for (const slug of targets) {
      const candidate = readCandidate(paths.candidates, slug)
      if (candidate.raw.length === 0) {
        lines.push(`${slug}: !! 缺少 SKILL.md`)
        continue
      }
      const result = preflight({
        slug,
        raw: candidate.raw,
        hasMeta: candidate.hasMeta,
        maxSkillChars: limits.maxSkillChars,
        enabled,
      })
      lines.push(`${slug}: ${result.issues.length === 0 ? '硬伤 0' : `硬伤 ${result.issues.length}`} / 警示 ${result.warnings.length}  [name=${result.name || '-'}]`)
      for (const issue of result.issues) lines.push(`  !! ${issue}`)
      for (const warning of result.warnings) lines.push(`  ?  ${warning}`)
    }
    lines.push('\n脚本结果仅供参考，启用决策由人工作出。')
    return lines.join('\n')
  }

  /** Promote one candidate into the enabled set. */
  async function enable({ slug, name }) {
    return mutate('启用', () => {
      const candidate = readCandidate(paths.candidates, slug)
      if (candidate.raw.length === 0) return `❌ 候选 ${slug} 不存在或缺少 SKILL.md`
      const finalName = typeof name === 'string' && name.length > 0 ? name : slug
      const enabledName = enableCandidate({
        candidatesDir: paths.candidates,
        skillsDir: paths.skills,
        archivedDir: paths.archived,
        slug,
        name: finalName,
        reason: '审查通过：格式校验、查重与价值评估全部通过',
      })
      const state = readState(paths)
      state.stats.skillsEnabled = enabledSkillNames(paths.skills).length
      writeState(paths, state)
      logExperience(paths, `| ${stamp()} | ${slug} | 启用 | 候选转为启用技能 ${enabledName} | skills/${enabledName}/ |`)
      // Republish only after the directory is in place and state is written.
      invalidateSkills?.()
      return `✅ 已启用: ${enabledName}（源候选 ${slug} 已归档）`
    })
  }

  /** Record one candidate as merged into an existing skill. */
  async function merge({ slug, target }) {
    return mutate('并入', () => {
      recordVerdict({
        candidatesDir: paths.candidates,
        archiveDir: paths.archived,
        slug,
        verdict: 'merged',
        reason: `并入现有技能 ${target ?? '未指明'}`,
      })
      const state = readState(paths)
      state.stats.candidatesMerged = (state.stats.candidatesMerged ?? 0) + 1
      writeState(paths, state)
      logExperience(paths, `| ${stamp()} | ${slug} | 并入 | 有价值内容并入 ${target ?? '现有技能'} | - |`)
      return `已并入: ${slug} → ${target ?? '现有技能'}（候选已出队）`
    })
  }

  /** Record one candidate as rejected. */
  async function reject({ slug, reason }) {
    return mutate('淘汰', () => {
      recordVerdict({
        candidatesDir: paths.candidates,
        archiveDir: paths.archived,
        slug,
        verdict: 'rejected',
        reason: reason ?? '未提供原因',
      })
      const state = readState(paths)
      state.stats.candidatesRejected = (state.stats.candidatesRejected ?? 0) + 1
      writeState(paths, state)
      logExperience(paths, `| ${stamp()} | ${slug} | 淘汰 | ${String(reason ?? '未提供原因').slice(0, 100)} | - |`)
      return `已淘汰: ${slug}`
    })
  }

  /** Archive an enabled skill. */
  async function archive({ name }) {
    return mutate('归档', () => {
      if (!archiveSkill({ skillsDir: paths.skills, archivedDir: paths.archived, name })) return `❌ 未找到启用技能 ${name}`
      const state = readState(paths)
      state.stats.skillsEnabled = enabledSkillNames(paths.skills).length
      writeState(paths, state)
      logExperience(paths, `| ${stamp()} | ${name} | 归档 | 技能移出启用区，源文件保留在 archived/ | archived/${name}/ |`)
      invalidateSkills?.()
      return `已归档: ${name}（可随时恢复）`
    })
  }

  /** Restore an archived skill. */
  async function restore({ name }) {
    return mutate('恢复', () => {
      if (!restoreSkill({ skillsDir: paths.skills, archivedDir: paths.archived, name })) return `❌ 未找到归档技能 ${name}`
      const state = readState(paths)
      state.stats.skillsEnabled = enabledSkillNames(paths.skills).length
      writeState(paths, state)
      logExperience(paths, `| ${stamp()} | ${name} | 恢复 | 归档技能回到启用区 | skills/${name}/ |`)
      invalidateSkills?.()
      return `已恢复: ${name}`
    })
  }

  /** The skill scorecard. */
  function health({ all = false } = {}) {
    const info = inspect()
    return renderScorecard(info.card, { all })
  }

  /** One skill's usage detail, for a borderline health decision. */
  function usageDetail({ name }) {
    const info = inspect()
    const row = info.card.rows.find((entry) => entry.name === name)
    if (row === undefined) return `未找到技能 ${name}（启用区 ${info.skillNames.length} 个）`
    const lines = [
      `${row.grade} ${row.total}分  ${row.name}`,
      `使用 ${row.count} 次（${row.signal} 信号） | 最近 ${row.days === undefined ? '无记录' : `${Math.round(row.days)} 天前`} | 成功 ${row.succ} / 失败 ${row.fail} / 未知 ${row.outcomes?.unknown ?? 0}`,
    ]
    for (const note of row.notes) lines.push(`- ${note}`)
    for (const reason of row.failReasons) lines.push(`· ${reason}`)
    if (row.fail > 0) lines.push('失败原因是启发式归因，复核请用 trail 定点回查该技能最后一次会话。')
    return lines.join('\n')
  }

  /**
   * Run a memory round on request: extract the current session and merge if due.
   *
   * The manual path skips the idle gate — the user asked for it — but keeps
   * every circuit breaker, so a private session still never leaves the machine.
   *
   * @param options - the round inputs.
   * @returns a short account of the round.
   */
  async function dream({ force = true, agent } = {}) {
    const session = agent?.session
    if (session === undefined) return '❌ 记忆轮次需要会话上下文（请在本会话内调用）'
    if (session.header?.parentSession !== undefined) return '子代理会话不参与记忆轮次'
    const sessionKey = String(session.id ?? 'unknown')
    const result = await mutate('记忆轮次', async () => {
      const state = readState(paths)
      return memory.runMemoryRound({ state, trace: traceStateFor(session), agent, sessionKey, force })
    })
    if (typeof result === 'string' && !result.startsWith('❌')) {
      logExperience(paths, `| ${stamp()} | ${sessionKey} | 记忆轮次 | ${result.replace(/\n/g, ' / ').replace(/\|/g, '/').slice(0, 160)} | - |`)
    }
    return result
  }

  /**
   * Accept the pending portrait draft as the standing article.
   *
   * This is the one path that changes `memory/PROFILE.md`, and it exists so the
   * change is a recorded human verdict rather than a side effect of a merge. The
   * extracts the draft consumed are archived here, which is why a discarded
   * draft leaves them in place for the next merge.
   *
   * @returns a short account of the promotion.
   */
  async function promoteMemory() {
    return mutate('采用画像草稿', () => {
      const id = pendingDraftId(paths)
      if (id === undefined) return '❌ 没有待审的画像草稿'
      const result = promoteDraft(paths, id)
      if (result === undefined) return `❌ 画像草稿 ${id} 不可读，未采用`
      const state = readState(paths)
      bump(state, 'dreamsPromoted')
      bump(state, 'memoryConsumed', result.sources.length)
      writeState(paths, state)
      logExperience(
        paths,
        `| ${stamp()} | Dream | 采用 | 草稿 ${id} → memory/PROFILE.md（${result.articleChars} 字符），归档 ${result.sources.length} 份提取 | memory/PROFILE.md |`,
      )
      return [
        `✅ 已采用画像草稿 ${id}：memory/PROFILE.md 现为 ${result.articleChars} 字符，${result.sources.length} 份提取已归档。`,
        '画像不常驻注入：此后模型要用 memory 工具读取它。',
      ].join('\n')
    })
  }

  /**
   * Reject the pending portrait draft.
   *
   * Nothing is installed and no extract is consumed, so the same facts are
   * merged again by the next Dream once its interval comes round.
   *
   * @param options - the rejection inputs.
   * @param options.reason - why it was rejected, kept with the archived draft.
   * @returns a short account of the rejection.
   */
  async function discardMemory({ reason } = {}) {
    return mutate('丢弃画像草稿', () => {
      const id = pendingDraftId(paths)
      if (id === undefined) return '❌ 没有待审的画像草稿'
      const verdict = typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : '未提供原因'
      const dir = discardDraft(paths, id, { reason: verdict })
      if (dir === undefined) return `❌ 画像草稿 ${id} 不可读，未丢弃`
      const state = readState(paths)
      bump(state, 'dreamsDiscarded')
      writeState(paths, state)
      logExperience(paths, `| ${stamp()} | Dream | 丢弃 | 草稿 ${id}：${verdict.slice(0, 100)}，PROFILE.md 未改动 | memory/archive/drafts/${id}/ |`)
      return `已丢弃画像草稿 ${id}（${verdict}）：PROFILE.md 未改动，收件箱里的提取留给下一次 Dream 重新合并；草稿存档于 ${dir}`
    })
  }

  /**
   * Show the resolved collector chain, ignoring the fingerprint cache.
   *
   * The chain is what every leg spends money through, so being able to see what
   * it currently resolves to — and what was discarded and why — is the cheapest
   * way to diagnose a silent stall.
   */
  async function models({ agent } = {}) {
    const state = readState(paths)
    const resolved = await llm.resolveChain({ agent, state, force: true })
    writeState(paths, state)
    const lines = [
      resolved.chain.length === 0
        ? '无可用采集模型：请在 config.json 的 collector.models 钉扎一个模型，或确认 DSH 已配置可用供应商'
        : `采集链（${resolved.chain.length}）：${llm.chainKey(resolved.chain)}`,
      `缓存: ${resolved.cached ? '命中（6 小时内且指纹未变）' : '已重新解析'}`,
    ]
    for (const item of resolved.discarded) {
      lines.push(`丢弃 ${item.provider}${item.model ? `/${item.model}` : ''}：${item.reason}`)
    }
    logExperience(paths, `| ${stamp()} | - | 采集链 | ${resolved.note.replace(/\|/g, '/')} | - |`)
    return lines.join('\n')
  }

  /**
   * Recover a bounded slice of the current session's trace.
   *
   * The rule the original kept is the important part: never read a whole
   * transcript. A keyword locates the neighbourhood, and both the number of
   * records and the character budget are capped.
   */
  function trail({ keyword, max = 30, chars = 4000, session } = {}) {
    const state = typeof traceStateFor === 'function' ? traceStateFor(session) : undefined
    if (state === undefined || !Array.isArray(state.entries)) return '当前会话没有可回查的轨迹'
    const needle = typeof keyword === 'string' ? keyword.trim().toLowerCase() : ''
    const all = state.entries
    const hits = []
    for (const entry of all) {
      if (needle.length > 0) {
        const text = JSON.stringify(entry).toLowerCase()
        if (!text.includes(needle)) continue
      }
      hits.push(entry)
      if (hits.length >= max) break
    }
    if (hits.length === 0) return `未找到匹配「${keyword ?? ''}」的轨迹记录（会话共 ${all.length} 条记录）`
    const summary = buildTraceSummary(hits, chars)
    return `== 轨迹定点回查（${session?.id ?? '当前会话'}，命中 ${hits.length} 条，限长 ${chars}）==\n${summary}`
  }

  /**
   * Finish the round: rotate the log, refresh the counters, record the run and
   * commit the data root when it is a git checkout.
   */
  async function finish({ summary, updated = 0, repaired = 0, rejected = 0, merged = 0, commit = true, agent } = {}) {
    // Check before writing, the original's rule: if the data root cannot hold
    // the round, refuse it rather than record a round that did not happen.
    const check = await doctor({ agent })
    if (!check.ok) {
      return [
        '❌ 收尾中止：完整性检查未通过，未改写 state.json、未写日志、未提交。',
        renderDoctor(check),
      ].join('\n')
    }

    const result = await mutate('收尾', () => {
      const state = readState(paths)
      const before = {
        skillsEnabled: state.stats.skillsEnabled,
        evolutions: state.stats.evolutions ?? 0,
        skillsUpdated: state.stats.skillsUpdated ?? 0,
      }
      state.stats.skillsEnabled = enabledSkillNames(paths.skills).length
      state.stats.evolutions = before.evolutions + 1
      state.stats.skillsUpdated = before.skillsUpdated + Number(updated || 0)
      if (Number(repaired) > 0) state.stats.skillsRepaired = (state.stats.skillsRepaired ?? 0) + Number(repaired)
      if (Number(rejected) > 0) state.stats.candidatesRejected = (state.stats.candidatesRejected ?? 0) + Number(rejected)
      if (Number(merged) > 0) state.stats.candidatesMerged = (state.stats.candidatesMerged ?? 0) + Number(merged)
      state.lastEvolutionAt = new Date().toISOString()
      // A finished round proves the queue was drained, so the collector starts
      // clean rather than remembering rejections for sessions long gone.
      state.sessionRejections = {}
      writeState(paths, state)

      const line = `| ${stamp()} | - | 进化 | ${summary || '进化流程收尾'} | - |`
      logExperience(paths, line)
      const rotated = rotateExperienceLog(paths)
      // The two ledgers change every turn and are deliberately kept out of
      // version control; this snapshot is the recoverable copy.
      const backups = ['state.json', 'usage.json']
        .map((name) => snapshotLedger(paths, join(paths.root, name), name))
        .filter((target) => target !== undefined)
      const commitResult = commit ? gitCommit(paths, `chore(evolution): ${summary || '进化流程收尾'}`) : '已跳过（--no-commit）'

      return [
        `state.json: skillsEnabled ${before.skillsEnabled} → ${state.stats.skillsEnabled} | evolutions ${before.evolutions} → ${state.stats.evolutions} | skillsUpdated ${before.skillsUpdated} → ${state.stats.skillsUpdated}`,
        `日志行: ${line}`,
        rotated === undefined ? '日志维护: 未超限，无需归档' : `日志维护: 已归档到 ${rotated}`,
        backups.length === 0 ? '账目快照: 无可复制文件' : `账目快照: ${backups.length} 份 → logs/archive/ledger-backup/`,
        `git: ${commitResult}`,
        renderDoctor(check),
      ].join('\n')
    })
    return result
  }

  /** The panel's data feed. */
  function overview() {
    const info = inspect()
    return {
      status: status(),
      candidates: info.candidates.map((slug) => {
        const candidate = readCandidate(paths.candidates, slug)
        return { slug, size: candidate.size, meta: candidate.meta }
      }),
      memory: {
        articleChars: info.memory.articleChars,
        modelViewChars: info.memory.modelViewChars,
        inbox: info.memory.inbox,
        drafts: info.memory.drafts,
        draftId: info.memory.draftId,
        draftChars: info.memory.draftChars,
        draftReviewPath: info.memory.draftReviewPath,
        thirdPerson: info.memory.thirdPerson,
        lastDreamAt: info.state.lastDreamAt,
      },
      archived: info.archived,
      skills: info.card.rows.map((row) => ({
        name: row.name,
        grade: row.grade,
        total: row.total,
        count: row.count,
        days: row.days,
        fail: row.fail,
        signal: row.signal,
        size: row.size,
        notes: row.notes,
      })),
      docs: DOCS,
    }
  }

  return {
    status,
    overview,
    doctor,
    brief,
    preflightAll,
    enable,
    merge,
    reject,
    archive,
    restore,
    health,
    usageDetail,
    dream,
    promoteMemory,
    discardMemory,
    models,
    trail,
    finish,
  }
}

/**
 * Commit the data root when it lives inside a git checkout.
 *
 * The scope check is the original's, and it is the point: only the data root is
 * ever staged, so a data root that happens to sit inside a project repository
 * can never sweep that project's work into an evolution commit.
 *
 * @param paths - the layout table.
 * @param message - the commit subject.
 * @returns a human-readable result.
 */
export function gitCommit(paths, message) {
  try {
    const top = execFileSync('git', ['-C', paths.root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    if (top.length === 0) return '数据根不在 git 仓库内，跳过提交'
    const home = process.env.HOME
    if (top === home || top === '/' || paths.root === '/') return '提交范围校验失败（仓库根或家目录），已拒绝提交'
    execFileSync('git', ['-C', top, 'add', '--', paths.root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const staged = execFileSync('git', ['-C', top, 'diff', '--cached', '--name-only'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    if (staged.length === 0) return '无改动，跳过提交'
    execFileSync('git', ['-C', top, 'commit', '-m', message, '--', paths.root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const hash = execFileSync('git', ['-C', top, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    return `已提交 ${hash}（范围仅 ${paths.root}）`
  } catch (error) {
    return `git 提交失败: ${String(error?.message ?? error).slice(0, 160)}`
  }
}

/** Re-export for callers that need the raw grades. */
export { GRADES }
