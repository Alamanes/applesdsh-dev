/**
 * dsh-self-evolution-surface — the surface row.
 *
 * Owns what the model and the user actually touch: the `evolve` tool, the
 * `/evolve` command family, the read-only panel route, and the standing
 * discipline that makes the whole contract discoverable. The actions themselves
 * live in the flow row; this row only wires them to a surface.
 *
 * @module dsh-self-evolution-surface
 */

import { settingsFor, runtime, lazy, optionalIn } from 'dsh-self-evolution-core/lib/runtime.js'
import { evolveTool } from './lib/tools.js'
import { evolveCommand } from './lib/commands.js'
import { mountRoutes } from './lib/api.js'

/** Plugin name shown in the Loader inventory. */
export const name = 'self-evolution-surface'

/** Without a tool registry and a prompt registry there is no surface to attach to. */
export const inject = ['tools', 'systemPrompt']

/** System-prompt section identity. */
const SECTION_NAME = 'evolve:discipline'

/** Section order, placed with the tool-guidance block. */
const SECTION_ORDER = 3050

/**
 * The standing discipline, injected for as long as the row is loaded.
 *
 * Kept short on purpose. The flow itself lives in the `self-evolve` skill, which
 * the model loads only when the user asks for it; this section only has to make
 * the contract discoverable — that a collector exists, what it produces, and
 * that the flow is user-triggered.
 *
 * The portrait body is deliberately absent from this text and from the prompt:
 * it is read through the `memory` tool when a step wants it.
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
 * Wire the flow to a tool, a command family, a route and a prompt section.
 *
 * @param ctx - the plugin's context.
 * @param rowConfig - the plugin row's `config` from the composition.
 */
export function apply(ctx, rowConfig) {
  const settings = settingsFor(rowConfig)
  const evolve = lazy(() => runtime.evolve)

  /** The manual collection pass, or an account of why it is not available yet. */
  const collectCurrent = (...args) =>
    typeof runtime.collectCurrent === 'function'
      ? runtime.collectCurrent(...args)
      : Promise.resolve('采集不可用：采集器组件尚未加载')

  /** The manual memory round, or an account of why it is not available yet. */
  const memoryRoundNow = (...args) =>
    typeof runtime.memoryRoundNow === 'function'
      ? runtime.memoryRoundNow(...args)
      : Promise.resolve('记忆轮次不可用：记忆腿组件尚未加载')

  // The tool: the single model-facing entry point of the whole system.
  if (settings.registerTool) {
    ctx.effect(
      () => ctx.tools.register(evolveTool({ evolve, collectCurrent, memoryRoundNow })),
      'self-evolution: evolve tool',
    )
  }

  // The standing discipline. The portrait itself is not published here and not
  // published as runtime context: it is read through the `memory` tool, so what
  // the collector learned about the user is an answer a step asked for rather
  // than a premise every step starts from.
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: DISCIPLINE,
    interpolate: false,
  })

  if (settings.registerCommands) {
    optionalIn(ctx, ['commands'], '/evolve 命令（commands 服务）', (commandCtx) => {
      commandCtx.commands.register(evolveCommand({ evolve, collectCurrent, memoryRoundNow }))
    })
  }

  if (settings.registerRoutes) {
    optionalIn(ctx, ['connection'], '面板路由（connection 服务）', (routeCtx) => {
      mountRoutes({ routeCtx, evolve })
    })
  }
}
