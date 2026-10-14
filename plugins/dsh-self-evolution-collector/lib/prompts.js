/**
 * The collector's skill-drafting prompt.
 *
 * Ported verbatim from the original `core/collect.py`. It is the system's
 * contract with the drafting model: what counts as worth keeping, the exact
 * output format, and the escape hatches (`SKIP:` for "not worth it", a stated
 * repeat for "already covered"). It changes rarely, and every change is a
 * behaviour change, so it lives in a file of its own.
 *
 * The memory leg's two prompts live in `lib/memory-article.js` with the rest of
 * the article pipeline, where their format rules are checked mechanically.
 *
 * @module dsh-self-evolution/lib/prompts
 */

/** Title line of the skill-candidate prompt. */
const SKILL_ROLE = '你是「dsh-self-evolution 经验采集器」。根据下面这次任务的执行轨迹，判断是否值得沉淀为一个可复用的技能（SKILL.md）。'

/**
 * Build the skill-candidate prompt.
 *
 * @param options - the prompt inputs.
 * @param options.summary - the trace summary.
 * @param options.enabled - `{ name, desc }` of every enabled skill, for dedup.
 * @param options.previousRejection - this session's earlier verdict, if any.
 * @param options.maxSkillChars - the draft size ceiling.
 * @returns the prompt text.
 */
export function buildSkillPrompt({ summary, enabled, previousRejection, maxSkillChars }) {
  const rejectionHint = []
  if (previousRejection !== undefined && previousRejection !== null) {
    rejectionHint.push(
      `【本会话历史判定】此会话的较早内容已被判定为不值得沉淀（原因：${previousRejection.reason ?? ''}）。`,
      '仅当本次新增轨迹包含实质性的新可复用步骤/注意点时才生成候选；否则必须输出 SKIP:。',
    )
  }

  let skillsBlock = ''
  if (Array.isArray(enabled) && enabled.length > 0) {
    const lines = ['【已启用技能清单（查重参考）】以下技能已存在于系统中：']
    for (const skill of enabled) {
      lines.push(skill.desc ? `- ${skill.name}：${skill.desc}` : `- ${skill.name}`)
    }
    lines.push('若本次轨迹与其中任何一个语义重复（同类流程/同类场景/同类问题），必须输出 SKIP: 与已有技能 <name> 重复，禁止重复生成。')
    skillsBlock = lines.join('\n')
  }

  return [
    SKILL_ROLE,
    '',
    '值得沉淀的标准（至少满足一条）：',
    '1. 这类任务以后会重复出现（部署、排错、特定工具链、特定流程、多步骤操作）',
    '2. 轨迹里有明确的步骤、经验、注意点可以复用',
    '3. 不是一次性的琐碎问答或闲聊',
    '',
    skillsBlock,
    '',
    ...rejectionHint,
    '输出格式（严格遵守，不要输出其他内容）：',
    '- 如果值得沉淀：直接输出完整 SKILL.md 全文，不要用代码块包裹，不要加任何解释。',
    '- frontmatter 必须以此开头：第一行 --- ，第二行必须是 name: <小写字母数字连字符>（不带引号，冒号后直接跟值），第三行 description: <中文，≤1024字符，写明『何时使用』>，最后一行 --- 结束。',
    `- 正文用中文，包含适用场景、步骤流程、常见问题与修复方法；总长 ≤ ${maxSkillChars} 字符。`,
    '- 如果不值得沉淀：只输出一行，以 SKIP: 开头并说明原因。',
    '- 如果与已启用技能清单中的技能语义重复：必须输出 SKIP: 与已有技能 <name> 重复（严禁重复生成）。',
    '',
    '执行轨迹如下：',
    '---',
    summary,
    '---',
  ].join('\n')
}

