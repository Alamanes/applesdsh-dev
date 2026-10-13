/**
 * `state.json`: the collector's durable memory of what it has already seen.
 *
 * Two independent legs share this file and never share a watermark:
 * `collectedUpTo` is the skill leg, `profileUpTo` is the memory leg. Keeping
 * them separate is what lets a failed memory extraction be retried after the
 * skill leg has already succeeded, instead of the window being lost.
 *
 * Every write merges against the freshest file on disk. Numeric counters are
 * applied as deltas against the snapshot the writer loaded, so two processes
 * (the app and a CLI session) both collecting at once cannot overwrite each
 * other's increments — a plain write-back once wrote a single logical increment
 * as `+3`.
 *
 * @module dsh-self-evolution/lib/state
 */

import { readJson, writeJsonAtomic } from './store.js'

/** The two collection legs; each owns its own watermark and failure counter. */
export const LEGS = { skill: 'skill', memory: 'memory' }

/**
 * Fields this writer owns. Anything else already on disk (`lastEvolutionAt`,
 * anything added by a later version) is preserved as found.
 */
export const OWNED_KEYS = [
  'createdAt',
  'lastSeenAt',
  'lastCollectionAt',
  'lastDreamAt',
  'lastEvolutionAt',
  'lastEvolution',
  'stats',
  'rejections',
  'collectedUpTo',
  'profileUpTo',
  'sessionRejections',
  'collectFailures',
  'profileFailures',
  'skipMarks',
  'breakerLogged',
  'collectorUnavailable',
  'collectorUnavailableReason',
  'dreamFailures',
]

/** Counters that are set to an absolute observed value rather than incremented. */
const ABSOLUTE_STATS = new Set(['skillsEnabled'])

/** The state each working copy was loaded from, for delta accounting. */
const baselines = new WeakMap()

/** A zeroed state file, matching the original template's shape. */
export function freshState(now = new Date()) {
  return {
    createdAt: now.toISOString(),
    lastEvolutionAt: null,
    lastEvolution: null,
    lastCollectionAt: null,
    lastDreamAt: null,
    lastSeenAt: null,
    stats: {
      sessionsAnalyzed: 0,
      candidatesCreated: 0,
      skillsEnabled: 0,
      skillsUpdated: 0,
      skillsRepaired: 0,
      candidatesRejected: 0,
      candidatesMerged: 0,
      evolutions: 0,
      collectFailures: 0,
      collectorSkips: 0,
      memoryExtracts: 0,
      memoryFailed: 0,
      memoryRejected: 0,
      memoryConsumed: 0,
      dreams: 0,
      dreamsFailed: 0,
    },
    rejections: [],
    collectedUpTo: {},
    profileUpTo: {},
    sessionRejections: {},
    collectFailures: {},
    profileFailures: {},
    skipMarks: {},
    breakerLogged: {},
  }
}

/** Every `{ session: … }` map on the state, for one lifecycle cleanup. */
const PER_SESSION_MAPS = ['collectedUpTo', 'profileUpTo', 'sessionRejections', 'collectFailures', 'profileFailures', 'skipMarks', 'breakerLogged']

/** Read `state.json`, repairing a missing or partial file in memory. */
export function readState(paths) {
  const raw = readJson(paths.state, null)
  const base = freshState()
  if (raw === null || typeof raw !== 'object') {
    baselines.set(base, structuredClone(base))
    return base
  }
  const state = { ...base, ...raw }
  state.stats = { ...base.stats, ...(typeof raw.stats === 'object' && raw.stats !== null ? raw.stats : {}) }
  state.rejections = Array.isArray(raw.rejections) ? raw.rejections : []
  for (const key of PER_SESSION_MAPS) {
    state[key] = typeof raw[key] === 'object' && raw[key] !== null ? raw[key] : {}
  }
  baselines.set(state, structuredClone(state))
  return state
}

/**
 * Persist `state.json`, merging this writer's changes onto the freshest disk copy.
 *
 * @param paths - the layout table.
 * @param state - the working copy.
 * @returns the object that was written.
 */
export function writeState(paths, state) {
  const baseline = baselines.get(state)
  const disk = readJson(paths.state, null)
  let next = state
  if (baseline !== undefined && disk !== null && typeof disk === 'object') {
    next = { ...disk }
    const stats = { ...(typeof disk.stats === 'object' && disk.stats !== null ? disk.stats : {}) }
    for (const [key, value] of Object.entries(state.stats ?? {})) {
      const after = Number(value ?? 0)
      if (ABSOLUTE_STATS.has(key)) {
        stats[key] = after
        continue
      }
      const before = Number(baseline.stats?.[key] ?? 0)
      stats[key] = Number(stats[key] ?? 0) + (after - before)
    }
    next.stats = stats
    for (const key of OWNED_KEYS) {
      if (key === 'stats') continue
      if (state[key] === undefined) delete next[key]
      else next[key] = state[key]
    }
  }
  writeJsonAtomic(paths.state, next)
  // The written object becomes the new baseline, so a second write in the same
  // pass records only what changed after this one.
  baselines.set(state, structuredClone({ ...state, stats: { ...(next.stats ?? state.stats) } }))
  if (next !== state) baselines.set(next, structuredClone(next))
  return next
}

/** Increment one stats counter and return its new value. */
export function bump(state, key, by = 1) {
  state.stats[key] = (state.stats[key] ?? 0) + by
  return state.stats[key]
}

/**
 * Record one rejection, keeping only the most recent 20.
 *
 * The rejected reasons are what makes the system "quiet but not a black box":
 * nothing reaches the user, and everything is diagnosable afterwards.
 */
export function recordRejection(state, session, reason, now = new Date()) {
  state.rejections = [...state.rejections, { at: now.toISOString(), session, reason: String(reason).slice(0, 300) }].slice(-20)
}

/** Read one leg's incremental watermark for a session. */
export function cursorOf(state, session, leg = LEGS.skill) {
  const map = leg === LEGS.memory ? state.profileUpTo : state.collectedUpTo
  const value = map?.[session]
  return Number.isFinite(value) ? value : 0
}

/**
 * Advance one leg's watermark for a session.
 *
 * @param state - the state object.
 * @param session - the session key.
 * @param position - the new watermark; never moves backwards.
 * @param leg - which leg owns the watermark.
 */
export function advanceCursor(state, session, position, leg = LEGS.skill) {
  if (!Number.isFinite(position)) return
  const key = leg === LEGS.memory ? 'profileUpTo' : 'collectedUpTo'
  const map = (state[key] = state[key] ?? {})
  const current = Number.isFinite(map[session]) ? map[session] : 0
  if (position > current) map[session] = position
}

/**
 * Count a transient failure for one leg and report whether to keep retrying.
 *
 * A transient failure (missing credential, network, timeout) must not advance
 * the watermark, so the window is re-analysed later. After `maxRetries`
 * consecutive failures the watermark advances anyway, which trades one lost
 * window for never retrying forever.
 *
 * @param state - the state object.
 * @param session - the session key.
 * @param maxRetries - the retry ceiling.
 * @param leg - which leg failed.
 * @returns true when the caller should give up on this window.
 */
export function noteLegFailure(state, session, maxRetries, leg = LEGS.skill) {
  const key = leg === LEGS.memory ? 'profileFailures' : 'collectFailures'
  const map = (state[key] = state[key] ?? {})
  map[session] = (map[session] ?? 0) + 1
  return map[session] >= maxRetries
}

/** Clear one leg's transient-failure counter after a successful window. */
export function clearLegFailures(state, session, leg = LEGS.skill) {
  const key = leg === LEGS.memory ? 'profileFailures' : 'collectFailures'
  if (state[key]?.[session] !== undefined) delete state[key][session]
}

/**
 * Note that the collector judged a window not worth drafting.
 *
 * Kept apart from `candidatesRejected`, which counts what a human threw away:
 * an automatic "not worth it" is not a review decision. De-duplicated by
 * watermark so re-scanning one window does not inflate the count.
 *
 * @param state - the state object.
 * @param session - the session key.
 * @param watermark - the window's last position.
 */
export function noteSkip(state, session, watermark) {
  const marks = (state.skipMarks = state.skipMarks ?? {})
  const mark = Number.isFinite(watermark) ? watermark : '-'
  if (marks[session] === mark) return
  marks[session] = mark
  bump(state, 'collectorSkips')
}

/**
 * Decide whether a circuit-breaker line still needs writing.
 *
 * One line per session and kind: a breaker that fires on every turn would
 * otherwise bury the log it is supposed to make readable. The caller must write
 * the state afterwards, or the mark is lost and the de-duplication fails.
 *
 * @param state - the state object.
 * @param session - the session key.
 * @param kind - the breaker kind.
 * @returns true when the line should be written.
 */
export function noteBreaker(state, session, kind) {
  const marks = (state.breakerLogged = state.breakerLogged ?? {})
  if (marks[session] === kind) return false
  marks[session] = kind
  return true
}

/**
 * Drop per-session bookkeeping for sessions that no longer exist.
 *
 * The maps only ever grew, so an evicted session left a watermark behind
 * forever. `known` is the set of session keys the host still knows about.
 *
 * @param state - the state object.
 * @param known - the live session keys.
 * @returns how many entries were removed.
 */
export function pruneWatermarks(state, known) {
  if (!(known instanceof Set)) return 0
  let removed = 0
  for (const key of PER_SESSION_MAPS) {
    const map = state[key]
    if (map === null || typeof map !== 'object') continue
    for (const session of Object.keys(map)) {
      if (known.has(session)) continue
      delete map[session]
      removed += 1
    }
  }
  return removed
}
