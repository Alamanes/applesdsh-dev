/**
 * The memory leg: per-session extraction, the daily Dream, and the sweep.
 *
 * This is the second, quieter half of the collector. The skill leg asks "was
 * this work worth keeping?"; this leg asks "what did we learn about the
 * person?" The two share the breakers and the model chain and nothing else: each
 * has its own watermark, its own failure account, and its own reason to skip.
 *
 * Four gates protect the portrait from being written from unfinished work or
 * installed without a decision:
 *
 * - **Idle.** A session is only read after it has been quiet for
 *   `SE_MEMORY_IDLE_MS` (five minutes by default), because a session still in
 *   progress describes plans, not facts.
 * - **Dream interval.** The article is rewritten at most once per
 *   `SE_DREAM_INTERVAL_MS` (a day). Extraction is cheap and constant; the merge
 *   rewrites the whole article, so it runs rarely.
 * - **Inbox cap.** Past `SE_MAX_EXTRACTS` pending extracts, extraction pauses
 *   and the log says the Dream is overdue, rather than growing an unread pile.
 * - **Review.** The merge writes a draft under `memory/drafts/`, and only a
 *   human verdict turns it into `memory/PROFILE.md`. One draft at a time, so a
 *   second rewrite cannot pile up behind an unread one.
 *
 * The sweep exists because the idle gate can only ever fire for a session the
 * host is still holding: a window closed right after use would never be
 * extracted at all. It reads closed sessions through the harness's own session
 * query service, under the same breakers and watermarks.
 *
 * @module dsh-self-evolution/lib/dream
 */

import { acquireSweepLock, releaseSweepLock, stamp, writeTextAtomic } from './store.js'
import { archiveInbox, inboxFiles, readArticle, readInbox, writeExtract } from './memory.js'
import { pendingDraftId, writeDraft } from './draft.js'
import {
  MAX_EXTRACT_CHARS,
  buildDreamPrompt,
  buildMemoryExtractPrompt,
  isDreamDue,
  isIdleEnough,
  parseArticle,
  stripPromptEcho,
} from './memory-article.js'
import { parseSkipDraft, stripOuterFence, touchesHardSecretText, windowTouchesPrivatePath } from './text.js'
import { advanceCursor, bump, clearLegFailures, cursorOf, noteBreaker, noteLegFailure, writeState } from './state.js'
import { buildTraceSummary, hasUserMessage, isSelfManagement } from './trace.js'
import { applyTraceEvent, initTraceState } from './projection.js'

/** The last time each live session was seen working, for the idle gate. */
const activity = new Map()

/** Note that a session is still working, which restarts its idle clock. */
export function touchSession(sessionKey, now = Date.now()) {
  if (typeof sessionKey === 'string' && sessionKey.length > 0) activity.set(sessionKey, now)
}

/** How long a session has been quiet, or undefined when it was never seen. */
export function idleMsOf(sessionKey, now = Date.now()) {
  const last = activity.get(sessionKey)
  return Number.isFinite(last) ? now - last : undefined
}

/** One experience-log line in the original's column shape. */
function line(session, action, detail, target) {
  return `| ${stamp()} | ${session} | ${action} | ${String(detail).replace(/\|/g, '/').slice(0, 160)} | ${target} |`
}

/** One session id, whichever field carries it. */
function sessionIdOf(item) {
  const id = item?.id ?? item?.header?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** One session's creation time, whichever field carries it. */
function sessionTimeOf(item) {
  const raw = item?.createdAt ?? item?.header?.createdAt ?? item?.updatedAt ?? item?.header?.updatedAt
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Fold one stored session log into trace records.
 *
 * @param query - the session query service.
 * @param id - the session id.
 * @returns the folded trace state, or undefined when it cannot be read.
 */
export async function foldStoredSession(query, id) {
  try {
    const raw = await query.readSession(id)
    const events = Array.isArray(raw) ? raw : Array.isArray(raw?.events) ? raw.events : []
    if (events.length === 0) return undefined
    let state = initTraceState()
    for (const event of events) state = applyTraceEvent(state, event)
    return state
  } catch {
    return undefined
  }
}

/**
 * Create the memory leg bound to one plugin activation.
 *
 * @param options - the wiring inputs.
 * @param options.settings - resolved settings.
 * @param options.llm - the collector's LLM facade.
 * @param options.log - the experience-log writer.
 * @returns the leg's entry points.
 */
export function createMemoryLeg({ settings, llm, log }) {
  const { paths, limits } = settings

  /**
   * Extract durable facts about the user from one session window.
   *
   * Every exit either advances the memory watermark (the window is done with,
   * successfully or not) or counts a transient failure so the same window is
   * retried after the backend recovers.
   *
   * @param options - the extraction inputs.
   * @returns a short account of the attempt.
   */
  async function collectExtract({ state, agent, sessionKey, entries, summary, watermark, tag = '', chain }) {
    const act = (name) => (tag.length > 0 ? `${tag}·${name}` : name)
    const session = String(sessionKey)

    const settle = () => {
      if (watermark !== undefined) advanceCursor(state, session, watermark, 'memory')
      clearLegFailures(state, session, 'memory')
      writeState(paths, state)
    }

    const failed = (reason) => {
      bump(state, 'memoryFailed')
      const giveUp = noteLegFailure(state, session, limits.maxCollectRetries, 'memory')
      if (giveUp) {
        advanceCursor(state, session, watermark, 'memory')
        clearLegFailures(state, session, 'memory')
      }
      writeState(paths, state)
      log(line(session, act('画像失败'), reason, '-'))
      return `❌ ${reason}${giveUp ? '（连续失败达上限，放弃该窗口）' : ''}`
    }

    const pending = inboxFiles(paths).length
    if (pending >= limits.maxExtracts) {
      if (noteBreaker(state, session, 'inbox-full')) {
        writeState(paths, state)
        log(line(session, act('记忆暂停'), `收件箱已满（${pending} 份），待 Dream 合并`, '-'))
      }
      return `记忆收件箱已满（${pending} 份），待 Dream 合并`
    }

    const draft = await llm.draft({
      prompt: buildMemoryExtractPrompt(summary),
      maxTokens: limits.maxExtractOutputTokens,
      agent,
      state,
      chain,
    })
    if (draft.failure !== undefined) return failed(`记忆提取失败（LLM 异常）: ${String(draft.failure).slice(0, 200)}`)
    if (draft.truncated === true) {
      return failed(`记忆提取输出被截断（已用满 maxTokens=${limits.maxExtractOutputTokens}），丢弃残缺草稿`)
    }

    const skip = parseSkipDraft(draft.text)
    if (skip !== null) {
      settle()
      log(line(session, act('记忆跳过'), skip || '无可提取的持久信息', '-'))
      return `记忆跳过: ${skip || '无可提取的持久信息'}`
    }

    const { text: noEcho, dropped } = stripPromptEcho(stripOuterFence(draft.text))
    const echoNote = dropped > 0 ? `，剔除提示词回显${dropped}条` : ''
    const items = noEcho
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
    if (items.length === 0 || items.some((item) => !item.startsWith('- '))) {
      const reason = '提取格式不符（应为「- 」条目列表，禁止标题/元信息/解释文字）'
      bump(state, 'memoryRejected')
      settle()
      log(line(session, act('记忆拒绝'), `${reason}${echoNote}`, '-'))
      return `❌ ${reason}`
    }
    if (noEcho.length > MAX_EXTRACT_CHARS) {
      const reason = `提取超长（${noEcho.length} > ${MAX_EXTRACT_CHARS} 字符，未遵守最小化约束）`
      bump(state, 'memoryRejected')
      settle()
      log(line(session, act('记忆拒绝'), reason, '-'))
      return `❌ ${reason}`
    }

    if (readInbox(paths).some((item) => item.body === noEcho.trim())) {
      settle()
      log(line(session, act('记忆跳过'), '与收件箱现有提取内容完全相同（重复采集）', '-'))
      return '记忆与收件箱现有提取相同，跳过'
    }

    const name = writeExtract(paths, session, noEcho)
    bump(state, 'memoryExtracts')
    settle()
    log(line(session, act('记忆提取'), `${items.length} 条${echoNote} → ${name}`, 'memory/inbox/'))
    return `🧠 已写入记忆收件箱: ${name}`
  }

  /**
   * Merge the inbox into a portrait draft.
   *
   * In review mode this is where the merge stops: the result is written under
   * `memory/drafts/` and `memory/PROFILE.md` is untouched, so nothing a model
   * wrote about the user can be read by a later session until a human accepts
   * it. The extracts stay in the inbox until acceptance, because a rejected
   * draft must consume nothing.
   *
   * With `dreamReview: false` the old behaviour is available: the validated
   * article is installed and the extracts are archived immediately. The checks
   * are the same either way, since both destinations are strict about shape.
   *
   * @param options - the merge inputs.
   * @returns a short account of the merge.
   */
  async function runDream({ state, agent, chain }) {
    const files = inboxFiles(paths)
    if (files.length === 0) return '收件箱为空，Dream 跳过'

    const failed = (reason) => {
      bump(state, 'dreamsFailed')
      state.dreamFailures = (state.dreamFailures ?? 0) + 1
      writeState(paths, state)
      log(line('Dream', '失败', reason, '-'))
      return `❌ Dream ${reason}`
    }

    const extracts = readInbox(paths)
    if (extracts.length === 0) return '收件箱无可读内容，Dream 跳过'

    const previous = readArticle(paths)
    const draft = await llm.draft({
      prompt: buildDreamPrompt(previous, extracts.map((item) => item.body)),
      maxTokens: limits.maxArticleOutputTokens,
      agent,
      state,
      chain,
    })
    if (draft.failure !== undefined) return failed(`LLM 异常: ${String(draft.failure).slice(0, 150)}`)
    if (draft.truncated === true) return failed(`输出被截断（已用满 maxTokens=${limits.maxArticleOutputTokens}），丢弃`)

    const parsed = parseArticle(draft.text)
    if (!parsed.ok) return failed(`文章校验失败：${parsed.reason}`)

    const size = `${parsed.paragraphs} 段 / ${parsed.text.length} 字符`

    if (settings.dreamReview) {
      const written = writeDraft(paths, {
        article: parsed.text,
        previous,
        sources: files,
        stats: { paragraphs: parsed.paragraphs, chain: llm.chainKey(chain) },
      })
      bump(state, 'dreams')
      bump(state, 'dreamDrafts')
      delete state.dreamFailures
      state.lastDreamAt = new Date().toISOString()
      writeState(paths, state)
      log(line('Dream', '待审', `${files.length} 份提取 → 草稿（${size}），未生效`, `memory/drafts/${written.id}/`))
      return [
        `🌙 Dream 已成稿待审：合并 ${files.length} 份提取，草稿 ${size}，PROFILE.md 未改动。`,
        `审阅 ${written.reviewPath}`,
        '确认后调用 evolve action="promote" 采用，或 action="discard" 丢弃。',
      ].join('\n')
    }

    writeTextAtomic(paths.profile, parsed.text)
    archiveInbox(paths, files)
    delete state.dreamFailures
    state.lastDreamAt = new Date().toISOString()
    bump(state, 'dreams')
    bump(state, 'memoryConsumed', files.length)
    writeState(paths, state)
    log(line('Dream', '合并', `${files.length} 份提取 → PROFILE.md（${size}）`, 'memory/PROFILE.md'))
    return `🌙 Dream 完成：合并 ${files.length} 份提取，文章 ${size}`
  }

  /**
   * The Dream gate, shared by all three callers.
   *
   * One place decides whether a merge happens, so the conditions cannot drift
   * between the session path, the sweep and the manual command. A draft still
   * waiting for a verdict blocks the next merge: two pending rewrites of the
   * same article would only make the review harder.
   */
  async function runDreamGate({ state, agent, force = false, chain }) {
    if (!force && !isDreamDue(state.lastDreamAt, Date.now(), limits.dreamIntervalMs)) return 'Dream 未到期，跳过'
    if (settings.dreamReview) {
      const pending = pendingDraftId(paths)
      if (pending !== undefined) return `Dream 跳过：已有待审草稿 memory/drafts/${pending}/`
    }
    let resolved = chain
    if (!Array.isArray(resolved) || resolved.length === 0) {
      const result = await llm.resolveChain({ agent, state, force: false })
      writeState(paths, state)
      resolved = result.chain
      if (resolved.length === 0) return 'Dream 跳过：采集模型链全部不可用'
    }
    return runDream({ state, agent, chain: resolved })
  }

  /**
   * One memory round for the current session: extract, then merge if due.
   *
   * @param options - the round inputs.
   * @param options.state - the working state object.
   * @param options.trace - the session's trace projection state.
   * @param options.sessionKey - the session key.
   * @param options.force - bypass the idle gate.
   * @returns a short account of the round.
   */
  async function runMemoryRound({ state, trace, agent, sessionKey, force = false }) {
    const notes = []
    const sessionId = String(sessionKey)
    if (!force) {
      const idle = idleMsOf(sessionId)
      if (idle === undefined) return '会话活动时间未知，记忆轮次跳过'
      if (!isIdleEnough(Date.now() - idle, Date.now(), limits.memoryIdleMs)) {
        const wait = Math.ceil((limits.memoryIdleMs - idle) / 60000)
        return `会话未闲置够（还需约 ${wait} 分钟），记忆轮次跳过`
      }
    }

    const entries = Array.isArray(trace?.entries) ? trace.entries : []
    const cursor = cursorOf(state, sessionId, 'memory')
    const window = entries.filter((entry) => entry.seq === undefined || entry.seq > cursor)
    const watermark = window.length > 0 ? window[window.length - 1].seq : undefined
    const summary = buildTraceSummary(window, limits.maxTraceChars)

    const retire = (kind, reason) => {
      if (watermark !== undefined) advanceCursor(state, sessionId, watermark, 'memory')
      if (noteBreaker(state, sessionId, kind)) log(line(sessionId, '熔断', reason, '-'))
      writeState(paths, state)
    }

    if (window.length === 0) {
      notes.push('记忆腿已采集到最新')
    } else if (summary.trim().length === 0 || !hasUserMessage(window)) {
      advanceCursor(state, sessionId, watermark, 'memory')
      writeState(paths, state)
      notes.push('窗口无用户发言，记忆腿跳过')
    } else if (!force && isSelfManagement(window)) {
      retire('自我管理', '自我管理会话，记忆腿跳过不发 LLM')
      notes.push('熔断：自我管理会话，记忆腿跳过')
    } else if (windowTouchesPrivatePath(window, settings.privatePatterns)) {
      retire('私密路径', '工具调用触及私密文件路径，记忆腿跳过')
      notes.push('熔断：轨迹涉及隐私内容，记忆腿跳过')
    } else if (touchesHardSecretText(window)) {
      retire('凭据', '轨迹正文含凭据形态，记忆腿跳过')
      notes.push('熔断：轨迹含凭据，记忆腿跳过')
    } else {
      try {
        notes.push(await collectExtract({ state, agent, sessionKey: sessionId, entries: window, summary, watermark }))
      } catch (error) {
        notes.push(`记忆提取异常: ${String(error?.message ?? error).slice(0, 150)}`)
      }
    }

    try {
      notes.push(await runDreamGate({ state, agent, force }))
    } catch (error) {
      notes.push(`Dream 异常: ${String(error?.message ?? error).slice(0, 150)}`)
    }
    return notes.join('\n')
  }

  /**
   * Extract from sessions that closed before their idle gate could fire.
   *
   * @param options - the sweep inputs.
   * @returns a short account of the sweep.
   */
  async function sweepClosedSessions({ state, query, currentSessionKey }) {
    if (!settings.sweep) return '清扫已关闭'
    if (query === undefined || query === null || typeof query.listSessions !== 'function') {
      return '清扫跳过：宿主未提供会话查询服务'
    }

    const now = Date.now()
    if (!acquireSweepLock(paths, { cooldownMs: limits.sweepCooldownMs, staleMs: limits.sweepLockStaleMs }, now)) {
      return '清扫冷却中或已被其他进程持有，跳过'
    }
    try {
      let sessions = []
      try {
        sessions = (await query.listSessions()) ?? []
      } catch (error) {
        return `清扫跳过：会话列表不可用（${String(error?.message ?? error).slice(0, 120)}）`
      }

      const candidates = []
      const skipped = { current: 0, live: 0, old: 0, subagent: 0 }
      for (const item of sessions) {
        const id = sessionIdOf(item)
        if (id === undefined) continue
        if (id === String(currentSessionKey)) {
          skipped.current += 1
          continue
        }
        // A session another process still holds is not closed; its own idle
        // gate will fire there.
        if (item?.live === true) {
          skipped.live += 1
          continue
        }
        if (item?.parentSession !== undefined || item?.header?.parentSession !== undefined) {
          skipped.subagent += 1
          continue
        }
        const created = sessionTimeOf(item)
        if (created !== undefined && now - created > limits.sweepBackfillMs) {
          skipped.old += 1
          continue
        }
        candidates.push(id)
      }

      if (candidates.length === 0) return '清扫：无待补的已关闭会话'

      const resolved = await llm.resolveChain({ agent: undefined, state, force: false })
      writeState(paths, state)
      if (resolved.chain.length === 0) {
        log(line('清扫', '清扫', `跳过：采集模型链全部不可用（${resolved.note}）`, '-'))
        return '清扫跳过：采集模型链不可用'
      }

      let extracted = 0
      let blocked = 0
      let failed = 0
      let inboxFull = false
      for (const id of candidates) {
        if (extracted >= settings.sweepMax || inboxFull) break
        const folded = await foldStoredSession(query, id)
        if (folded === undefined) {
          failed += 1
          continue
        }
        const cursor = cursorOf(state, id, 'memory')
        const window = folded.entries.filter((entry) => entry.seq === undefined || entry.seq > cursor)
        if (window.length === 0) continue
        const watermark = window[window.length - 1].seq
        const summary = buildTraceSummary(window, limits.maxTraceChars)
        if (summary.trim().length === 0 || !hasUserMessage(window)) {
          advanceCursor(state, id, watermark, 'memory')
          writeState(paths, state)
          continue
        }
        const retire = (kind, reason) => {
          advanceCursor(state, id, watermark, 'memory')
          if (noteBreaker(state, id, kind)) log(line(id, '清扫熔断', reason, '-'))
          writeState(paths, state)
          blocked += 1
        }
        if (isSelfManagement(window)) {
          retire('清扫:自我管理', '自我管理会话，不发 LLM')
          continue
        }
        if (windowTouchesPrivatePath(window, settings.privatePatterns)) {
          retire('清扫:私密路径', '轨迹触及私密文件路径，跳过')
          continue
        }
        if (touchesHardSecretText(window)) {
          retire('清扫:凭据', '轨迹正文含凭据形态，跳过')
          continue
        }
        const result = await collectExtract({
          state,
          sessionKey: id,
          entries: window,
          summary,
          watermark,
          tag: '清扫',
          chain: resolved.chain,
        })
        if (result.startsWith('🧠')) extracted += 1
        else if (result.includes('收件箱已满')) inboxFull = true
        else if (result.startsWith('❌')) failed += 1
      }

      const dreamNote = await runDreamGate({ state, agent: undefined, chain: resolved.chain })
      // A routine skip is not news: "not due yet" and "already waiting for a
      // verdict" can hold for days, and logging either per sweep would rotate
      // the experience log on its own.
      const routine =
        dreamNote.startsWith('Dream 未到期') || dreamNote.startsWith('Dream 跳过：已有待审草稿')
      if (extracted > 0 || !routine) {
        const summary = `扫描 ${candidates.length} 个（当前会话 ${skipped.current} / 其他进程在用 ${skipped.live} / 超期 ${skipped.old} / 子代理 ${skipped.subagent}），提取 ${extracted}，熔断 ${blocked}，失败 ${failed}${inboxFull ? '，收件箱已满' : ''}；${dreamNote}`
        log(line('清扫', '清扫', summary, '-'))
      }
      return `清扫完成：提取 ${extracted} 份`
    } finally {
      releaseSweepLock(paths)
    }
  }

  return { collectExtract, runDream, runDreamGate, runMemoryRound, sweepClosedSessions }
}
