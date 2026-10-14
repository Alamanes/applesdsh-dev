/**
 * dsh-self-evolution-flow — the manual-flow row.
 *
 * Builds the deliberate half: the review flow that reads a candidate, enables,
 * merges or rejects it, grades the enabled skills, walks the memory draft and
 * commits the ledger. Nothing here runs on its own; every action is reached
 * through the surface row's tool or the `/evolve` command.
 *
 * @module dsh-self-evolution-flow
 */

import { settingsFor, runtime, lazy } from 'dsh-self-evolution-core/lib/runtime.js'
import { createEvolve } from './lib/evolve.js'

/** Plugin name shown in the Loader inventory. */
export const name = 'self-evolution-flow'

/** No required service: the legs are reached through the runtime record. */
export const inject = []

/**
 * Build the flow and publish it for the surfaces that call it.
 *
 * @param ctx - the plugin's context, handed to the actions that commit.
 * @param rowConfig - the plugin row's `config` from the composition.
 */
export function apply(ctx, rowConfig) {
  const settings = settingsFor(rowConfig)

  /**
   * The session query service, which the sweep and some actions read.
   *
   * Read through `ctx.get` at use time: a minimal composition may not mount it.
   */
  function sessionQuery() {
    try {
      return typeof ctx.get === 'function' ? ctx.get('sessionQuery') : undefined
    } catch {
      return undefined
    }
  }

  runtime.evolve = createEvolve({
    settings,
    ctx,
    llm: lazy(() => runtime.llm),
    memory: lazy(() => runtime.memory),
    invalidateSkills: () => runtime.invalidateSkills?.(),
    traceStateFor: (session) => runtime.traceStateOf?.(session),
    sessionQuery,
  })
}
