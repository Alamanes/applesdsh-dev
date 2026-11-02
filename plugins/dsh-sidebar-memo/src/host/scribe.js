// The two prompts the panel runs on its own: turning the user's notes into her
// diary page, and reading a goal against the days since she set it.
import { askOnce } from './model.js'
import { isDate } from './store.js'

const DIARY_SYSTEM = [
  '把用户口述的事写成她自己的日记：第一人称，把零散的口述组织成连贯的段落。',
  '她说的每件事、每个细节、她的语气都要留住；可以调整语序、合并重复、把口语改成书面语，但不添加她没说过的事实。',
  '不评论、不升华、不总结，不写标题和日期，不写任何说明。只输出正文，句子以长句为主，段落之间空行。',
].join('\n')

const REVIEW_SYSTEM = [
  '你负责复盘一个用户自己立下的目标。你读目标立下以来的日记，判断她是否在推进、推进了多少、卡在哪里。',
  '只用日记里的事实：引用具体的日期和事情，不猜，不编，不替她表功。',
  '指出已经做到的、没做到的、和剩余时间的差距，最后给一个很小的下一步。',
  '三段以内，三百字以内，中文。',
].join('\n')

const PLAN_SYSTEM = [
  '你负责替用户把一个目标拆成按日期排的每日安排，写进她的日历。',
  '一天一到三条，每条是那天能做完的具体动作：动词开头，写清做什么、做多少、做到什么程度。',
  '按她现在的进度往后排：不排今天以前的日子，不重复她已经排过的日子。',
  '只输出 JSON，形如 {"days":[{"date":"2026-11-03","items":["…","…"]}]}。不要代码围栏，不要解释，不要别的字段。',
].join('\n')

const VOICES = {
  sharp: [
    '语气：毒舌。刻薄、辛辣、不留情面，像个损友专挑敷衍、拖延和借口下手，用夸张的比喻把她的偷懒说出来。',
    '只针对行为和进度；不碰外貌、家人、人格价值，不说脏话。每一句都要能对回日记里的某一天。',
  ].join('\n'),
  gentle: [
    '语气：温柔。先接住她这段时间的辛苦，再轻轻指出偏差，不指责。',
    '结尾给一个今天就能做完的小动作，不说教，不喊口号。',
  ].join('\n'),
  plain: [
    '语气：机械。像一份运行报告，只陈述：完成项、未完成项、偏差。',
    '陈述句，不带情绪词，不评价人，不给鼓励。',
  ].join('\n'),
  custom: '',
}

const clip = (text, max) => (text.length > max ? text.slice(0, max) + '…' : text)

function goalBrief(goal) {
  const lines = ['目标：' + goal.text]
  if (goal.note !== '') lines.push('衡量：' + goal.note)
  lines.push('立下那天：' + goal.since)
  if (goal.logs.length > 0) {
    lines.push('进度记录（她自己记的）：')
    for (const log of goal.logs.slice(-12)) lines.push('- ' + log.at.slice(0, 10) + ' ' + log.text)
  }
  return lines.join('\n')
}

/**
 * Write one diary page from the notes the user left.
 * @param ctx - host plugin context.
 * @param params.date - the page date.
 * @param params.notes - what the user said.
 * @param params.current - the page as it stands, if any.
 * @param params.warn - logger.
 */
export async function composeDiary(ctx, { date, notes, current, warn }) {
  const parts = ['日期：' + date]
  if (current.trim() !== '') parts.push('已有的一页，把新素材并进去、保留原有事实：\n' + clip(current.trim(), 8_000))
  parts.push('她说的：\n' + clip(notes.trim(), 12_000))
  const text = parts.join('\n\n')
  return askOnce(ctx, { system: DIARY_SYSTEM, text, warn })
}

/**
 * Critique one goal against the diary.
 * @param ctx - host plugin context.
 * @param params.goal - the goal.
 * @param params.pages - diary pages since the goal was set.
 * @param params.mood - sharp | gentle | plain | custom.
 * @param params.custom - the user's own voice note.
 * @param params.warn - logger.
 */
export async function composeReview(ctx, { goal, pages, mood, custom, warn }) {
  const voice = mood === 'custom'
    ? custom.trim() === ''
      ? '语气：用你自己的判断，直接、具体。'
      : '语气：照用户下面这段要求来写：\n' + clip(custom.trim(), 1_200)
    : VOICES[mood] ?? VOICES.gentle
  const diary = pages.length === 0
    ? '这期间还没有日记。'
    : pages.map(page => '## ' + page.date + '\n' + clip(page.text, 6_000)).join('\n\n')
  const text = [
    goalBrief(goal),
    '目标立下以来（' + goal.since + ' 到今天）的日记：',
    diary,
    voice,
  ].join('\n\n')
  return askOnce(ctx, { system: REVIEW_SYSTEM, text, warn })
}

/** Compact view of the days already scheduled, newest last. */
function planBrief(plan) {
  const days = plan.days.slice(-21)
  if (days.length === 0) return ''
  return days.map(day => day.date + '：' + day.items.map(item => (item.done ? '[x] ' : '') + item.text).join('；')).join('\n')
}

/** Read the model's JSON back into dated items, dropping what cannot be used. */
function parsePlanDays(raw, date) {
  const text = String(raw ?? '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有排出可用的计划')
  let parsed = null
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch (error) {
    throw new Error('模型排的计划不是 JSON')
  }
  const days = []
  for (const day of Array.isArray(parsed?.days) ? parsed.days : []) {
    const key = String(day?.date ?? '').trim()
    if (!isDate(key) || key < date) continue
    const items = (Array.isArray(day?.items) ? day.items : [])
      .map(item => String(typeof item === 'string' ? item : item?.text ?? '').trim())
      .filter(item => item !== '')
    if (items.length > 0) days.push({ date: key, items })
  }
  if (days.length === 0) throw new Error('模型排的日期都用不了')
  return days
}

/**
 * Lay a goal out on the calendar: the next stretch of days, one list each.
 * @param ctx - host plugin context.
 * @param params.goal - the goal.
 * @param params.pages - recent diary pages.
 * @param params.plan - the plan as it stands, may be null.
 * @param params.date - today, YYYY-MM-DD.
 * @param params.warn - logger.
 */
export async function composePlan(ctx, { goal, pages, plan, date, warn }) {
  const diary = pages.length === 0
    ? '这段时间还没有日记。'
    : pages.map(page => '## ' + page.date + '\n' + clip(page.text, 4_000)).join('\n\n')
  const text = [
    goalBrief(goal),
    '今天是：' + date,
    plan === null || plan.days.length === 0 ? '还没有排过计划。' : '已经排好的日子：\n' + planBrief(plan),
    '她最近的日记：',
    diary,
  ].join('\n\n')
  const raw = await askOnce(ctx, { system: PLAN_SYSTEM, text, warn })
  return parsePlanDays(raw, date)
}

/** The labels the panel and the prompt section use. */
export const MOOD_LABELS = {
  sharp: '毒舌',
  gentle: '温柔',
  plain: '机械',
  custom: '自定义',
}
