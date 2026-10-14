/**
 * The user-facing slash-command family.
 *
 * Commands run directly against the agent and never become a prompt, which
 * makes them the right surface for "show me the state" and "collect now": they
 * cost no model tokens and cannot be misread as instructions.
 *
 * The command set is deliberately small. It exposes what a human wants at a
 * glance plus the two acts a human owns — collecting on demand and reading the
 * trail — while leaving every decision to the flow.
 *
 * @module dsh-self-evolution-surface/lib/commands
 */

/** Command name, kept lowercase per the command grammar. */
export const COMMAND = 'evolve'

/**
 * Build the command definition.
 *
 * @param options - the wiring inputs.
 * @param options.evolve - the flow facade.
 * @param options.collectCurrent - runs one forced collection pass for an agent.
 * @param options.memoryRoundNow - runs one forced memory round for an agent.
 * @returns the command definition for `ctx.commands.register()`.
 */
export function evolveCommand({ evolve, collectCurrent, memoryRoundNow }) {
  return {
    name: COMMAND,
    description: 'Self evolution: status / brief / health / candidates / collect / dream / models / trail <keyword>',
    input: { hint: '[status|brief|health|candidates|collect|dream|models|trail <keyword>]' },
    handler: async ({ agent, rawInput }) => {
      const input = typeof rawInput === 'string' ? rawInput.trim() : ''
      const [sub, ...rest] = input.split(/\s+/).filter((part) => part.length > 0)
      try {
        switch (sub ?? 'status') {
          case 'status': {
            const info = evolve.status()
            return ok(
              [
                `Self Evolution @ ${info.root}`,
                `候选 ${info.candidates} / 收件箱 ${info.inbox} / 画像文章 ${info.articleChars} 字符 / 启用技能 ${info.skills} / 归档 ${info.archived}`,
                info.drafts === 0 ? '待审草稿: 无' : `待审草稿: ${info.draftId}（${info.draftChars} 字符，待用户决定采用或丢弃）`,
                `上次采集 ${info.lastCollectionAt ?? '无'} | 上次 Dream ${info.lastDreamAt ?? '无'} | 上次进化 ${info.lastEvolutionAt ?? '无'}`,
                info.articleChars === 0
                  ? '画像面: 不常驻注入，且暂无已确认的文章'
                  : `画像面: 不常驻注入，模型用 memory 工具按需读取（读取时 ${info.modelViewChars} 字符）`,
                info.collectorUnavailable ? `!! 采集后端不可用：${info.collectorUnavailableReason ?? '原因未记录'}` : '采集后端正常',
                '用法：/evolve brief | health | candidates | collect | dream | models | trail <关键词>',
              ].join('\n'),
            )
          }
          case 'brief':
            return ok(await evolve.brief())
          case 'health':
            return ok(evolve.health({ all: rest.includes('--all') }))
          case 'candidates': {
            const overview = evolve.overview()
            if (overview.candidates.length === 0) return ok('候选区为空。')
            return ok(
              [
                `候选 ${overview.candidates.length} 个：`,
                ...overview.candidates.map((entry) => `- ${entry.slug}（${entry.size} 字节）`),
                '审查请让助手加载 self-evolve 技能并执行进化流程。',
              ].join('\n'),
            )
          }
          case 'collect': {
            if (typeof collectCurrent !== 'function' || agent === undefined) return fail('采集不可用：需要当前会话上下文。')
            const note = await collectCurrent(agent, { force: true })
            return ok(note)
          }
          case 'dream': {
            if (typeof memoryRoundNow !== 'function' || agent === undefined) return fail('记忆轮次不可用：需要当前会话上下文。')
            return ok(await memoryRoundNow(agent, { force: true }))
          }
          case 'models':
            return ok(await evolve.models({ agent }))
          case 'trail': {
            const keyword = rest.join(' ')
            if (keyword.length === 0) return fail('用法：/evolve trail <关键词>')
            return ok(evolve.trail({ keyword, session: agent?.session }))
          }
          default:
            return fail(`未知子命令 ${sub}（可用：status / brief / health / candidates / collect / dream / models / trail）`)
        }
      } catch (error) {
        return fail(`evolve 执行失败：${String(error?.message ?? error).slice(0, 200)}`)
      }
    },
  }
}

/** A successful command result. */
function ok(text) {
  return { kind: 'success', text }
}

/** A failed command result. */
function fail(text) {
  return { kind: 'error', text }
}
