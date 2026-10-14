/**
 * The model-facing surface: one tool, many actions.
 *
 * One tool rather than a dozen is a deliberate cost decision. Every registered
 * tool schema is paid for on every request in every session, while this system
 * is used a few times a day at most; a single `evolve` tool with an action
 * field keeps the standing cost to one schema and still exposes the whole flow.
 *
 * The tool is also where the flow's guardrails become real. Enabling, merging,
 * rejecting, archiving and finishing are ordinary function calls with
 * deterministic bodies, so the model cannot half-execute them, and nothing is
 * deleted without a recorded verdict.
 *
 * @module dsh-self-evolution/lib/tools
 */

import { renderDoctor } from './doctor.js'

/** Actions the tool accepts, with the fields each one needs. */
export const ACTIONS = [
  'status',
  'brief',
  'preflight',
  'enable',
  'merge',
  'reject',
  'archive',
  'restore',
  'health',
  'usage',
  'dream',
  'promote',
  'discard',
  'models',
  'trail',
  'collect',
  'doctor',
  'finish',
]

/** The one tool's description, written for the model. */
const DESCRIPTION = [
  '自我进化系统的唯一入口。它管理「经验 → 技能 → 进化」闭环：后台采集器已经替你把值得复用的经验草拟成候选，这个工具负责审查、启用、归档、体检与收尾。',
  'action="brief"：进化流程的第一步与唯一探测，一次拿到状态、候选、画像草稿、技能记分卡、超长清单与「本轮走向」，并给出按需读取的细则文件路径。',
  'action="preflight"：候选的机械预检（格式、大小、截断、同名与相似度），零 token，不替代人工判断。',
  'action="enable"：把候选提升为启用技能（立即对模型可见）；action="merge" 记录并入现有技能；action="reject" 记录淘汰。三者都必须带 slug，并把处置写入经验日志。',
  'action="archive"/"restore"：把启用技能移出或移回启用区，源文件始终保留。',
  'action="health"：技能记分卡（新鲜度/使用度/可靠性三维打分与三线分级）；action="usage" 查单个技能的成功失败计数与失败原因。',
  'action="dream"：立刻跑一次记忆轮次（跳过闲置闸门）：提取当前会话的持久信息进 memory/inbox/，到期则 Dream 把收件箱合并成一份待审画像草稿。',
  'action="promote"/"discard"：处置待审的画像草稿。promote 让草稿成为 memory/PROFILE.md 并归档它消费的提取；discard 什么都不改，提取留给下一次 Dream。两者都必须先让用户看过 review.md 并作出决定。',
  'action="models"：查看采集模型链的解析结果、来源与丢弃项（绕指纹缓存）。',
  'action="trail"：按关键词定点回查当前会话轨迹（限长），用于复核技能失败的启发式归因，禁止整读轨迹。',
  'action="collect"：立刻对当前会话跑一次技能腿采集（跳过阈值节流），用于手动触发。',
  'action="doctor"：完整性检查（数据根可写、记忆文件在位、启用技能是否都能被解析、采集后端是否可达）。收尾前会自动跑一次，硬性问题会中止收尾。',
  'action="finish"：收尾一条命令，刷新计数、写经验日志、按需归档日志、并在数据根是 git 仓库时提交。',
  '绝不自行删除技能；归档与淘汰都必须先征求用户决定。',
].join('\n')

/**
 * Build the tool definition.
 *
 * @param options - the wiring inputs.
 * @param options.evolve - the flow facade.
 * @param options.collectCurrent - runs one forced collection pass for an agent.
 * @param options.memoryRoundNow - runs one forced memory round for an agent.
 * @returns the tool definition for `ctx.tools.register()`.
 */
export function evolveTool({ evolve, collectCurrent, memoryRoundNow }) {
  return {
    name: 'evolve',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ACTIONS,
          description: '要执行的动作。默认 status（只读概览）。',
        },
        slug: { type: 'string', description: '候选目录名，用于 preflight / enable / merge / reject。' },
        name: { type: 'string', description: 'enable 时指定启用后的技能名（缺省用 slug）；usage/archive/restore 时指定技能名。' },
        target: { type: 'string', description: 'merge 时指定并入的目标技能名。' },
        reason: { type: 'string', description: 'merge / reject 的处置原因，会写入候选 meta 与经验日志。' },
        keyword: { type: 'string', description: 'trail 的关键词，用于定位轨迹片段。' },
        max: { type: 'number', description: 'trail 最多返回的记录条数（默认 30）。' },
        chars: { type: 'number', description: 'trail 输出字符上限（默认 4000）。' },
        all: { type: 'boolean', description: 'health 是否显示全量（含健康技能），默认只显示非健康项。' },
        summary: { type: 'string', description: 'finish 的一行摘要，写入经验日志。' },
        updated: { type: 'number', description: 'finish 时本轮更新的技能数。' },
        repaired: { type: 'number', description: 'finish 时本轮修复的问题技能数。' },
        rejected: { type: 'number', description: 'finish 时本轮淘汰的候选数。' },
        merged: { type: 'number', description: 'finish 时本轮并入的候选数。' },
        commit: { type: 'boolean', description: 'finish 是否在数据根是 git 仓库时提交，默认 true。' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
    },
    // Several actions mutate shared files under one data root.
    isConcurrencySafe: () => false,
    presentCall: (args) => ({
      card: 'generic',
      title: `evolve · ${args?.action ?? 'status'}`,
      kind: args?.action === undefined || args?.action === 'status' || args?.action === 'brief' || args?.action === 'health' || args?.action === 'usage' || args?.action === 'models' || args?.action === 'trail'
        ? 'read'
        : 'other',
      rawInput: args,
    }),
    async execute(args, exec) {
      return await dispatch(args ?? {}, exec)
    },
  }

  /** Route one action to the flow facade. */
  async function dispatch(args, exec) {
    const action = typeof args.action === 'string' && args.action.length > 0 ? args.action : 'status'
    switch (action) {
      case 'status': {
        const info = evolve.status()
        return [
          `数据根: ${info.root}`,
          `候选 ${info.candidates} / 收件箱 ${info.inbox} / 画像文章 ${info.articleChars} 字符 / 启用技能 ${info.skills} / 归档 ${info.archived}`,
          info.drafts === 0
            ? '待审草稿: 无'
            : `待审草稿: ${info.drafts} 份（最新 ${info.draftId}，${info.draftChars} 字符，待用户决定 promote/discard）`,
          info.articleChars === 0
            ? '画像面: 不常驻注入，且暂无已确认的文章'
            : `画像面: 不常驻注入，模型用 memory 工具按需读取（读取时 ${info.modelViewChars} 字符）`,
          `上次采集: ${info.lastCollectionAt ?? '无'} | 上次 Dream: ${info.lastDreamAt ?? '无'} | 上次进化: ${info.lastEvolutionAt ?? '无'}`,
          info.collectorUnavailable ? `!! 采集后端不可用: ${info.collectorUnavailableReason ?? '原因未记录'}` : '采集后端: 正常',
        ].join('\n')
      }
      case 'brief':
        return await evolve.brief({ agent: exec.agent })
      case 'preflight':
        return evolve.preflightAll(args.slug === undefined ? [] : [args.slug])
      case 'enable': {
        if (typeof args.slug !== 'string') return '❌ enable 需要 slug'
        return await evolve.enable({ slug: args.slug, name: args.name })
      }
      case 'merge': {
        if (typeof args.slug !== 'string') return '❌ merge 需要 slug'
        return await evolve.merge({ slug: args.slug, target: args.target })
      }
      case 'reject': {
        if (typeof args.slug !== 'string') return '❌ reject 需要 slug'
        return await evolve.reject({ slug: args.slug, reason: args.reason })
      }
      case 'archive': {
        if (typeof args.name !== 'string') return '❌ archive 需要 name'
        return await evolve.archive({ name: args.name })
      }
      case 'restore': {
        if (typeof args.name !== 'string') return '❌ restore 需要 name'
        return await evolve.restore({ name: args.name })
      }
      case 'health':
        return evolve.health({ all: args.all === true })
      case 'doctor':
        return renderDoctor(await evolve.doctor({ agent: exec.agent }))
      case 'usage': {
        const name = typeof args.name === 'string' ? args.name : args.slug
        if (typeof name !== 'string') return '❌ usage 需要 name'
        return evolve.usageDetail({ name })
      }
      case 'dream': {
        if (typeof memoryRoundNow === 'function' && exec.agent !== undefined) return await memoryRoundNow(exec.agent, { force: true })
        return await evolve.dream({ force: true, agent: exec.agent })
      }
      case 'promote':
        return await evolve.promoteMemory()
      case 'discard':
        return await evolve.discardMemory({ reason: args.reason })
      case 'models':
        return await evolve.models({ agent: exec.agent })
      case 'trail':
        return evolve.trail({ keyword: args.keyword, max: args.max, chars: args.chars, session: exec.agent?.session })
      case 'collect': {
        if (typeof collectCurrent !== 'function') return '❌ 采集不可用'
        const agent = exec.agent
        if (agent === undefined) return '❌ collect 需要当前会话'
        return await collectCurrent(agent, { force: true })
      }
      case 'finish':
        return await evolve.finish({
          summary: args.summary,
          updated: args.updated,
          repaired: args.repaired,
          rejected: args.rejected,
          merged: args.merged,
          commit: args.commit !== false,
          agent: exec.agent,
        })
      default:
        return `❌ 未知动作 ${action}（可用：${ACTIONS.join(' / ')}）`
    }
  }
}
