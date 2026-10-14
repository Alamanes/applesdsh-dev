/**
 * dsh-self-evolution — the DSH port of agent-self-evolution.
 *
 * One plugin, composed of separable components that each keep their own job:
 *
 * - `lib/projection.js` folds DSH session events into the unified trace. It is
 *   the only module that knows the harness event vocabulary.
 * - `lib/collector.js` decides, from that trace, whether the skill leg is worth
 *   drafting, and drafts it through `lib/llm.js`.
 * - `lib/dream.js` is the memory leg: per-session extraction into the inbox, the
 *   daily Dream that proposes a new portrait article, and the sweep over
 *   sessions that closed before their idle gate could fire.
 * - `lib/memory-article.js` holds the article rules; `lib/memory.js` holds its
 *   storage and its section search; `lib/draft.js` is the review gate a Dream's
 *   output passes through before it becomes the article.
 * - `lib/memory-tool.js` is the model's only door to the article, and it opens
 *   on request.
 * - `lib/candidates.js` quarantines what was drafted; `lib/skills.js` serves
 *   only what was reviewed.
 * - `lib/usage.js` and `lib/health.js` are the feedback loop that says which
 *   skills still earn their context.
 * - `lib/evolve.js` is the manual flow, `lib/tools.js` and `lib/commands.js`
 *   are its two surfaces, `lib/api.js` and `client.js` are the panel.
 * - `lib/state.js` is the ledger; `lib/doctor.js` is the integrity check the
 *   flow runs before it writes.
 *
 * The load-bearing design is the split, applied to both legs. Collection is
 * automatic and quiet; evolution is manual and deliberate; and nothing the
 * collector writes can change the assistant's behaviour until a human moves it
 * out of quarantine. The portrait obeys the same rule: it is proposed as a
 * draft, and until it is accepted it is neither the article nor anything a
 * model can read.
 *
 * @module dsh-self-evolution
 */

import { resolveSettings } from './lib/config.js'
import { ensureLayout, exists, logExperience, stamp } from './lib/store.js'
import { ensureMemoryFiles, createIdentityReader } from './lib/memory.js'
import { memoryTool } from './lib/memory-tool.js'
import { createCollectorLlm } from './lib/llm.js'
import { runCollector } from './lib/collector.js'
import { createMemoryLeg, touchSession, idleMsOf } from './lib/dream.js'
import { createEvolve } from './lib/evolve.js'
import { readState, writeState } from './lib/state.js'
import { createSkillProvider } from './lib/skills.js'
import { traceProjectionDefinition, TRACE_KEY } from './lib/projection.js'
import { evolveTool } from './lib/tools.js'
import { evolveCommand } from './lib/commands.js'
import { mountRoutes } from './lib/api.js'

/** Plugin name shown in the Loader inventory. */
export const name = 'self-evolution'

/**
 * Hard service dependencies: without a tool registry and a prompt registry
 * there is no surface to attach to. Everything else — the skill registry, the
 * model service, the projection registry, the session query, commands, the
 * connection — is claimed through `ctx.inject()`, so a minimal composition
 * still loads.
 */
export const inject = ['tools', 'systemPrompt']

/** System-prompt section identity. */
const SECTION_NAME = 'evolve:discipline'

/** Section order, placed with the tool-guidance block. */
const SECTION_ORDER = 3050

/** Identity section identity and order, directly before the discipline. */
const IDENTITY_SECTION = 'evolve:identity'
const IDENTITY_ORDER = 3040

/** Grace added to the idle timer, so the clock has certainly passed. */
const TIMER_GRACE_MS = 1000

/**
 * The frame around the identity line.
 *
 * The line exists so the assistant behaves as if it already knows who it is
 * talking to; the frame exists so that advantage is not spent by announcing it.
 */
const IDENTITY_FRAME = '已知用户背景（内部信息，用来调整称呼、语气与默认做法；不要复述给用户，也不要写「根据我的记忆」）'

/**
 * The standing discipline, injected for as long as the plugin is loaded.
 *
 * Kept short on purpose. The flow itself lives in the `self-evolve` skill, which
 * the model loads only when the user asks for it; this section only has to make
 * the contract discoverable — that a collector exists, what it produces, and
 * that the flow is user-triggered.
 *
 * The portrait body is deliberately absent from this text and from the prompt:
 * it is read through the `memory` tool when a step wants it. What does stand in
 * the prompt is the one-line identity from the article's lead section, which is
 * what "it already knows me" feels like from the user's side.
 */
const DISCIPLINE = `[plugin: self-evolution]
一个后台采集器会在任务结束后安静地分析本次会话，分两条腿：技能腿在达到阈值（工具调用 ≥5 次或出现错误）时用最便宜的可用模型草拟「技能候选」，只写进待确认区；记忆腿在会话闲置 5 分钟后提取关于用户的持久信息进 memory/inbox/，由每天一次的 Dream 合并成一份画像草稿，等你确认后才成为 memory/PROFILE.md。候选与画像草稿在你或用户审查通过前绝不进入任何上下文。

长期画像按需读取：需要更细的背景、长期偏好或既有约定时用 memory 工具（先 outline 看索引，再 read 或 search）；没读之前不要假设自己了解她。读到的内容是内部背景，用来调整称呼、语气、详略与默认做法，不要复述、罗列，也不要写「根据我的记忆」。

当用户说「进化」「总结一天的工作」「技能体检」或要求沉淀经验时，用 skill 工具加载 self-evolve 技能，并按其流程执行：先用 evolve 工具 action="brief" 做一次探测，按探测给出的路线走，最后用 action="finish" 收尾，再按报告模板输出简报。

三条纪律：
- 不要在没有用户触发的情况下自行运行进化流程；采集器会自己跑，不需要你代劳。
- 不要重复采集同一会话，也不要整读会话轨迹；需要回查时用 evolve 的 trail 动作定点抽取。
- memory/PROFILE.md 与 memory/drafts/ 都是生成态，不要手工编辑；采用或丢弃画像草稿、归档或淘汰技能，都必须先征求用户决定。`

/**
 * Register the whole system.
 *
 * @param ctx - the plugin's context; every registration is owned by its fiber,
 *   so unloading the row removes the tool, the prompt sections, the served
 *   skills and the routes together.
 * @param rowConfig - the plugin row's `config` from the composition.
 */
export function apply(ctx, rowConfig) {
  const settings = resolveSettings(rowConfig)
  ensureLayout(settings.paths)
  ensureMemoryFiles(settings.paths)
  // `init.py` created state.json at install time in the original; here the
  // first activation does it, so the counters are readable before the first
  // collection pass rather than appearing out of nowhere afterwards.
  if (!exists(settings.paths.state)) {
    try {
      writeState(settings.paths, readState(settings.paths))
    } catch {
      // A read-only data root is reported by the integrity check instead.
    }
  }

  const log = (line) => logExperience(settings.paths, line)
  const llm = createCollectorLlm({ ctx, settings, log })
  const memory = createMemoryLeg({ settings, llm, log })

  /**
   * Report one degraded component without taking the plugin down.
   *
   * A plugin that dies whole because one optional service behaved differently
   * leaves the user with nothing and no way to see which part was at fault, so
   * each optional surface reports and yields. The core surfaces below — the
   * prompt section and the tool — stay unguarded on purpose: if those fail, the
   * plugin genuinely is not working and the loud failure is the honest one.
   *
   * @param label - what was being registered, for the warning.
   * @param error - the failure.
   */
  function degrade(label, error) {
    const detail = String(error?.message ?? error).slice(0, 300)
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(`self-evolution: ${label} 未启用：${detail}`)
    log(`| ${stamp()} | - | 降级 | ${label} 未启用：${detail} | - |`)
  }

  /**
   * Claim optional services and run the registration inside the child context.
   *
   * The guard sits inside the callback as well: `ctx.inject()` returns long
   * before the service appears, so a throw from the registration body would
   * otherwise escape every `try` around the call itself.
   *
   * @param services - the service names to claim.
   * @param label - what is being registered.
   * @param body - the registration, called with the injected child context.
   */
  function optionalIn(services, label, body) {
    try {
      ctx.inject(services, (childCtx) => {
        try {
          body(childCtx)
        } catch (error) {
          degrade(label, error)
        }
      })
    } catch (error) {
      degrade(label, error)
    }
  }

  // The skill registry is claimed optionally: a composition without it still
  // gets the collector, the memory leg and the tool.
  let invalidateSkills
  const skillProvider = createSkillProvider({
    settings,
    onInvalidate: (capability) => {
      invalidateSkills = capability
    },
  })
  optionalIn(['skills'], '技能供给（skills 服务）', (skillsCtx) => {
    skillProvider.mount(skillsCtx)
  })

  // The session projection is the collector's only source of trace records.
  let projections
  optionalIn(['sessionProjections'], '会话轨迹投影（sessionProjections 服务）', (projectionCtx) => {
    projections = projectionCtx.sessionProjections
    projectionCtx.sessionProjections.register(traceProjectionDefinition())
  })

  /** The trace state of one session, or undefined when projections are absent. */
  const traceState = (session) => {
    if (projections === undefined || session === undefined) return undefined
    try {
      return projections.stateOf(session, TRACE_KEY)
    } catch {
      return undefined
    }
  }

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

  const evolve = createEvolve({
    settings,
    ctx,
    llm,
    memory,
    invalidateSkills: () => invalidateSkills?.(),
    traceStateFor: (session) => traceState(session),
    sessionQuery,
  })

  /**
   * Run one skill-leg collection pass for an agent.
   *
   * Subagent sessions are skipped: their work is already part of the parent
   * conversation, and analysing them separately would draft the same
   * experience twice.
   *
   * @param agent - the agent whose session just closed a turn.
   * @param options - `force` bypasses the throttle and the trigger threshold.
   * @returns the pass's account of itself.
   */
  async function collectCurrent(agent, { force = false } = {}) {
    const session = agent?.session
    if (session === undefined) return '采集不可用：没有会话上下文'
    if (session.header?.parentSession !== undefined) return '子代理会话不参与采集'
    const state = traceState(session)
    if (state === undefined) return '采集不可用：sessionProjections 未挂载'
    const sessionKey = String(session.id ?? 'unknown')
    return runCollector({
      settings,
      entries: state.entries ?? [],
      sessionKey,
      agent,
      llm,
      force,
    })
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
    return memory.runMemoryRound({ state, trace: traceState(session), agent, sessionKey, force })
  }

  // The tool: the single model-facing entry point of the whole system.
  if (settings.registerTool) {
    ctx.effect(
      () => ctx.tools.register(evolveTool({ evolve, collectCurrent, memoryRoundNow })),
      'self-evolution: evolve tool',
    )
  }

  // The standing discipline. The portrait itself is not published here and not
  // published as runtime context: it is read through the `memory` tool below, so
  // what the collector learned about the user is an answer a step asked for
  // rather than a premise every step starts from.
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: DISCIPLINE,
    interpolate: false,
  })

  // The one-line identity, when there is an accepted article to take it from.
  // It is a prompt section rather than runtime context on purpose: a section is
  // standing background the deployment owns, while runtime context arrives as a
  // user-role message, and a portrait that looks like the user's own words gets
  // obeyed like them. The reader re-reads only when the article changes, so a
  // steady portrait costs one `stat` per assembly.
  if (settings.identityLine) {
    const identity = createIdentityReader(settings.paths)
    ctx.systemPrompt.section({
      name: IDENTITY_SECTION,
      order: IDENTITY_ORDER,
      interpolate: false,
      text: () => {
        const line = identity()
        return line.length === 0 ? '' : `[plugin: self-evolution] ${IDENTITY_FRAME}：${line}`
      },
    })
  }

  // The on-demand read of the full portrait. One small schema, one action field,
  // and nothing beyond the identity line standing in the prompt.
  if (settings.memoryTool) {
    ctx.effect(
      () => ctx.tools.register(memoryTool({ settings })),
      'self-evolution: memory tool',
    )
  }

  /**
   * The collector's trigger: one pass after each turn stops.
   *
   * It never blocks the turn — the pass is started and left to settle on its
   * own, and every failure inside it is contained there. The memory leg runs
   * behind an idle timer instead of here, because a session that is still
   * working describes plans rather than facts.
   */
  if (settings.autoCollect) {
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
            log(`| ${stamp()} | ${sessionKey} | 记忆轮次 | ${String(note).replace(/\n/g, ' / ').replace(/\|/g, '/').slice(0, 160)} | - |`)
            return sweepSessions(sessionKey)
          })
          .catch(() => {
            // Never reaches the user; the sweep's own log line is the record.
          })
      }, wait)
      if (typeof timer?.unref === 'function') timer.unref()
      pending.set(sessionKey, timer)
    }

    /** Sweep closed sessions, which the idle gate can never reach. */
    async function sweepSessions(currentSessionKey) {
      const query = sessionQuery()
      if (query === undefined) return '清扫跳过：宿主未提供会话查询服务'
      const state = readState(settings.paths)
      return memory.sweepClosedSessions({ state, query, currentSessionKey })
    }

    // A collector that stopped working must not look like a collector with
    // nothing to do. The first such reason is written to the experience log;
    // later repeats stay out of it, so one broken seam cannot flood the log.
    let reportedUnavailable = false
    ctx.on('agent/turn-stopping', ({ agent }) => {
      if (agent === undefined) return
      const sessionKey = String(agent?.session?.id ?? '')
      if (sessionKey.length > 0) {
        touchSession(sessionKey)
        armIdleTimer(agent, sessionKey)
      }
      void collectCurrent(agent)
        .then((note) => {
          if (typeof note !== 'string' || reportedUnavailable) return
          if (!note.includes('采集不可用')) return
          reportedUnavailable = true
          log(`| ${stamp()} | - | 降级 | 自动采集未生效：${note} | - |`)
        })
        .catch((error) => {
          if (reportedUnavailable) return
          reportedUnavailable = true
          log(`| ${stamp()} | - | 降级 | 自动采集异常：${String(error?.message ?? error).slice(0, 200)} | - |`)
        })
    })

    // The sweep on activation: sessions that ended before this process started
    // were never the current session anywhere, so no round would read them.
    if (settings.sweep) {
      const kickoff = setTimeout(() => {
        void sweepSessions('')
          .then((note) => {
            if (typeof note === 'string' && note.startsWith('清扫完成')) log(`| ${stamp()} | 启动 | 清扫 | ${note} | - |`)
          })
          .catch(() => {
            // Silence is right here: a failed sweep retries on the next start.
          })
      }, 0)
      if (typeof kickoff?.unref === 'function') kickoff.unref()
    }
  }

  if (settings.registerCommands) {
    optionalIn(['commands'], '/evolve 命令（commands 服务）', (commandCtx) => {
      commandCtx.commands.register(evolveCommand({ evolve, collectCurrent, memoryRoundNow }))
    })
  }

  if (settings.registerRoutes) {
    optionalIn(['connection'], '面板路由（connection 服务）', (routeCtx) => {
      mountRoutes({ routeCtx, evolve })
    })
  }
}
