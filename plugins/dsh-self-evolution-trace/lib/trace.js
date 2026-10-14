/**
 * The unified trace protocol.
 *
 * Platform adapters in the original system normalised a transcript into a
 * JSONL stream of these five record shapes; this port produces the same shapes
 * from DSH session events, so the collector's decisions stay identical.
 *
 * ```json
 * {"role":"user","text":"…"}
 * {"role":"assistant","text":"…","toolCall":{"name":"bash","args":{"command":"…"}}}
 * {"role":"toolResult","isError":true,"text":"…"}
 * {"role":"bashExecution","command":"…","cancelled":false}
 * ```
 *
 * @module dsh-self-evolution/lib/trace
 */

import { extractText, extractToolPaths, sanitizeTraceText, scrubHome } from 'dsh-self-evolution-core/lib/text.js'

/** User requests that mean "this session is the evolution flow itself". */
export const SELF_MGMT_TRIGGERS = [
  '进化',
  '自我进化',
  '技能候选',
  '沉淀技能',
  '进化一下',
  '审查候选',
  '技能体检',
  '总结一天',
]

/**
 * A trigger word only counts in a short instruction.
 *
 * A long message that happens to mention 进化 is ordinary work, and treating it
 * as the flow itself would switch collection off for a whole session.
 */
export const TRIGGER_MAX_LEN = 30

/** Paths owned by this system; touching them marks a self-management session. */
export const SELF_MGMT_PATHS = [
  'dsh-self-evolution',
  'self-evolution',
  'evolution/candidates',
  'evolution/skills',
  'evolution/memory',
  '/evolution/',
  'state.json',
  'usage.json',
  'experience-log',
  'memory/PROFILE.md',
  'memory/inbox',
]

/** Per-segment summary budgets, so one noisy segment cannot drop the others. */
export const TRACE_SEGMENT_BUDGET = { user: 700, ops: 800, error: 900 }

/** Tool names whose argument carries a shell command. */
const BASH_TOOLS = new Set(['bash', 'bash_command', 'command', 'exec_command', 'shell'])

/** Tool names whose argument carries a file path. */
const FILE_TOOLS = new Set(['edit', 'write', 'read', 'multiedit', 'str_replace_editor', 'notebookedit'])

/** Build one user record. */
export function userRecord(text) {
  return { role: 'user', text: String(text ?? '') }
}

/** Build one assistant record, optionally carrying its tool call. */
export function assistantRecord(text, toolCall) {
  const record = { role: 'assistant', text: String(text ?? '') }
  if (toolCall !== undefined && toolCall !== null) record.toolCall = toolCall
  return record
}

/** Build one tool-result record. */
export function toolResultRecord(text, isError) {
  return { role: 'toolResult', isError: isError === true, text: String(text ?? '') }
}

/** Build one bash-execution record. */
export function bashRecord(command, cancelled = false) {
  return { role: 'bashExecution', command: String(command ?? ''), cancelled: cancelled === true }
}

/**
 * Every text fragment of one record, used to locate a skill-file read.
 *
 * @param entry - one trace record.
 * @returns the concatenated fragments.
 */
export function entryText(entry) {
  if (entry === null || typeof entry !== 'object') return ''
  const parts = []
  if (entry.text) parts.push(String(entry.text))
  if (entry.command) parts.push(String(entry.command))
  const call = entry.toolCall
  if (call !== null && typeof call === 'object') {
    if (call.name) parts.push(String(call.name))
    try {
      parts.push(JSON.stringify(call.args ?? {}))
    } catch {
      // A non-serialisable argument contributes nothing.
    }
  }
  return parts.join('\n')
}

/** Concatenate the whole trace text, which is what the usage scan searches. */
export function traceText(entries) {
  const parts = []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    if (entry.role === 'user') {
      const text = String(entry.text ?? '').trim()
      if (text.length > 0 && !text.startsWith('/')) parts.push(text)
    } else if (entry.role === 'assistant') {
      const text = String(entry.text ?? '').trim()
      if (text.length > 0) parts.push(text)
      const call = entry.toolCall
      if (call !== null && typeof call === 'object') {
        parts.push(String(call.name ?? ''))
        try {
          parts.push(JSON.stringify(call.args ?? {}))
        } catch {
          // Ignored, as above.
        }
      }
    }
  }
  return parts.join('\n')
}

/** Count tool calls in one window of records. */
export function countToolCalls(entries) {
  let count = 0
  for (const entry of entries) {
    if (entry?.role === 'assistant' && entry.toolCall) count += 1
    else if (entry?.role === 'bashExecution' && entry.cancelled !== true) count += 1
  }
  return count
}

/** Count failed tool results in one window of records. */
export function countErrors(entries) {
  let count = 0
  for (const entry of entries) if (entry?.role === 'toolResult' && entry.isError === true) count += 1
  return count
}

/** Whether a window of records has any user request at all. */
export function hasUserMessage(entries) {
  return entries.some((entry) => entry?.role === 'user' && String(entry.text ?? '').trim().length > 0)
}

/**
 * Whether this window is the evolution flow working on itself.
 *
 * Collecting during the flow would burn tokens describing the flow back to
 * itself, so such a session is skipped without an LLM call. Two signals: a
 * short user instruction carrying a trigger word, or an action that touched a
 * path this system owns.
 *
 * @param entries - the window's records.
 * @returns true when the window must be skipped.
 */
export function isSelfManagement(entries) {
  for (const entry of entries) {
    if (entry?.role === 'user') {
      const text = String(entry.text ?? '').trim()
      if (text.length > 0 && text.length <= TRIGGER_MAX_LEN && SELF_MGMT_TRIGGERS.some((word) => text.includes(word))) {
        return true
      }
    }
  }
  const paths = extractToolPaths(entries)
  return paths.some((path) => {
    const lowered = path.toLowerCase()
    return SELF_MGMT_PATHS.some((marker) => lowered.includes(marker))
  })
}

/**
 * Render the trace window into the summary a collector prompt embeds.
 *
 * The shape is the original one: the last five user requests, the last
 * twenty-five executed operations, and the last three errors, home-scrubbed and
 * masked. Each segment is clamped to its own budget before the segments are
 * joined, so a tool-heavy session cannot truncate the error section away.
 *
 * @param entries - the window's records.
 * @param maxChars - the summary budget.
 * @returns the summary text.
 */
export function buildTraceSummary(entries, maxChars) {
  const userParts = []
  const actionParts = []
  const errorParts = []

  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const text = String(entry.text ?? '').trim()

    if (entry.role === 'user') {
      if (text.length > 0 && !text.startsWith('/')) userParts.push(text.slice(0, 300))
    } else if (entry.role === 'assistant') {
      const call = entry.toolCall
      if (call !== null && typeof call === 'object') {
        const name = String(call.name ?? '').toLowerCase()
        const args = call.args !== null && typeof call.args === 'object' ? call.args : {}
        if (BASH_TOOLS.has(name)) {
          const command = String(args.command ?? args.cmd ?? '')
          if (command.length > 0) actionParts.push(command.slice(0, 200))
        } else if (FILE_TOOLS.has(name)) {
          const path = String(args.path ?? args.file_path ?? '')
          if (path.length > 0) actionParts.push(`${name} ${path}`)
        } else if (name.length > 0) {
          actionParts.push(name)
        }
      }
      if (text.length > 0) actionParts.push(text.slice(0, 200))
    } else if (entry.role === 'toolResult') {
      if (entry.isError === true && text.length > 0) errorParts.push(text.slice(0, 400))
    } else if (entry.role === 'bashExecution') {
      const command = String(entry.command ?? '')
      if (command.length > 0 && entry.cancelled !== true) actionParts.push(command.slice(0, 200))
    }
  }

  const clamp = (value, max) => (value.length <= max ? value : `${value.slice(0, max)}…`)
  const blocks = []
  if (userParts.length > 0) blocks.push(`【用户请求】\n${clamp(userParts.slice(-5).join('\n'), TRACE_SEGMENT_BUDGET.user)}`)
  if (actionParts.length > 0) blocks.push(`【执行操作】\n${clamp(actionParts.slice(-25).join('\n'), TRACE_SEGMENT_BUDGET.ops)}`)
  if (errorParts.length > 0) blocks.push(`【出现的错误】\n${clamp(errorParts.slice(-3).join('\n---\n'), TRACE_SEGMENT_BUDGET.error)}`)
  return scrubHome(blocks.join('\n\n')).slice(0, maxChars)
}

/** Extract the visible text of a DSH content value, re-exported for adapters. */
export { extractText }
