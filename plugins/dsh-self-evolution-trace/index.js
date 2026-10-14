/**
 * dsh-self-evolution-trace — the trajectory row.
 *
 * Folds DSH session events into the unified trace every other row reads, and
 * publishes the accessor the collector, the memory leg and the flow use to reach
 * one session's folded state.
 *
 * @module dsh-self-evolution-trace
 */

import { settingsFor, runtime, optionalIn } from 'dsh-self-evolution-core/lib/runtime.js'
import { traceProjectionDefinition, TRACE_KEY } from './lib/projection.js'

/** Plugin name shown in the Loader inventory. */
export const name = 'self-evolution-trace'

/** No required service: the projection registry is claimed optionally. */
export const inject = []

/**
 * Register the trace projection and publish its accessor.
 *
 * @param ctx - the plugin's context.
 * @param rowConfig - the plugin row's `config` from the composition.
 */
export function apply(ctx, rowConfig) {
  settingsFor(rowConfig)

  let projections
  optionalIn(ctx, ['sessionProjections'], '会话轨迹投影（sessionProjections 服务）', (projectionCtx) => {
    projections = projectionCtx.sessionProjections
    projectionCtx.sessionProjections.register(traceProjectionDefinition())
  })

  /** The folded trace of one session, or undefined while the projection is absent. */
  runtime.traceStateOf = (session) => {
    if (projections === undefined || session === undefined) return undefined
    try {
      return projections.stateOf(session, TRACE_KEY)
    } catch {
      return undefined
    }
  }
}
