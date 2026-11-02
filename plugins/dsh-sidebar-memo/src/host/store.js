// dsh-sidebar-memo — the store behind the panel.
//
// Three files and two directories: todos.json (the list), goals.json (goals plus
// the critique voice), settings.json (voice, custom note), diary/YYYY-MM-DD.md
// (what the AI wrote) and raw/YYYY-MM-DD.md (what the user said).
//
// A todo is a title, a free-form note and a short list of steps. A goal is a
// sentence the user set for herself, with a deadline, a measure, a log and the
// last critique. A diary page is written by the model from the raw notes; when
// the notes are newer than the page, the panel marks the day as waiting.
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const TITLE_MAX = 200
const NOTE_MAX = 8_000
const STEP_MAX = 30
const STEP_TEXT_MAX = 200
const DIARY_TEXT_MAX = 200_000
const RAW_TEXT_MAX = 20_000

const GOAL_TEXT_MAX = 300
const GOAL_NOTE_MAX = 2_000
const GOAL_LOG_MAX = 500
const GOAL_LOGS_MAX = 60
const GOAL_REVIEW_MAX = 4_000
const GOALS_MAX = 20

const PLAN_ITEM_MAX = 200
const PLAN_ITEMS_PER_DAY = 12
const PLAN_ITEMS_MAX = 400

/** The four voices a critique can be written in. */
export const MOODS = ['sharp', 'gentle', 'plain', 'custom']

export function today() {
  return new Date().toLocaleDateString('en-CA')
}

export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00')
  return !Number.isNaN(date.getTime()) && date.toLocaleDateString('en-CA') === value
}

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
}

function clip(text, limit) {
  const value = String(text ?? '').replace(/\r\n?/g, '\n').trim()
  return value.length > limit ? value.slice(0, limit) : value
}

function moodOf(value) {
  return MOODS.includes(value) ? value : 'gentle'
}

function normalizeSteps(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, STEP_MAX).map((step) => {
    if (typeof step === 'string') return { text: clip(step, STEP_TEXT_MAX), done: false }
    return { text: clip(step?.text, STEP_TEXT_MAX), done: step?.done === true }
  }).filter(step => step.text !== '')
}

/** Lift one stored item into title + note + steps. */
function normalizeTodo(item) {
  const raw = typeof item?.text === 'string' ? item.text.replace(/\r\n?/g, '\n') : ''
  const lines = raw.split('\n')
  const title = clip(lines[0], TITLE_MAX)
  const tail = clip(lines.slice(1).join('\n'), NOTE_MAX)
  const note = typeof item?.note === 'string' && item.note.trim() !== '' ? clip(item.note, NOTE_MAX) : tail
  return {
    id: typeof item?.id === 'string' && item.id !== '' ? item.id : newId('t'),
    text: title,
    note,
    steps: normalizeSteps(item?.steps),
    done: item?.done === true,
    at: typeof item?.at === 'string' ? item.at : new Date().toISOString(),
    by: item?.by === 'model' ? 'model' : 'user',
  }
}

/** Lift one stored goal into its full shape. */
function normalizeGoal(item) {
  const logs = Array.isArray(item?.logs)
    ? item.logs.map((log) => ({
        at: typeof log?.at === 'string' ? log.at : new Date().toISOString(),
        text: clip(log?.text, GOAL_LOG_MAX),
      })).filter(log => log.text !== '').slice(-GOAL_LOGS_MAX)
    : []
  const review = item?.review !== null && typeof item?.review === 'object'
    ? {
        at: typeof item.review.at === 'string' ? item.review.at : new Date().toISOString(),
        mode: moodOf(item.review.mode),
        text: clip(item.review.text, GOAL_REVIEW_MAX),
      }
    : null
  return {
    id: typeof item?.id === 'string' && item.id !== '' ? item.id : newId('g'),
    text: clip(item?.text, GOAL_TEXT_MAX),
    note: clip(item?.note, GOAL_NOTE_MAX),
    since: isDate(item?.since) ? item.since : today(),
    done: item?.done === true,
    doneAt: typeof item?.doneAt === 'string' ? item.doneAt : '',
    createdAt: typeof item?.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
    logs,
    review: review !== null && review.text !== '' ? review : null,
  }
}

/** One scheduled item: a short action on one day. */
function normalizePlanItem(item) {
  if (typeof item === 'string') return { id: newId('p'), text: clip(item, PLAN_ITEM_MAX), done: false }
  return {
    id: typeof item?.id === 'string' && item.id !== '' ? item.id : newId('p'),
    text: clip(item?.text, PLAN_ITEM_MAX),
    done: item?.done === true,
  }
}

/** Lift stored days into date-ordered, de-duplicated days. */
function normalizePlan(item) {
  const byDate = new Map()
  for (const day of Array.isArray(item?.days) ? item.days : []) {
    if (!isDate(day?.date)) continue
    const list = byDate.get(day.date) ?? []
    for (const raw of Array.isArray(day.items) ? day.items : []) {
      const entry = normalizePlanItem(raw)
      if (entry.text !== '') list.push(entry)
    }
    byDate.set(day.date, list.slice(0, PLAN_ITEMS_PER_DAY))
  }
  const days = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, items]) => ({ date, items }))
    .filter(day => day.items.length > 0)
  return {
    goalId: typeof item?.goalId === 'string' ? item.goalId : '',
    at: typeof item?.at === 'string' ? item.at : new Date().toISOString(),
    days,
  }
}

async function writeAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true })
  const temp = path + '.' + process.pid + '.tmp'
  await writeFile(temp, text, 'utf8')
  await rename(temp, path)
}

async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function fileTime(path) {
  try {
    return (await stat(path)).mtimeMs
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
}

export function createStore({ root, warn = () => {} }) {
  const todoFile = join(root, 'todos.json')
  const goalFile = join(root, 'goals.json')
  const planFile = join(root, 'plan.json')
  const settingsFile = join(root, 'settings.json')
  const diaryDir = join(root, 'diary')
  const rawDir = join(root, 'raw')

  let activity = { seq: 0, tool: '', op: '', ids: [], date: '', phase: 'idle', at: 0 }
  let todos = null
  let goals = null
  let plans = null
  let settings = null
  let queue = Promise.resolve()

  /** Writes run one after another: two requests never race on one file. */
  function serialize(task) {
    const next = queue.then(task, task)
    queue = next.then(() => {}, () => {})
    return next
  }

  async function loadTodos() {
    if (todos !== null) return todos
    const text = await readText(todoFile)
    let parsed = null
    if (text !== null) {
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        warn('dsh-sidebar-memo: todos.json is not JSON, starting empty')
      }
    }
    const items = Array.isArray(parsed?.items) ? parsed.items : []
    todos = items
      .filter(item => item !== null && typeof item === 'object')
      .map(normalizeTodo)
      .filter(item => item.text !== '')
    return todos
  }

  async function saveTodos(next) {
    todos = next
    const items = next.map((item) => ({
      id: item.id,
      text: item.text,
      note: item.note,
      steps: item.steps,
      done: item.done,
      at: item.at,
      by: item.by,
    }))
    await writeAtomic(todoFile, JSON.stringify({ version: 2, items }, null, 2) + '\n')
    return next
  }

  async function loadGoals() {
    if (goals !== null) return goals
    const text = await readText(goalFile)
    let parsed = null
    if (text !== null) {
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        warn('dsh-sidebar-memo: goals.json is not JSON, starting empty')
      }
    }
    const items = Array.isArray(parsed?.goals) ? parsed.goals : []
    goals = {
      items: items
        .filter(item => item !== null && typeof item === 'object')
        .map(normalizeGoal)
        .filter(item => item.text !== '')
        .slice(-GOALS_MAX),
      mood: moodOf(parsed?.mood),
      custom: clip(parsed?.custom, GOAL_NOTE_MAX),
    }
    return goals
  }

  async function saveGoals() {
    const file = goals ?? { items: [], mood: 'gentle', custom: '' }
    await writeAtomic(goalFile, JSON.stringify({
      version: 1,
      mood: file.mood,
      custom: file.custom,
      goals: file.items,
    }, null, 2) + '\n')
    return file
  }

  /** One plan per goal: a flat list of dated items the model laid out. */
  async function loadPlans() {
    if (plans !== null) return plans
    const text = await readText(planFile)
    let parsed = null
    if (text !== null) {
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        warn('dsh-sidebar-memo: plan.json is not JSON, starting empty')
      }
    }
    const items = Array.isArray(parsed?.plans) ? parsed.plans : []
    plans = items
      .filter(item => item !== null && typeof item === 'object')
      .map(normalizePlan)
      .filter(plan => plan.goalId !== '' && plan.days.length > 0)
    return plans
  }

  async function savePlans() {
    const list = plans ?? []
    await writeAtomic(planFile, JSON.stringify({ version: 1, plans: list }, null, 2) + '\n')
    return list
  }

  /** The stored plan of one goal, or null when it has none yet. */
  async function planOf(goalId) {
    const list = await loadPlans()
    return list.find(plan => plan.goalId === goalId) ?? null
  }

  /** Replace the whole plan of one goal. */
  async function savePlan({ goalId, days }) {
    return serialize(async () => {
      const goal = await findGoal(goalId)
      const next = normalizePlan({ goalId: goal.id, at: new Date().toISOString(), days })
      if (next.days.length === 0) throw new Error('计划里没有可用的日期')
      const total = next.days.reduce((sum, day) => sum + day.items.length, 0)
      if (total > PLAN_ITEMS_MAX) throw new Error('计划条目太多了，先收一收')
      const list = await loadPlans()
      plans = [...list.filter(plan => plan.goalId !== goal.id), next]
      await savePlans()
      return next
    })
  }

  /** Add days to a plan without dropping what is already there. */
  async function addPlanDays({ goalId, days }) {
    return serialize(async () => {
      const goal = await findGoal(goalId)
      const list = await loadPlans()
      const existing = list.find(plan => plan.goalId === goal.id) ?? { goalId: goal.id, days: [] }
      const merged = new Map()
      for (const day of normalizePlan(existing).days) merged.set(day.date, day.items.slice())
      for (const day of normalizePlan({ days }).days) {
        const there = merged.get(day.date) ?? []
        const seen = new Set(there.map(item => item.text))
        const grown = [...there, ...day.items.filter(item => !seen.has(item.text))]
        merged.set(day.date, grown.slice(0, PLAN_ITEMS_PER_DAY))
      }
      const next = normalizePlan({ goalId: goal.id, at: new Date().toISOString(), days: [...merged.entries()].map(([date, items]) => ({ date, items })) })
      if (next.days.length === 0) throw new Error('计划里没有可用的日期')
      const total = next.days.reduce((sum, day) => sum + day.items.length, 0)
      if (total > PLAN_ITEMS_MAX) throw new Error('计划条目太多了，先收一收')
      plans = [...list.filter(plan => plan.goalId !== goal.id), next]
      await savePlans()
      return next
    })
  }

  /** Tick one scheduled item. */
  async function setPlanItemDone({ goalId, date, id, done }) {
    return serialize(async () => {
      const goal = await findGoal(goalId)
      const list = await loadPlans()
      const plan = list.find(item => item.goalId === goal.id)
      if (plan === undefined) throw new Error('这个目标还没有计划')
      const day = plan.days.find(item => item.date === date)
      if (day === undefined) throw new Error('计划里没有这一天：' + date)
      const item = day.items.find(entry => entry.id === id || entry.text === id)
      if (item === undefined) throw new Error('这一天没有这条安排')
      const days = plan.days.map((entry) => entry.date !== date ? entry : {
        date: entry.date,
        items: entry.items.map((row) => row.id === item.id ? { ...row, done: done === true } : row),
      })
      const next = { ...plan, days }
      plans = list.map((entry) => entry.goalId === goal.id ? next : entry)
      await savePlans()
      return next
    })
  }

  async function removePlan(goalId) {
    return serialize(async () => {
      const list = await loadPlans()
      plans = list.filter(plan => plan.goalId !== goalId)
      await savePlans()
      return list.length - plans.length
    })
  }

  async function loadSettings() {
    if (settings !== null) return settings
    const text = await readText(settingsFile)
    let parsed = null
    if (text !== null) {
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        warn('dsh-sidebar-memo: settings.json is not JSON, using defaults')
      }
    }
    settings = {
      mood: moodOf(parsed?.mood),
      custom: clip(parsed?.custom, GOAL_NOTE_MAX),
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : '',
    }
    return settings
  }

  async function saveSettings(patch) {
    const current = await loadSettings()
    const next = {
      mood: patch?.mood === undefined ? current.mood : moodOf(patch.mood),
      custom: patch?.custom === undefined ? current.custom : clip(patch.custom, GOAL_NOTE_MAX),
      updatedAt: new Date().toISOString(),
    }
    settings = next
    await writeAtomic(settingsFile, JSON.stringify(next, null, 2) + '\n')
    return next
  }

  async function diaryDates() {
    let names = []
    try {
      names = await readdir(diaryDir)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      warn('dsh-sidebar-memo: cannot list diary pages: ' + (error?.message ?? error))
      return []
    }
    return names
      .filter(name => name.endsWith('.md'))
      .map(name => name.slice(0, -3))
      .filter(isDate)
      .sort()
      .reverse()
  }

  async function readDiary(date) {
    const text = await readText(join(diaryDir, date + '.md'))
    return text === null ? '' : text
  }

  async function writeDiary(date, text, mode) {
    const next = clip(text, DIARY_TEXT_MAX)
    const current = await readDiary(date)
    const body = mode === 'replace'
      ? next
      : current === '' || next === ''
        ? current + next
        : current + '\n\n' + next
    await writeAtomic(join(diaryDir, date + '.md'), body)
    return body
  }

  async function diaryPage(date) {
    const key = isDate(date) ? date : today()
    return { date: key, text: await readDiary(key) }
  }

  /** Dates that have a page, oldest first, clipped to the given window. */
  async function diaryBetween(from, to, maxChars = 14_000) {
    const dates = (await diaryDates()).slice().reverse()
    const pages = []
    let used = 0
    for (const date of dates) {
      if (date < from || date > to) continue
      const text = (await readDiary(date)).trim()
      if (text === '') continue
      if (used + text.length > maxChars && pages.length > 0) break
      const body = text.length > maxChars ? text.slice(0, maxChars) + '…' : text
      pages.push({ date, text: body })
      used += body.length
    }
    return pages
  }

  async function readRaw(date) {
    const text = await readText(join(rawDir, date + '.md'))
    return text === null ? '' : text
  }

  async function appendRaw(date, text) {
    const next = clip(text, RAW_TEXT_MAX)
    if (next === '') throw new Error('先说说今天做了什么')
    const current = await readRaw(date)
    const body = current === '' ? next : current + '\n\n' + next
    await writeAtomic(join(rawDir, date + '.md'), body)
    return body
  }

  /** The notes, plus whether the page is older than them. */
  async function rawState(date) {
    const text = await readRaw(date)
    if (text.trim() === '') return { text: '', at: 0, fresh: false }
    const [notesAt, pageAt] = await Promise.all([
      fileTime(join(rawDir, date + '.md')),
      fileTime(join(diaryDir, date + '.md')),
    ])
    return { text, at: notesAt, fresh: notesAt > pageAt }
  }

  async function state(date) {
    const page = await diaryPage(date)
    const [items, dates, raw, cfg, book, planBook, diaryTime] = await Promise.all([
      loadTodos(),
      diaryDates(),
      rawState(page.date),
      loadSettings(),
      loadGoals(),
      loadPlans(),
      fileTime(join(diaryDir, page.date + '.md')),
    ])
    const ordered = book.items.slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
    })
    return {
      todos: items,
      dates,
      diary: page,
      diaryAt: diaryTime,
      raw,
      goals: ordered,
      plans: planBook,
      mood: cfg.mood,
      custom: cfg.custom,
      activity: { ...activity },
      today: today(),
    }
  }

  async function addTodo({ text, note = '', steps = [], by = 'user' }) {
    return serialize(async () => {
      const title = clip(text, TITLE_MAX)
      if (title === '') throw new Error('待办内容不能为空')
      const items = await loadTodos()
      if (items.length >= 500) throw new Error('待办太多了，先清理一些')
      const item = {
        id: newId('t'),
        text: title,
        note: clip(note, NOTE_MAX),
        steps: normalizeSteps(steps),
        done: false,
        at: new Date().toISOString(),
        by,
      }
      await saveTodos([...items, item])
      return item
    })
  }

  async function setTodoDone(id, done) {
    return serialize(async () => {
      const items = await loadTodos()
      const index = items.findIndex(item => item.id === id)
      if (index < 0) throw new Error('没有这条待办')
      const next = items.slice()
      next[index] = { ...next[index], done: done === true, at: new Date().toISOString() }
      await saveTodos(next)
      return next[index]
    })
  }

  async function setStepDone(id, stepIndex, done) {
    return serialize(async () => {
      const items = await loadTodos()
      const index = items.findIndex(item => item.id === id)
      if (index < 0) throw new Error('没有这条待办')
      const item = items[index]
      const at = Number(stepIndex)
      if (!Number.isInteger(at) || at < 0 || at >= item.steps.length) throw new Error('没有这个步骤')
      const steps = item.steps.slice()
      steps[at] = { ...steps[at], done: done === true }
      const next = items.slice()
      next[index] = { ...item, steps }
      await saveTodos(next)
      return next[index]
    })
  }

  /** Rewrite one todo in place: only the fields given in the patch change. */
  async function updateTodo(id, patch = {}, by = 'user') {
    return serialize(async () => {
      const items = await loadTodos()
      const index = items.findIndex(item => item.id === id)
      if (index < 0) throw new Error('没有这条待办')
      const next = { ...items[index], at: new Date().toISOString(), by }
      if (patch.text !== undefined) {
        const title = clip(patch.text, TITLE_MAX)
        if (title === '') throw new Error('待办内容不能为空')
        next.text = title
      }
      if (patch.note !== undefined) next.note = clip(patch.note, NOTE_MAX)
      if (patch.steps !== undefined) next.steps = normalizeSteps(patch.steps)
      const list = items.slice()
      list[index] = next
      await saveTodos(list)
      return next
    })
  }

  async function removeTodo(id) {
    return serialize(async () => {
      const items = await loadTodos()
      const next = items.filter(item => item.id !== id)
      if (next.length === items.length) throw new Error('没有这条待办')
      await saveTodos(next)
      return id
    })
  }

  async function clearDone() {
    return serialize(async () => {
      const items = await loadTodos()
      const next = items.filter(item => !item.done)
      await saveTodos(next)
      return items.length - next.length
    })
  }

  /** Pick one goal by id, or the newest open one when the id is empty. */
  async function findGoal(id) {
    const book = await loadGoals()
    const wanted = String(id ?? '').trim()
    if (wanted !== '') {
      const found = book.items.find(goal => goal.id === wanted || goal.text === wanted)
      if (found === undefined) throw new Error('没有这个目标：' + wanted)
      return found
    }
    const open = book.items.filter(goal => !goal.done).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    if (open.length === 0) throw new Error('还没有未完成的目标')
    return open[0]
  }

  /** Open a goal, or rewrite the fields of an existing one. */
  async function saveGoal({ id = '', text, note }) {
    return serialize(async () => {
      const book = await loadGoals()
      const wanted = String(id ?? '').trim()
      if (wanted !== '') {
        const index = book.items.findIndex(goal => goal.id === wanted)
        if (index < 0) throw new Error('没有这个目标：' + wanted)
        const next = { ...book.items[index] }
        if (text !== undefined) {
          const title = clip(text, GOAL_TEXT_MAX)
          if (title === '') throw new Error('目标不能是空的')
          next.text = title
        }
        if (note !== undefined) next.note = clip(note, GOAL_NOTE_MAX)
        const list = book.items.slice()
        list[index] = next
        book.items = list
        await saveGoals()
        return next
      }
      const title = clip(text, GOAL_TEXT_MAX)
      if (title === '') throw new Error('目标不能是空的')
      if (book.items.filter(goal => !goal.done).length >= GOALS_MAX) throw new Error('未完成的目标太多了，先收一收')
      const goal = {
        id: newId('g'),
        text: title,
        note: clip(note, GOAL_NOTE_MAX),
        since: today(),
        done: false,
        doneAt: '',
        createdAt: new Date().toISOString(),
        logs: [],
        review: null,
      }
      book.items = [...book.items, goal].slice(-GOALS_MAX)
      await saveGoals()
      return goal
    })
  }

  async function logGoal(id, text) {
    return serialize(async () => {
      const goal = await findGoal(id)
      const line = clip(text, GOAL_LOG_MAX)
      if (line === '') throw new Error('记一条进展要写点什么')
      const next = { ...goal, logs: [...goal.logs, { at: new Date().toISOString(), text: line }].slice(-GOAL_LOGS_MAX) }
      const book = await loadGoals()
      book.items = book.items.map(item => (item.id === next.id ? next : item))
      await saveGoals()
      return next
    })
  }

  async function reviewGoal(id, { text, mode }) {
    return serialize(async () => {
      const goal = await findGoal(id)
      const body = clip(text, GOAL_REVIEW_MAX)
      if (body === '') throw new Error('点评是空的')
      const next = { ...goal, review: { at: new Date().toISOString(), mode: moodOf(mode), text: body } }
      const book = await loadGoals()
      book.items = book.items.map(item => (item.id === next.id ? next : item))
      await saveGoals()
      return next
    })
  }

  async function setGoalDone(id, done) {
    return serialize(async () => {
      const goal = await findGoal(id)
      const next = {
        ...goal,
        done: done === true,
        doneAt: done === true ? new Date().toISOString() : '',
      }
      const book = await loadGoals()
      book.items = book.items.map(item => (item.id === next.id ? next : item))
      await saveGoals()
      return next
    })
  }

  async function removeGoal(id) {
    return serialize(async () => {
      const goal = await findGoal(id)
      const book = await loadGoals()
      book.items = book.items.filter(item => item.id !== goal.id)
      await saveGoals()
      const list = await loadPlans()
      plans = list.filter(plan => plan.goalId !== goal.id)
      await savePlans()
      return goal
    })
  }

  async function setMood(mood, custom) {
    return serialize(() => saveSettings({ mood, custom }))
  }

  function beginActivity(tool, op) {
    activity = { ...activity, tool, op, phase: 'run', at: Date.now(), ids: [], date: '' }
  }

  function endActivity(tool, op, extra = {}) {
    activity = {
      seq: activity.seq + 1,
      tool,
      op,
      phase: 'done',
      at: Date.now(),
      ids: Array.isArray(extra.ids) ? extra.ids : [],
      date: typeof extra.date === 'string' ? extra.date : '',
    }
  }

  function currentActivity() {
    return { ...activity }
  }

  return {
    root,
    state,
    diaryDates,
    readDiary,
    writeDiary,
    diaryPage,
    diaryBetween,
    readRaw,
    appendRaw,
    rawState,
    addTodo,
    setTodoDone,
    setStepDone,
    updateTodo,
    removeTodo,
    clearDone,
    findGoal,
    saveGoal,
    logGoal,
    reviewGoal,
    setGoalDone,
    removeGoal,
    planOf,
    savePlan,
    addPlanDays,
    setPlanItemDone,
    removePlan,
    setMood,
    beginActivity,
    endActivity,
    currentActivity,
  }
}
