// The two tools the model uses on the memo panel. Both schemas stay small on
// purpose: every property is characters of context in every single turn.
//
// A todo is a title plus a note plus steps. A goal is the user's own target and
// sits on the same tool as a nested object, so the model reaches it without a
// third tool — and the description says plainly that it is not the session Goal
// tool, which tracks the model's own long-running work.
import { isDate, today } from './store.js'

const READ_PAGES = 3
const PAGE_CHARS = 1600
const NOTE_LINES = 6
const NOTE_CHARS = 420

function notePreview(note) {
  const lines = String(note ?? '').split('\n').filter(line => line.trim() !== '')
  const shown = lines.slice(0, NOTE_LINES).map(line => '     ' + line).join('\n')
  return lines.length > NOTE_LINES ? shown + '\n     …还有 ' + (lines.length - NOTE_LINES) + ' 行' : shown
}

function itemLines(item) {
  const head = '- ' + item.text + '  (' + item.id + ')'
  const out = [head]
  const note = String(item.note ?? '').trim()
  if (note !== '') {
    const trimmed = note.length > NOTE_CHARS ? note.slice(0, NOTE_CHARS) + '…' : note
    out.push('  备注：\n' + notePreview(trimmed))
  }
  if (item.steps.length > 0) {
    const doneCount = item.steps.filter(step => step.done).length
    out.push('  步骤（' + doneCount + '/' + item.steps.length + '）：')
    for (const step of item.steps) out.push('    ' + (step.done ? '[x]' : '[ ]') + ' ' + step.text)
  }
  return out.join('\n')
}

function describe(item) {
  const bits = []
  if (String(item.note ?? '').trim() !== '') bits.push('备注 ' + String(item.note).split('\n').filter(line => line.trim() !== '').length + ' 行')
  if (item.steps.length > 0) bits.push(item.steps.length + ' 个步骤')
  return bits.length === 0 ? '' : '（' + bits.join('，') + '）'
}

function goalLines(goal) {
  const head = '- ' + (goal.done ? '[x] ' : '[ ] ') + goal.text + '  (' + goal.id + ')'
  const bits = []
  if (goal.note !== '') bits.push(goal.note.length > 40 ? goal.note.slice(0, 40) + '…' : goal.note)
  if (goal.logs.length > 0) bits.push(goal.logs.length + ' 条进展')
  if (goal.review !== null) bits.push('最近点评 ' + goal.review.at.slice(0, 10))
  return bits.length === 0 ? head : head + '\n  ' + bits.join(' · ')
}

function goalPatch(args) {
  const patch = {}
  if (args?.text !== undefined) patch.text = args.text
  if (args?.note !== undefined) patch.note = args.note
  return patch
}

/**
 * Build the tool definitions around one store.
 * @param params.store - the memo store.
 */
export function createTools({ store }) {
  const memo = {
    name: 'memo',
    description: 'Read or change the sidebar memo panel: the todo list, and the goals the user set for herself. A todo is a one-line title plus an optional note and optional steps. op=read lists both with ids; add/edit/done/del/clear work on todos. Pass goal to work on a goal instead — that is her own target, not the session Goal tool.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        op: { type: 'string', enum: ['read', 'add', 'edit', 'done', 'del', 'clear'], description: 'What to do with the todo list.' },
        text: { type: 'string', description: 'The one-line title, for op=add, or the new title for op=edit.' },
        note: { type: 'string', description: 'Detail, for op=add or op=edit: one fact per line. Put the long material here, not in the title.' },
        steps: { type: 'array', items: { type: 'string' }, description: 'Checklist items, for op=add or op=edit.' },
        id: { type: 'string', description: 'The item id from op=read, for done, del, or edit.' },
        goal: {
          type: 'object',
          additionalProperties: false,
          required: ['op'],
          description: 'A goal the user set. Not the session Goal tool: that tracks your own long-running work, this records hers.',
          properties: {
            op: { type: 'string', enum: ['set', 'log', 'review', 'done', 'drop'], description: 'set opens or edits one; log adds a progress line; review stores your critique; done closes it; drop deletes it.' },
            id: { type: 'string', description: 'Goal id from op=read; omit for the newest open goal.' },
            text: { type: 'string', description: 'The goal sentence, for set.' },
            note: { type: 'string', description: 'How it is measured, for set.' },
            log: { type: 'string', description: 'One progress line, for log.' },
            review: { type: 'string', description: 'The critique text, for review.' },
          },
        },
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) {
      const goalArg = args?.goal
      if (goalArg !== undefined && goalArg !== null && typeof goalArg === 'object') {
        return runGoal(goalArg)
      }
      const op = String(args?.op ?? '').trim()
      store.beginActivity('memo', op)
      try {
        if (op === 'read') {
          const snapshot = await store.state()
          store.endActivity('memo', 'read')
          const items = snapshot.todos
          const open = items.filter(item => !item.done).length
          const goals = snapshot.goals
          const openGoals = goals.filter(goal => !goal.done)
          const todoText = items.length === 0
            ? '待办清单是空的。'
            : '待办（' + items.length + ' 项，' + open + ' 项未完成）：\n' + items
              .map(item => '- ' + (item.done ? '[x] ' : '[ ] ') + itemLines(item).slice(2))
              .join('\n')
          const goalText = goals.length === 0
            ? '还没有目标。'
            : '目标（' + openGoals.length + ' 个未完成，共 ' + goals.length + ' 个）：\n' + goals.slice(0, 8).map(goalLines).join('\n')
          return todoText + '\n\n' + goalText
        }
        if (op === 'add') {
          const item = await store.addTodo({ text: args?.text, note: args?.note, steps: args?.steps, by: 'model' })
          store.endActivity('memo', 'add', { ids: [item.id] })
          return '加进待办：' + item.text + '  (' + item.id + ')' + describe(item)
        }
        if (op === 'edit') {
          const id = String(args?.id ?? '').trim()
          if (id === '') throw new Error('op=edit 需要 id')
          const items = (await store.state()).todos
          const target = items.find(item => item.id === id || item.text === id)
          if (target === undefined) throw new Error('没有这条待办：' + id)
          const patch = {}
          if (args?.text !== undefined) patch.text = args.text
          if (args?.note !== undefined) patch.note = args.note
          if (args?.steps !== undefined) patch.steps = args.steps
          if (Object.keys(patch).length === 0) throw new Error('op=edit 至少要给出 text、note、steps 其中一项')
          const item = await store.updateTodo(target.id, patch, 'model')
          store.endActivity('memo', 'edit', { ids: [item.id] })
          return '改好了：' + item.text + '  (' + item.id + ')' + describe(item)
        }
        if (op === 'done') {
          const item = await store.setTodoDone(String(args?.id ?? ''), true)
          store.endActivity('memo', 'done', { ids: [item.id] })
          return '已完成：' + item.text
        }
        if (op === 'del') {
          const id = String(args?.id ?? '')
          const items = (await store.state()).todos
          const target = items.find(item => item.id === id || item.text === id)
          if (target === undefined) throw new Error('没有这条待办：' + id)
          await store.removeTodo(target.id)
          store.endActivity('memo', 'del', { ids: [target.id] })
          return '删掉：' + target.text
        }
        if (op === 'clear') {
          const removed = await store.clearDone()
          store.endActivity('memo', 'clear')
          return '清掉了 ' + removed + ' 条已完成的待办。'
        }
        throw new Error('op 只能是 read、add、edit、done、del、clear')
      } catch (error) {
        store.endActivity('memo', 'error')
        throw error
      }

      /** The nested goal branch: its own activity trail and replies. */
      async function runGoal(goal) {
        const op = String(goal?.op ?? '').trim()
        store.beginActivity('memo', 'goal-' + op)
        try {
          if (op === 'set') {
            const item = await store.saveGoal({ id: goal.id, ...goalPatch(goal) })
            store.endActivity('memo', 'goal-set', { ids: [item.id] })
            return '目标记下了：' + item.text + '  (' + item.id + ')'
          }
          if (op === 'log') {
            const item = await store.logGoal(goal.id, goal.log)
            store.endActivity('memo', 'goal-log', { ids: [item.id] })
            return '记进目标进度：' + item.text + '（现在 ' + item.logs.length + ' 条）'
          }
          if (op === 'review') {
            const item = await store.reviewGoal(goal.id, { text: goal.review, mode: (await store.state()).mood })
            store.endActivity('memo', 'goal-review', { ids: [item.id] })
            return '点评写进目标了：' + item.text
          }
          if (op === 'done') {
            const item = await store.setGoalDone(goal.id, true)
            store.endActivity('memo', 'goal-done', { ids: [item.id] })
            return '目标完成：' + item.text
          }
          if (op === 'drop') {
            const item = await store.removeGoal(goal.id)
            store.endActivity('memo', 'goal-drop', { ids: [item.id] })
            return '目标删掉了：' + item.text
          }
          throw new Error('goal.op 只能是 set、log、review、done、drop')
        } catch (error) {
          store.endActivity('memo', 'goal-error')
          throw error
        }
      }
    },
  }

  const diary = {
    name: 'diary',
    description: 'Read or write the user\'s diary, one Markdown page per day. She tells you what she did and you write the page in her first person, keeping every fact and inventing nothing. op=read returns a page (with her notes for the day), the newest pages, or the from/to range; op=write appends to a day, or replaces it with mode=replace.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['op'],
      properties: {
        op: { type: 'string', enum: ['read', 'write'], description: 'What to do.' },
        date: { type: 'string', description: 'YYYY-MM-DD. Omit for today, or for the newest pages on read.' },
        from: { type: 'string', description: 'First day of a read range, YYYY-MM-DD.' },
        to: { type: 'string', description: 'Last day of a read range, YYYY-MM-DD.' },
        text: { type: 'string', description: 'Markdown to append or replace, for op=write.' },
        mode: { type: 'string', enum: ['append', 'replace'], description: 'Default append.' },
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) {
      const op = String(args?.op ?? '').trim()
      store.beginActivity('diary', op)
      try {
        if (op === 'read') {
          const from = String(args?.from ?? '').trim()
          const to = String(args?.to ?? '').trim()
          if (from !== '' || to !== '') {
            if (!isDate(from) || !isDate(to)) throw new Error('范围要写成 YYYY-MM-DD')
            const pages = await store.diaryBetween(from, to, PAGE_CHARS * 8)
            store.endActivity('diary', 'read')
            if (pages.length === 0) return from + ' 到 ' + to + ' 之间还没有日记。'
            return pages.map(page => '## ' + page.date + '\n\n' + page.text).join('\n\n')
          }
          const wanted = String(args?.date ?? '').trim()
          if (wanted !== '') {
            if (!isDate(wanted)) throw new Error('日期要写成 YYYY-MM-DD')
            const text = await store.readDiary(wanted)
            const notes = await store.readRaw(wanted)
            store.endActivity('diary', 'read', { date: wanted })
            if (text.trim() === '' && notes.trim() === '') return wanted + ' 的日记还是空的。'
            const parts = [wanted + ' 的日记：']
            parts.push(text.trim() === '' ? '（还没写）' : text.trim().slice(0, PAGE_CHARS))
            if (notes.trim() !== '') parts.push('她这一天的口述，供你整理：\n' + notes.trim().slice(0, PAGE_CHARS))
            return parts.join('\n\n')
          }
          const dates = await store.diaryDates()
          store.endActivity('diary', 'read')
          if (dates.length === 0) return '日记本还是空的。'
          const parts = []
          for (const date of dates.slice(0, READ_PAGES)) {
            const text = (await store.readDiary(date)).trim()
            if (text !== '') parts.push('## ' + date + '\n\n' + text.slice(0, PAGE_CHARS))
          }
          return parts.length === 0 ? '日记本还是空的。' : parts.join('\n\n')
        }
        if (op === 'write') {
          const date = String(args?.date ?? '').trim() === '' ? today() : String(args.date).trim()
          if (!isDate(date)) throw new Error('日期要写成 YYYY-MM-DD')
          const mode = args?.mode === 'replace' ? 'replace' : 'append'
          const body = await store.writeDiary(date, args?.text, mode)
          store.endActivity('diary', mode === 'replace' ? 'rewrite' : 'write', { date })
          return '写进 ' + date + ' 的日记了，这一页现在 ' + body.length + ' 字。'
        }
        throw new Error('op 只能是 read 或 write')
      } catch (error) {
        store.endActivity('diary', 'error')
        throw error
      }
    },
  }

  return [memo, diary]
}
