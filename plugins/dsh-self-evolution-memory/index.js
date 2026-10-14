/**
 * dsh-self-evolution-memory — the memory-leg row.
 *
 * Behind an idle timer rather than the turn hook, because a session that is
 * still working describes plans rather than facts: one round per quiet session
 * extracts what the conversation said about the user, the daily Dream merges the
 * inbox into a draft, and the sweep reaches sessions that closed before their
 * idle gate could fire.
 *
 * @module dsh-self-evolution-memory
 */

import { settingsFor, runtime, lazy } from 'dsh-self-evolution-core/lib/runtime.js'
import { stamp } from 'dsh-self-evolution-core/lib/store.js'
import { readState } from 'dsh-self-evolution-core/lib/state.js'
import { createMemoryLeg, touchSession, idleMsOf } from './lib/dream.js'

/** Plugin name shown in the Loader inventory. */
export const name = 'self-evolution-memory'

/** No required service: the model chain is read lazily through the runtime record. */
export const inject = []

/** Grace added to the idle timer, so the clock has certainly passed. */
const TIMER_GRACE_MS = 1000

/**
 * Publish the memory round and arm its timers.
 *
 * @param ctx - the plugin's context.
 * @param rowConfig - the plugin row's `config` from the composition.
 */
export function apply(ctx, rowConfig) {
  const settings = settingsFor(rowConfig)
  const memory = createMemoryLeg({
    settings,
    llm: lazy(() => runtime.llm),
    log: (line) => runtime.log?.(line),
  })
  runtime.memory = memory

  /**
   * The session query service, which is how the sweep reaches closed sessions.
   *
   * Read through `ctx.get` at use time: it is provided by a backend plugin that
   * a minimal composition may not mount, and the sweep degrades to a no-op
   * without it.
   */
  function sessionQuery() {
    try {
      return typeof ctx.get === 'function' ? ctx.get('sessionQuery') : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Run one memory round for a session, on request.
   *
   * @param agent - the session's agent.
   * @param options - `force` bypasses the idle gate.
   * @returns the round's account of itself.
   */
  async function memoryRoundNow(agent, { force = false } = {}) {
    const session = agent?.session
    if (session === undefined) return '记忆轮次不可用：没有会话上下文'
    if (session.header?.parentSession !== undefined) return '子代理会话不参与记忆轮次'
    const sessionKey = String(session.id ?? 'unknown')
    const state = readState(settings.paths)
    return memory.runMemoryRound({ state, trace: runtime.traceStateOf?.(session), agent, sessionKey, force })
  }

  runtime.memoryRoundNow = memoryRoundNow

  /** Sweep closed sessions, which the idle gate can never reach. */
  async function sweepSessions(currentSessionKey) {
    const query = sessionQuery()
    if (query === undefined) return '清扫跳过：宿主未提供会话查询服务'
    const state = readState(settings.paths)
    return memory.sweepClosedSessions({ state, query, currentSessionKey })
  }

  if (!settings.autoCollect) return

  /** One idle timer per session; each turn restarts its session's clock. */
  const pending = new Map()

  /**
   * Arm the idle timer for one session.
   *
   * The timer is the only path that can fire once a session has actually gone
   * quiet, so it writes its result to the log unconditionally: it is the one
   * observable proof that the memory leg is running at all.
   */
  function armIdleTimer(agent, sessionKey) {
    const existing = pending.get(sessionKey)
    if (existing !== undefined) clearTimeout(existing)
    const wait = Math.max(0, settings.limits.memoryIdleMs - (idleMsOf(sessionKey) ?? 0)) + TIMER_GRACE_MS
    const timer = setTimeout(() => {
      pending.delete(sessionKey)
      void memoryRoundNow(agent)
        .then((note) => {
          runtime.log?.(`| ${stamp()} | ${sessionKey} | 记忆轮次 | ${String(note).replace(/\n/g, ' / ').replace(/\|/g, '/').slice(0, 160)} | - |`)
          return sweepSessions(sessionKey)
        })
        .catch(() => {
          // Never reaches the user; the sweep's own log line is the record.
        })
    }, wait)
    if (typeof timer?.unref === 'function') timer.unref()
    pending.set(sessionKey, timer)
  }

  ctx.on('agent/turn-stopping', ({ agent }) => {
    if (agent === undefined) return
    const sessionKey = String(agent?.session?.id ?? '')
    if (sessionKey.length === 0) return
    touchSession(sessionKey)
    armIdleTimer(agent, sessionKey)
  })

  // The sweep on activation: sessions that ended before this process started
  // were never the current session anywhere, so no round would read them.
  if (settings.sweep) {
    const kickoff = setTimeout(() => {
      void sweepSessions('')
        .then((note) => {
          if (typeof note === 'string' && note.startsWith('清扫完成')) {
            runtime.log?.(`| ${stamp()} | 启动 | 清扫 | ${note} | - |`)
          }
        })
        .catch(() => {
          // Silence is right here: a failed sweep retries on the next start.
        })
    }, 0)
    if (typeof kickoff?.unref === 'function') kickoff.unref()
  }
}
