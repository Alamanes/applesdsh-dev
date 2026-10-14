/**
 * The collector: the quiet half of the system.
 *
 * It runs after a session turn has closed, looks at whatever the session has
 * produced since the last time it looked, and — only when the trace looks worth
 * a second opinion — asks a cheap model to draft one skill candidate. The
 * draft lands in quarantine. Nothing it writes can change the assistant's
 * behaviour before the user reviews it.
 *
 * The memory leg runs beside it with its own watermark and its own failure
 * account; it lives in `lib/dream.js` because its gates (idle, inbox cap, Dream
 * interval) are a different subject.
 *
 * Four disciplines are load-bearing and are preserved exactly:
 *
 * - **Incremental.** The cursor advances per session, so a long conversation is
 *   analysed in pieces and a failed run is retried later rather than lost.
 * - **Cheap.** Deterministic rules decide whether to call a model at all;
 *   the trace is truncated, the output is budgeted, the resolved chain is
 *   cached, and the reasoning effort is the lowest the model advertises.
 * - **Silent.** Every failure is recorded and none of them reaches the user.
 * - **Walled.** A session that touches private paths, or that carries a
 *   credential in its own text, never leaves the machine; a session that is the
 *   evolution flow itself is skipped so the system does not spend tokens
 *   describing itself to itself.
 *
 * @module dsh-self-evolution-collector/lib/collector
 */

import { bump, clearLegFailures, cursorOf, advanceCursor, noteBreaker, noteLegFailure, noteSkip, readState, recordRejection, writeState } from 'dsh-self-evolution-core/lib/state.js'
import { buildSkillPrompt } from './prompts.js'
import { buildTraceSummary, countErrors, countToolCalls, hasUserMessage, isSelfManagement } from 'dsh-self-evolution-trace/lib/trace.js'
import { isBlank, isLegalSlug, maskSecretsWithCount, parseSkipDraft, slugify, stripOuterFence, touchesHardSecretText, windowTouchesPrivatePath } from 'dsh-self-evolution-core/lib/text.js'
import { enabledDescriptions, listCandidates, writeCandidate } from 'dsh-self-evolution-candidates/lib/candidates.js'
import { exists, listDir, logExperience, stamp, withLock, writeRejectedDraft } from 'dsh-self-evolution-core/lib/store.js'
import { trackUsage, readUsage, writeUsage } from 'dsh-self-evolution-health/lib/usage.js'
import { enabledSkillNames } from 'dsh-self-evolution-skills/lib/skills.js'
import { join } from 'node:path'

/** Ending tokens that suggest a truncated draft. */
const TRUNC_TAILS = ['→', '：', ':', '、', '，', '；', '-', '|', '*', '(', '（', '【', '《', '…']
/** Ending tokens that suggest a complete draft. */
const OK_TAILS = ['。', '）', ')', '」', '】', '》', '"', '`']

/** One line of the experience log. */
function logLine(session, action, detail, target) {
  return `| ${stamp()} | ${session} | ${action} | ${String(detail).replace(/\|/g, '/').slice(0, 160)} | ${target} |`
}

/**
 * Run the usage scan and the skill leg for one finished session.
 *
 * @param options - the pass inputs.
 * @param options.settings - resolved settings.
 * @param options.entries - the trace records produced since the session began.
 * @param options.sessionKey - the session key used for cursors and de-duplication.
 * @param options.agent - the session's agent, used to resolve the fallback model.
 * @param options.llm - the collector's LLM facade.
 * @param options.force - bypass the throttle, the threshold and the self-management break.
 * @returns a short account of the pass.
 */
export async function runCollector({ settings, entries, sessionKey, agent, llm, force = false }) {
  const { paths, limits } = settings
  if (!Array.isArray(entries) || entries.length === 0) return '会话无可分析内容'

  return withLock(paths, async () => {
    const state = readState(paths)
    const cursor = cursorOf(state, sessionKey)
    const window = entries.filter((entry) => entry.seq === undefined || entry.seq > cursor)
    if (window.length === 0) return '自上次采集以来无新增内容'

    installSkills(state, settings)

    // The usage ledger is updated from the same window, before the collector
    // decides anything: whether a skill was used is a fact about the session,
    // independent of whether a new candidate is worth drafting.
    const usageNote = updateUsage({ settings, entries: window, sessionKey })
    if (usageNote !== '无技能使用信号' && usageNote !== '无已启用技能') {
      logExperience(paths, logLine(sessionKey, '技能使用', usageNote, 'usage.json'))
    }

    const candidateCount = listCandidates(paths.candidates).length
    const newest = window[window.length - 1].seq

    // The queue is full: collection pauses rather than growing an unread pile.
    if (candidateCount >= limits.maxCandidates && !force) {
      return `候选区已满（${candidateCount} 个），请先运行进化流程审查`
    }

    if (!force && limits.throttleMs > 0 && typeof state.lastCollectionAt === 'string') {
      const last = Date.parse(state.lastCollectionAt)
      if (Number.isFinite(last) && Date.now() - last < limits.throttleMs) {
        const waitMinutes = Math.ceil((limits.throttleMs - (Date.now() - last)) / 60000)
        return `节流中（${waitMinutes} 分钟后可再触发）`
      }
    }

    const summary = buildTraceSummary(window, limits.maxTraceChars)
    if (isBlank(summary)) {
      advanceCursor(state, sessionKey, newest)
      writeState(paths, state)
      return '会话无可分析内容'
    }

    // A session that is the evolution flow itself would only describe the flow
    // back to itself; skipping it keeps the system from paying for its own echo.
    if (!force && isSelfManagement(window)) {
      advanceCursor(state, sessionKey, newest)
      if (noteBreaker(state, sessionKey, '自我管理')) {
        writeState(paths, state)
        logExperience(paths, logLine(sessionKey, '熔断', '自我管理会话（执行进化流程本身），跳过采集不发 LLM', '-'))
      } else {
        writeState(paths, state)
      }
      return '熔断：自我管理会话，跳过采集'
    }

    // Both of these breaks are unconditional, including under `force`: the cost
    // of skipping a harmless session is nothing, and the cost of sending a
    // private one is not recoverable.
    if (windowTouchesPrivatePath(window, settings.privatePatterns)) {
      advanceCursor(state, sessionKey, newest)
      if (noteBreaker(state, sessionKey, '私密路径')) {
        writeState(paths, state)
        logExperience(paths, logLine(sessionKey, '熔断', '轨迹命中隐私路径模式，跳过采集', '-'))
      } else {
        writeState(paths, state)
      }
      return '熔断：轨迹涉及隐私内容，跳过采集'
    }
    if (touchesHardSecretText(window)) {
      advanceCursor(state, sessionKey, newest)
      if (noteBreaker(state, sessionKey, '凭据')) {
        writeState(paths, state)
        logExperience(paths, logLine(sessionKey, '熔断', '轨迹正文含凭据形态，跳过采集', '-'))
      } else {
        writeState(paths, state)
      }
      return '熔断：轨迹含凭据，跳过采集'
    }

    const toolCalls = countToolCalls(window)
    const errors = countErrors(window)
    bump(state, 'sessionsAnalyzed')

    if (toolCalls < limits.minToolCalls && errors === 0) {
      advanceCursor(state, sessionKey, newest)
      writeState(paths, state)
      return `条件不满足（工具调用 ${toolCalls} 次、无错误），不值得调用 LLM`
    }

    const notes = [await collectSkill({ settings, state, llm, agent, sessionKey, summary, toolCalls, errors, newest })]
    writeState(paths, state)
    return notes.filter((note) => note.length > 0).join('\n')
  })
}

/** Keep `stats.skillsEnabled` consistent with what is actually on disk. */
function installSkills(state, settings) {
  const actual = listDir(settings.paths.skills).filter(
    (name) => !name.startsWith('.') && exists(join(settings.paths.skills, name, 'SKILL.md')),
  ).length
  if (state.stats.skillsEnabled !== actual) state.stats.skillsEnabled = actual
}

/** Update `usage.json` from one trace window. */
function updateUsage({ settings, entries, sessionKey }) {
  const skillNames = enabledSkillNames(settings.paths.skills)
  const usage = readUsage(settings.paths)
  const note = trackUsage({ usage, entries, skillNames, session: sessionKey })
  if (note.startsWith('已记录')) writeUsage(settings.paths, usage)
  return note
}

/**
 * Draft one skill candidate.
 *
 * @returns a short account of the attempt.
 */
async function collectSkill({ settings, state, llm, agent, sessionKey, summary, toolCalls, errors, newest }) {
  const { paths, limits } = settings
  const enabled = enabledSkillNames(paths.skills)
  const prompt = buildSkillPrompt({
    summary,
    enabled: enabled.map((name) => ({ name, desc: enabledDescriptions(paths.skills, [name])[name] })),
    previousRejection: state.sessionRejections[sessionKey],
    maxSkillChars: limits.maxSkillChars,
  })

  const draft = await llm.draft({ prompt, maxTokens: limits.maxOutputTokens, agent, state })
  if (draft.failure !== undefined) {
    return rejectSkill({ settings, state, sessionKey, newest, reason: `LLM 调用失败: ${draft.failure}`, retryable: true })
  }
  const raw = draft.text

  const reject = (reason, options = {}) => {
    bump(state, 'candidatesRejected')
    recordRejection(state, sessionKey, reason)
    noteSkip(state, sessionKey, newest)
    advanceCursor(state, sessionKey, newest)
    clearLegFailures(state, sessionKey)
    writeState(paths, state)
    logExperience(paths, logLine(sessionKey, '拒绝沉淀', reason, '-'))
    if (options.keepDraft === true) {
      const body = [
        `# 被拒草稿（${new Date().toISOString()}）`,
        `来源会话: ${sessionKey}`,
        `工具调用: ${toolCalls} 次 / 错误: ${errors} 次`,
        `备注: ${String(reason).slice(0, 200)}`,
        '',
        '--- 以下为 LLM 原始输出 ---',
        '',
        raw,
        '',
      ].join('\n')
      writeRejectedDraft(paths, body)
    }
    return `❌ ${reason}`
  }

  // A truncated answer is worse than none, and the harness reports no length
  // finish reason, so the output budget is read from the usage chunk.
  if (draft.truncated === true) {
    return reject(`LLM 输出被截断（已用满 maxTokens=${limits.maxOutputTokens}），丢弃残缺草稿`, { keepDraft: true })
  }

  // SKIP is checked before any format rule: a SKIP answer never starts with
  // `---`, so checking the format first would misreport it as malformed.
  const skip = parseSkipDraft(raw)
  if (skip !== null) {
    const reason = skip || '未提供原因'
    state.sessionRejections[sessionKey] = { at: new Date().toISOString(), reason: reason.slice(0, 200) }
    return reject(reason)
  }

  // Truncation heuristics: an unclosed fence or a tail that stops on a
  // continuation token means the draft was cut off.
  const fences = (raw.match(/```/g) ?? []).length
  if (fences % 2 === 1) return reject('LLM 输出疑似截断（代码围栏不闭合），丢弃残缺草稿', { keepDraft: true })
  const nonEmpty = raw.split('\n').map((line) => line.replace(/\s+$/, '')).filter((line) => line.trim().length > 0)
  if (nonEmpty.length > 0) {
    const last = nonEmpty[nonEmpty.length - 1]
    if (TRUNC_TAILS.some((tail) => last.endsWith(tail)) && !OK_TAILS.some((tail) => last.endsWith(tail))) {
      return reject(`LLM 输出疑似截断（尾部中断于『${last.slice(-12)}』），丢弃残缺草稿`, { keepDraft: true })
    }
  }

  const rawClean = stripOuterFence(raw.replace(/```(?:ya?ml|markdown)?\s*/g, '')).trim()
  if (rawClean.split('\n', 1)[0].trim() !== '---') {
    return reject('草稿缺少 frontmatter（首行非 ---，格式不符）', { keepDraft: true })
  }
  if (raw.length > limits.maxSkillChars) {
    return reject(`草稿超长（${raw.length} > ${limits.maxSkillChars} 字符，未遵守输出约束）`, { keepDraft: true })
  }

  const nameMatch = /^name\s*:\s*["']?([^"'\r\n]+)["']?\s*$/m.exec(rawClean)
  const name = nameMatch ? nameMatch[1].trim() : ''
  if (name.length === 0) return reject('LLM 草稿缺少合法 name（frontmatter 格式不符）', { keepDraft: true })
  if (!isLegalSlug(slugify(name))) return reject(`LLM 草稿 name 非法（须小写字母数字连字符）: ${name}`, { keepDraft: true })

  const slug = slugify(name)
  if (enabled.includes(slug)) {
    return reject(`与已启用技能 ${slug} 完全同名（查重拦截，LLM 未遵守查重规则）`, { keepDraft: true })
  }

  // The candidate body reaches git and the review queue, so credential shapes
  // are replaced with labelled placeholders before it is written.
  const { text: safeDraft, masked } = maskSecretsWithCount(rawClean)
  if (masked > 0) logExperience(paths, logLine(sessionKey, '候选脱敏', `正文命中凭据形态 ${masked} 处，已替换为占位符`, '-'))

  const written = writeCandidate({
    candidatesDir: paths.candidates,
    raw: safeDraft,
    name,
    meta: { session: sessionKey, toolCalls, errors },
  })
  if (written.duplicate === true) return reject(`与现有候选 ${written.slug} 内容完全相同（重复采集）`)

  delete state.sessionRejections[sessionKey]
  bump(state, 'candidatesCreated')
  clearLegFailures(state, sessionKey)
  advanceCursor(state, sessionKey, newest)
  state.lastCollectionAt = new Date().toISOString()
  writeState(paths, state)
  logExperience(paths, logLine(sessionKey, '候选生成', `工具${toolCalls}次/错误${errors}次 → ${written.slug}`, `candidates/${written.slug}/`))
  return `🎉 已生成候选技能: ${written.slug}（工具${toolCalls}次/错误${errors}次）`
}

/**
 * Record a transient drafting failure.
 *
 * A transient failure must not advance the cursor, so the same window is
 * re-analysed once the backend recovers. After the retry ceiling the cursor
 * advances anyway: never retrying forever matters more than one lost window.
 */
function rejectSkill({ settings, state, sessionKey, newest, reason, retryable = false }) {
  const { paths } = settings
  bump(state, 'collectFailures')
  recordRejection(state, sessionKey, reason)
  const giveUp = !retryable || noteLegFailure(state, sessionKey, settings.limits.maxCollectRetries)
  if (giveUp) {
    advanceCursor(state, sessionKey, newest)
    clearLegFailures(state, sessionKey)
    if (reason.includes('采集链为空')) {
      state.collectorUnavailable = true
      state.collectorUnavailableReason = reason.slice(0, 300)
    }
  }
  writeState(paths, state)
  logExperience(paths, logLine(sessionKey, giveUp ? '采集失败' : '采集暂缓', reason, giveUp ? '-' : '未推进采集点，稍后重试'))
  return `❌ ${reason}`
}

/**
 * Run the collector for one explicit session, bypassing every gate a user
 * explicitly asked to bypass.
 */
export async function collectNow({ settings, entries, sessionKey, agent, llm }) {
  return runCollector({ settings, entries, sessionKey, agent, llm, force: true })
}
