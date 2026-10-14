/**
 * The DSH adapter: fold a session log into the unified trace.
 *
 * This is the only module that knows DSH's event vocabulary, and it is the
 * whole platform-specific surface of the port. It runs as a session projection
 * unit, which is the harness-sanctioned way to derive state from the log: the
 * fold is pure and synchronous, the value survives restart and resume through
 * the projection checkpoint, and a resumed session re-delivers its history to
 * `apply` instead of needing the collector to read raw events.
 *
 * Retention: the projection keeps a bounded tail of records. Reasoning,
 * runtime-context injections and notices are dropped at the source, so the
 * retained tail is dense conversation rather than framework noise.
 *
 * @module dsh-self-evolution-trace/lib/projection
 */

import { assistantRecord, toolResultRecord, userRecord } from './trace.js'

/** Projection key; a `stateVersion` bump refolds the whole log. */
export const TRACE_KEY = 'self-evolution:trace'

/** Current fold semantics version. */
export const TRACE_STATE_VERSION = 1

/** Records retained per session; older ones fall out of the tail. */
export const RETENTION = 600

/**
 * Initial projection state for one session.
 *
 * Record sequence numbers start at 1, so the collector's cursor can use 0 as
 * "nothing has been analysed yet" and the very first record is never mistaken
 * for one that was already seen.
 *
 * @returns a zeroed trace state.
 */
export function initTraceState() {
  return { nextSeq: 1, entries: [], toolCalls: 0, errors: 0 }
}

/** Parse a tool call's raw argument string into an object. */
function parseArguments(raw) {
  if (raw === null || raw === undefined) return {}
  if (typeof raw === 'object') return raw
  if (typeof raw !== 'string' || raw.length === 0) return {}
  try {
    const value = JSON.parse(raw)
    return value !== null && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

/** Append one record, keeping the tail bounded and the counters current. */
function push(state, record) {
  const entries = [...state.entries, { seq: state.nextSeq, ...record }].slice(-RETENTION)
  let toolCalls = state.toolCalls
  let errors = state.errors
  if (record.role === 'assistant' && record.toolCall) toolCalls += 1
  if (record.role === 'bashExecution') toolCalls += 1
  if (record.role === 'toolResult' && record.isError === true) errors += 1
  return { nextSeq: state.nextSeq + 1, entries, toolCalls, errors }
}

/** The text of a `assistant/message` or `user/message` content array. */
function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/** Every tool-call block of one assistant message. */
function toolCallsOf(content) {
  if (!Array.isArray(content)) return []
  return content.filter((block) => block !== null && typeof block === 'object' && block.type === 'tool-call')
}

/**
 * Fold one DSH session event into the trace state.
 *
 * Returns the same reference for every event that contributes nothing, which is
 * what keeps an unchanged projection free downstream.
 *
 * @param state - the current trace state.
 * @param event - one committed session event.
 * @returns the next state, or the same state when the event is irrelevant.
 */
export function applyTraceEvent(state, event) {
  if (event === null || typeof event !== 'object') return state
  const type = event.type
  const data = event.data !== null && typeof event.data === 'object' ? event.data : {}

  if (type === 'user/message') {
    // Only input a human typed becomes a user request. Runtime-context
    // snapshots, notices and plugin messages carry other sources and would
    // otherwise be summarised to the collector as if the user had said them.
    if (data.source?.kind !== 'user') return state
    const text = textOf(data.content ?? data.message?.content)
    if (text.trim().length === 0) return state
    return push(state, userRecord(text))
  }

  if (type === 'assistant/message') {
    const message = data.message !== null && typeof data.message === 'object' ? data.message : data
    const content = message.content
    let next = state
    const text = textOf(content)
    if (text.trim().length > 0) next = push(next, assistantRecord(text))
    const calls = toolCallsOf(content)
    if (calls.length === 0) return next
    let out = next
    for (const call of calls) {
      const name = String(call.name ?? call.toolName ?? '')
      if (name.length === 0) continue
      const args = parseArguments(call.arguments ?? call.args ?? call.input)
      // In DSH every shell command is a tool call, so the command is already
      // carried by this record's arguments; a separate `bashExecution` record
      // would double the tool count and repeat the command in the summary.
      out = push(out, assistantRecord('', { name, args }))
    }
    return out
  }

  if (type === 'tool/call') {
    // The call lifecycle is already folded from the assistant message that
    // produced it; a duplicate record here would double every tool count.
    return state
  }

  if (type === 'tool/result') {
    const message = data.message !== null && typeof data.message === 'object' ? data.message : data
    const isError = message.isError === true || data.isError === true
    const text = textOf(message.content)
    if (!isError && text.trim().length === 0) return state
    return push(state, toolResultRecord(text, isError))
  }

  return state
}

/**
 * Build the projection definition the plugin registers.
 *
 * @returns the `sessionProjections.register()` definition.
 */
export function traceProjectionDefinition() {
  return {
    key: TRACE_KEY,
    stateVersion: TRACE_STATE_VERSION,
    init: () => initTraceState(),
    apply: (state, event) => applyTraceEvent(state, event),
  }
}

/** The newest record seq in a projection state, or the cursor when empty. */
export function latestSeq(state, fallback = 0) {
  if (state === null || state === undefined || !Array.isArray(state.entries) || state.entries.length === 0) return fallback
  return state.entries[state.entries.length - 1].seq
}
