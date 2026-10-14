/**
 * dsh-self-evolution-llm — the collection-model row.
 *
 * Builds the ordered attempt chain the two background legs draft through: pinned
 * models, then discovered models by context window, then the session's own model,
 * each tried in turn. Owns nothing else, so a deployment can swap it for a
 * different drafting backend by replacing one row.
 *
 * @module dsh-self-evolution-llm
 */

import { settingsFor, runtime } from 'dsh-self-evolution-core/lib/runtime.js'
import { createCollectorLlm } from './lib/llm.js'

/** Plugin name shown in the Loader inventory. */
export const name = 'self-evolution-llm'

/** No required service: the model service is read lazily at call time. */
export const inject = []

/**
 * Build the chain and publish it for the legs that draft through it.
 *
 * @param ctx - the plugin's context, handed to the chain resolver.
 * @param rowConfig - the plugin row's `config` from the composition.
 */
export function apply(ctx, rowConfig) {
  const settings = settingsFor(rowConfig)
  runtime.llm = createCollectorLlm({
    ctx,
    settings,
    log: (line) => runtime.log?.(line),
  })
}
