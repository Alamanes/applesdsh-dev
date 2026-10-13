/**
 * The collector's model backend: the host's own LLM service.
 *
 * The original system reached out of process — a custom command, the `claude`
 * or `codex` CLI, or a hand-configured OpenAI-compatible endpoint — and
 * discovered cheap models by reading the host's model registry and its prices.
 * Inside the harness there is a supported path for exactly this, so the whole
 * backend layer collapses into `ctx.llm`: credentials, adapters and provider
 * configuration stay owned by DSH, and no second credential is needed.
 *
 * What survives from the original is the *chain* discipline. A pin list is
 * tried first, then automatically discovered models, then the session's own
 * model as a guaranteed fallback; every entry is validated, a failed entry
 * falls through to the next, and the discarded entries are reported so a
 * silently dead chain cannot go unnoticed. The resolution is cached against a
 * fingerprint of the model registry for six hours, so a long session does not
 * re-enumerate models on every pass — while any change to the registry, the
 * pins or the session model re-resolves and leaves a line in the log.
 *
 * @module dsh-self-evolution/lib/llm
 */

/** Text-only drafting never needs a long answer; this bounds a runaway one. */
const DEFAULT_TIMEOUT_MS = 180000

/** Reasoning efforts to prefer, cheapest first. */
const PREFERRED_EFFORTS = ['low', 'minimal', 'off']

/** `YYYY-MM-DD HH:MM` for a log line, matching the log's own stamps. */
function stamp(now = new Date()) {
  const iso = now.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

/**
 * Create the collector's LLM facade.
 *
 * @param options - the wiring inputs.
 * @param options.ctx - the plugin context.
 * @param options.settings - resolved settings.
 * @param options.log - the experience-log writer.
 * @returns the facade.
 */
export function createCollectorLlm({ ctx, settings, log }) {
  /**
   * Resolve the model service on demand.
   *
   * It is deliberately not read at activation time and not declared in the
   * plugin's `inject`: a Cordis service accessor throws for a service the
   * calling context did not inject, so touching `ctx.llm` from `apply()` would
   * take the whole plugin down in a composition that mounts no model adapter.
   * `ctx.get()` is the optional-service read, and it returns undefined instead.
   *
   * @returns the model service, or undefined when the host has none.
   */
  function service() {
    try {
      const value = typeof ctx?.get === 'function' ? ctx.get('llm') : undefined
      return value !== undefined && value !== null ? value : undefined
    } catch {
      return undefined
    }
  }

  /** Whether the host exposes an LLM service at all. */
  function available() {
    const llm = service()
    return llm !== undefined && typeof llm.stream === 'function'
  }

  /** The session's own provider/model, which is known to be configured. */
  function sessionModel(agent) {
    try {
      const header = agent?.session?.requestHeader?.()
      const provider = header?.config?.provider
      const model = header?.config?.model
      if (typeof provider === 'string' && typeof model === 'string' && provider.length > 0 && model.length > 0) {
        return { provider, model }
      }
    } catch {
      // A session that has not sent a request yet has no header.
    }
    return undefined
  }

  /**
   * List every registered provider/model pair.
   *
   * This is the cheap half of chain resolution: it reads the local registry and
   * makes no per-model call, so it can run on every pass to detect a change.
   *
   * @returns the discovered entries and the providers that failed to enumerate.
   */
  async function enumerate() {
    const llm = service()
    const entries = []
    const discarded = []
    if (llm === undefined || settings.collector.auto !== true || typeof llm.listProviders !== 'function') {
      return { entries, discarded }
    }
    let providers = []
    try {
      providers = llm.listProviders() ?? []
    } catch (error) {
      discarded.push({ provider: '-', reason: `providers 枚举失败: ${String(error?.message ?? error).slice(0, 120)}` })
      return { entries, discarded }
    }
    for (const provider of providers) {
      const id = typeof provider === 'string' ? provider : provider?.id
      if (typeof id !== 'string' || id.length === 0) continue
      try {
        const models = (await llm.listModels(id)) ?? []
        for (const model of models) {
          const modelId = typeof model === 'string' ? model : model?.id
          if (typeof modelId !== 'string' || modelId.length === 0) continue
          entries.push({ provider: id, model: modelId })
        }
      } catch (error) {
        discarded.push({ provider: id, reason: `模型枚举失败: ${String(error?.message ?? error).slice(0, 120)}` })
      }
    }
    return { entries, discarded }
  }

  /**
   * Fingerprint the inputs a resolution depends on.
   *
   * Any change to the pins, the registry listing or the session model produces
   * a different key, which invalidates the cached chain.
   *
   * @param entries - the discovered pairs.
   * @param fallback - the session's own model, if known.
   * @returns the fingerprint.
   */
  function fingerprint(entries, fallback) {
    const pins = settings.collector.models.map((pin) => `${pin.provider}/${pin.model}`)
    const discovered = entries.map((entry) => `${entry.provider}/${entry.model}`).sort()
    return [
      `pin=${pins.join(',')}`,
      `auto=${settings.collector.auto === true ? 1 : 0}`,
      `current=${settings.collector.includeCurrentModel === true ? 1 : 0}`,
      `max=${settings.collector.max}`,
      `session=${fallback === undefined ? '-' : `${fallback.provider}/${fallback.model}`}`,
      `pool=${discovered.join(',')}`,
    ].join('|')
  }

  /** Ask the adapter how small a model is, which stands in for its price tier. */
  async function modelWeight(provider, model) {
    const llm = service()
    if (llm === undefined) return { weight: Number.MAX_SAFE_INTEGER }
    try {
      const info = await llm.resolveModelInfo(provider, model)
      const window = Number(info?.contextWindow ?? info?.info?.contextWindow)
      return { weight: Number.isFinite(window) && window > 0 ? window : Number.MAX_SAFE_INTEGER }
    } catch {
      return { weight: Number.MAX_SAFE_INTEGER }
    }
  }

  /** `provider/model > provider/model`, for logs and the models command. */
  function chainKey(chain) {
    return (chain ?? []).map((entry) => `${entry?.provider ?? '?'}/${entry?.model ?? '?'}`).join(' > ')
  }

  /**
   * Resolve the ordered attempt chain.
   *
   * DSH exposes no price metadata, so `auto` ranks discovered models by their
   * declared context window, smallest first: the closest available proxy for
   * the cheap tier. State an exact model in `collector.models` when the choice
   * matters.
   *
   * @param options - the resolution inputs.
   * @param options.agent - the session's agent, for the fallback entry.
   * @param options.state - the state object the fingerprint cache lives in.
   * @param options.force - re-resolve even when the cache is still fresh.
   * @returns the chain, the discarded entries and a note about the resolution.
   */
  async function resolveChain({ agent, state, force = false } = {}) {
    const llm = service()
    const fallback = sessionModel(agent)
    const { entries: discovered, discarded } = await enumerate()
    const key = fingerprint(discovered, fallback)

    const cachedAt = Date.parse(state?.collectorChainAt ?? '')
    const cached = Array.isArray(state?.collectorChain) ? state.collectorChain : []
    if (
      !force &&
      cached.length > 0 &&
      state?.collectorChainKey === key &&
      Number.isFinite(cachedAt) &&
      Date.now() - cachedAt < settings.limits.chainCacheMs
    ) {
      return { chain: cached, discarded, note: state.collectorChainNote ?? '', cached: true }
    }

    const chain = []
    const seen = new Set()
    const push = (entry) => {
      const entryKey = `${entry.provider}/${entry.model}`
      if (seen.has(entryKey)) return
      seen.add(entryKey)
      chain.push(entry)
    }

    for (const pin of settings.collector.models) push({ provider: pin.provider, model: pin.model, source: 'pin' })

    if (settings.collector.auto === true && llm !== undefined) {
      const weighted = []
      for (const entry of discovered) {
        if (seen.has(`${entry.provider}/${entry.model}`)) continue
        const { weight } = await modelWeight(entry.provider, entry.model)
        weighted.push({ ...entry, weight, source: 'auto' })
      }
      weighted.sort(
        (left, right) =>
          left.weight - right.weight ||
          left.provider.localeCompare(right.provider) ||
          left.model.localeCompare(right.model),
      )
      for (const entry of weighted) push(entry)
    }

    if (settings.collector.includeCurrentModel === true && fallback !== undefined) {
      push({ ...fallback, source: 'session' })
    }

    const trimmed = chain.slice(0, Math.max(1, settings.collector.max))
    for (const entry of chain.slice(trimmed.length)) {
      discarded.push({ provider: entry.provider, model: entry.model, reason: '超出链长上限' })
    }

    const note = `链 ${trimmed.length} 项：${chainKey(trimmed) || '（空）'}`
    if (discarded.length > 0 && typeof log === 'function') {
      const detail = discarded.map((item) => `${item.provider}${item.model ? `/${item.model}` : ''}（${item.reason}）`).join('、')
      log(`| ${stamp()} | - | 采集链 | 丢弃 ${detail} | - |`)
    }

    if (state !== undefined && state !== null) {
      const previousKey = state.collectorChainKey
      state.collectorChainKey = key
      state.collectorChainAt = new Date().toISOString()
      state.collectorChain = trimmed.map((entry) => ({ provider: entry.provider, model: entry.model }))
      state.collectorChainNote = note
      if (previousKey !== undefined && previousKey !== key && typeof log === 'function') {
        log(`| ${stamp()} | - | 采集链 | 链已变化：${chainKey(trimmed) || '（空）'} | - |`)
      }
    }
    return { chain: trimmed, discarded, note, cached: false }
  }

  /** Choose the cheapest reasoning effort the model actually advertises. */
  function pickEffort(info) {
    const efforts = info?.reasoningEfforts ?? info?.info?.reasoningEfforts
    if (efforts === null || efforts === undefined) return undefined
    const supported = Array.isArray(efforts) ? efforts : Object.keys(efforts)
    if (supported.length === 0) return undefined
    for (const candidate of PREFERRED_EFFORTS) {
      if (supported.includes(candidate)) return candidate
    }
    return supported[0]
  }

  /**
   * Run one drafting call, walking the chain until an entry answers.
   *
   * @param options - the call inputs.
   * @param options.prompt - the prompt text.
   * @param options.maxTokens - the output budget.
   * @param options.agent - the session's agent, for chain resolution.
   * @param options.state - the state object the fingerprint cache lives in.
   * @param options.chain - a chain to use as-is, skipping resolution.
   * @returns `{ text, provider, model, truncated }` or `{ failure }`.
   */
  async function draft({ prompt, maxTokens, agent, state, chain: given }) {
    const llm = service()
    if (llm === undefined || typeof llm.stream !== 'function') {
      return { failure: '宿主未提供 llm 服务（采集后端不可用）' }
    }
    let chain = given
    let discarded = []
    if (!Array.isArray(chain) || chain.length === 0) {
      const resolved = await resolveChain({ agent, state })
      chain = resolved.chain
      discarded = resolved.discarded
    }
    if (chain.length === 0) {
      const detail = discarded.length > 0 ? `（已丢弃：${discarded.map((item) => item.reason).join('；')}）` : ''
      return { failure: `采集链为空${detail}：请在 config.json 的 collector.models 指定模型，或确认 DSH 已配置可用供应商` }
    }

    const failures = []
    for (const entry of chain) {
      try {
        const info = await llm.resolveModelInfo(entry.provider, entry.model).catch(() => undefined)
        const effort = pickEffort(info)
        const messages = [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
        const request = { provider: entry.provider, model: entry.model, messages, maxTokens, temperature: 0 }
        if (effort !== undefined) request.reasoningEffort = effort

        let text = ''
        let finish
        let outputTokens = 0
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
        try {
          for await (const chunk of llm.stream({ ...request, signal: controller.signal })) {
            if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
            else if (chunk?.type === 'finish') finish = chunk.reason
            else if (chunk?.type === 'usage') {
              const tokens = Number(chunk?.usage?.outputTokens ?? chunk?.outputTokens)
              if (Number.isFinite(tokens)) outputTokens = tokens
            }
          }
        } finally {
          clearTimeout(timer)
        }

        const kind = finish?.kind
        if (kind === 'error' || kind === 'aborted') {
          const code = finish?.failure?.code ?? kind
          failures.push(`${entry.provider}/${entry.model}: ${code}`)
          continue
        }
        const trimmed = text.trim()
        if (trimmed.length === 0) {
          failures.push(`${entry.provider}/${entry.model}: 空输出`)
          continue
        }
        // The harness reports no length finish reason, so the output budget is
        // read from the usage chunk: a call that used its whole budget may have
        // been cut off, and both callers would rather discard than keep a stub.
        const truncated = Number.isFinite(maxTokens) && outputTokens > 0 && outputTokens >= maxTokens
        return { text: trimmed, provider: entry.provider, model: entry.model, truncated, outputTokens }
      } catch (error) {
        failures.push(`${entry.provider}/${entry.model}: ${String(error?.message ?? error).slice(0, 160)}`)
      }
    }
    return { failure: `采集链全部失败：${failures.join('；')}` }
  }

  return { available, draft, resolveChain, sessionModel, chainKey }
}
