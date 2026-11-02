// One-off model calls for the diary page and the goal critique: the same route
// the conversation uses, streamed through the host's llm service, assembled by
// hand because a plugin does not import the harness packages.
//
// Two rules, both deliberate:
//   - no output budget: a diary page is a few hundred characters, and thinking
//     tokens are billed against the same budget, so a cap only invents a failure;
//   - the lowest reasoning level the model actually declares. `off` when the
//     model lists it, otherwise `low`; a call that must not think never climbs
//     the effort ladder on its own.

const CALL_TIMEOUT_MS = 120_000

/** Effort ids that mean "do not think", best first. */
const QUIET_EFFORTS = ['off', 'none', 'disabled', 'minimal', 'low']

/**
 * The provider and model a request should use: the agent's current choice, else
 * the first provider that declares a model.
 * @param ctx - host plugin context.
 * @returns {provider, model, reasoningEffort?}
 */
export function routeOf(ctx) {
  let selection
  try {
    selection = ctx.get('agentDefaultModel', false)?.currentSelection?.()
  } catch {
    selection = undefined
  }
  if (selection !== undefined && selection !== null && typeof selection.provider === 'string' && typeof selection.model === 'string') {
    return { provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort }
  }
  const llm = ctx.get('llm', false)
  const providers = typeof llm?.listProviders === 'function' ? llm.listProviders() : []
  const first = providers.find(entry => Array.isArray(entry?.models) && entry.models.length > 0)
  if (first !== undefined) return { provider: first.id ?? first.provider, model: first.models[0] }
  throw new Error('No model is available: add one in Harness settings.')
}

/** The quietest level this model declares, by name. */
async function quietEffort(llm, route) {
  try {
    const info = await llm.resolveModelInfo?.(route.provider, route.model)
    const raw = info?.reasoning?.efforts ?? info?.reasoningEfforts
    const ids = Array.isArray(raw)
      ? raw.map(entry => (typeof entry === 'string' ? entry : entry?.id)).filter(id => typeof id === 'string')
      : []
    for (const wanted of QUIET_EFFORTS) {
      if (ids.includes(wanted)) return wanted
    }
    if (ids.length > 0) return ids[0]
  } catch { /* older host: fall through to the literal */ }
  return 'low'
}

/** The host reports a finish reason as a string in older builds and as
 *  `{ kind, failure }` in newer ones. */
function finishKind(reason) {
  if (typeof reason === 'string') return reason
  if (reason !== null && typeof reason === 'object') {
    if (typeof reason.kind === 'string') return reason.kind
    if (typeof reason.type === 'string') return reason.type
  }
  return ''
}

function failureText(failure, finish) {
  if (failure === undefined || failure === null) return '模型调用失败（' + finish + '）'
  if (typeof failure === 'string') return failure
  const message = failure.message ?? failure.detail ?? failure.code
  if (typeof message === 'string' && message !== '') return message
  try {
    return JSON.stringify(failure)
  } catch {
    return '模型调用失败（' + finish + '）'
  }
}

/**
 * Ask the model once at the quietest level and return its text.
 * @param ctx - host plugin context.
 * @param params.system - the system prompt.
 * @param params.text - the single user message.
 * @param params.warn - logger for an empty reply.
 */
export async function askOnce(ctx, { system, text, warn = () => {} }) {
  const llm = ctx.get('llm', false)
  if (llm === undefined || typeof llm.stream !== 'function') throw new Error('The llm service is not available.')
  const route = routeOf(ctx)
  const effort = await quietEffort(llm, route)

  const attempt = async (level) => {
    let reply = ''
    let finish = ''
    let failure
    const options = {
      provider: route.provider,
      model: route.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      reasoningEffort: level,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    }
    for await (const chunk of llm.stream(options)) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') reply += chunk.text
      else if (chunk?.type === 'finish') {
        finish = finishKind(chunk.reason)
        const reason = chunk.reason
        failure = chunk.failure ?? (reason !== null && typeof reason === 'object' ? reason.failure : undefined)
      }
    }
    if (finish === 'error' || finish === 'aborted') throw new Error(failureText(failure, finish))
    const trimmed = reply.trim()
    return { text: trimmed, finish: finish || (trimmed === '' ? 'no-finish' : 'stop') }
  }

  /** A model that does not declare the level we asked for still has a floor:
   *  `low` is the conventional lowest non-zero effort, so fall back to it once. */
  const atFloor = async (level) => {
    try {
      return await attempt(level)
    } catch (error) {
      const message = String(error?.message ?? '')
      if (level !== 'low' && /does not support reasoning effort|unsupported reasoning/i.test(message)) {
        warn('dsh-sidebar-memo: model rejected effort "' + level + '", using "low"')
        return attempt('low')
      }
      throw error
    }
  }

  const first = await atFloor(effort)
  if (first.text !== '') return first.text

  warn('dsh-sidebar-memo: the model returned no text at effort "' + effort + '" (' + first.finish + '); retrying once')
  const second = await atFloor(effort)
  if (second.text !== '') return second.text
  throw new Error('模型这次没有输出内容（' + second.finish + '，思考档 ' + effort + '）')
}
