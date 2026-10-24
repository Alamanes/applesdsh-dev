// One-off model calls for the memory review and the panel summary: the same route
// the conversation uses, streamed through the host's llm service, assembled by hand
// because a plugin does not import the harness packages.

const CALL_TIMEOUT_MS = 120_000

/**
 * The provider and model a request should use: the agent's current choice, else the
 * first provider that declares a model.
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

/**
 * Ask the model once and return its text.
 * @param ctx - host plugin context.
 * @param params.system - the system prompt.
 * @param params.text - the single user message.
 * @param params.maxTokens - the first output budget.
 * @param params.warn - logger for the discarded-reply case.
 */
export async function askOnce(ctx, { system, text, maxTokens = 2_048, warn = () => {} }) {
  const llm = ctx.get('llm', false)
  if (llm === undefined || typeof llm.stream !== 'function') throw new Error('The llm service is not available.')
  const route = routeOf(ctx)
  const budgets = [maxTokens, 8_192]
  for (const budget of budgets) {
    let reply = ''
    let finish
    let failure
    const options = {
      provider: route.provider,
      model: route.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      maxTokens: budget,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    }
    if (typeof route.reasoningEffort === 'string') options.reasoningEffort = route.reasoningEffort
    for await (const chunk of llm.stream(options)) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') reply += chunk.text
      else if (chunk?.type === 'finish') { finish = chunk.reason; failure = chunk.failure }
    }
    if (finish === 'error' || finish === 'aborted') throw new Error(failure?.message ?? String(finish))
    const trimmed = reply.trim()
    if (finish !== 'max-tokens' && trimmed !== '') return trimmed
    if (finish !== 'max-tokens') throw new Error('The model wrote nothing')
    warn('dsh-user-memory: the model used its whole output budget; retrying once with room')
  }
  throw new Error('The model used up the output budget and wrote no complete answer.')
}
