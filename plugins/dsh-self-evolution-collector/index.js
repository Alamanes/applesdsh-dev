/**
 * dsh-self-evolution-collector — the skill-leg row.
 *
 * Runs one collection pass after a turn stops, decides from the folded trace
 * whether the pass is worth a draft, and quarantines whatever it drafts. The
 * pass never blocks the turn: it is started and left to settle on its own, and
 * every failure inside it is contained there.
 *
 * @module dsh-self-evolution-collector
 */

import { settingsFor, runtime } from 'dsh-self-evolution-core/lib/runtime.js'
import { stamp } from 'dsh-self-evolution-core/lib/store.js'
import { runCollector } from './lib/collector.js'

/** Plugin name shown in the Loader inventory. */
export const name = 'self-evolution-collector'

/** No required service: the pass reports, rather than throws, when a seam is absent. */
export const inject = []

/**
 * Publish the pass and arm its trigger.
 *
 * @param ctx - the plugin's context.
 * @param rowConfig - the plugin row's `config` from the composition.
 */
export function apply(ctx, rowConfig) {
  const settings = settingsFor(rowConfig)

  /**
   * Run one skill-leg collection pass for an agent.
   *
   * Subagent sessions are skipped: their work is already part of the parent
   * conversation, and analysing them separately would draft the same experience
   * twice.
   *
   * @param agent - the agent whose session just closed a turn.
   * @param options - `force` bypasses the throttle and the trigger threshold.
   * @returns the pass's account of itself.
   */
  async function collectCurrent(agent, { force = false } = {}) {
    const session = agent?.session
    if (session === undefined) return '采集不可用：没有会话上下文'
    if (session.header?.parentSession !== undefined) return '子代理会话不参与采集'
    const state = runtime.traceStateOf?.(session)
    if (state === undefined) return '采集不可用：sessionProjections 未挂载'
    if (runtime.llm === undefined) return '采集不可用：采集模型链组件尚未加载'
    const sessionKey = String(session.id ?? 'unknown')
    return runCollector({
      settings,
      entries: state.entries ?? [],
      sessionKey,
      agent,
      llm: runtime.llm,
      force,
    })
  }

  runtime.collectCurrent = collectCurrent

  if (!settings.autoCollect) return

  // A collector that stopped working must not look like a collector with
  // nothing to do. The first such reason is written to the experience log;
  // later repeats stay out of it, so one broken seam cannot flood the log.
  let reportedUnavailable = false
  ctx.on('agent/turn-stopping', ({ agent }) => {
    if (agent === undefined) return
    void collectCurrent(agent)
      .then((note) => {
        if (typeof note !== 'string' || reportedUnavailable) return
        if (!note.includes('采集不可用')) return
        reportedUnavailable = true
        runtime.log?.(`| ${stamp()} | - | 降级 | 自动采集未生效：${note} | - |`)
      })
      .catch((error) => {
        if (reportedUnavailable) return
        reportedUnavailable = true
        runtime.log?.(`| ${stamp()} | - | 降级 | 自动采集异常：${String(error?.message ?? error).slice(0, 200)} | - |`)
      })
  })
}
