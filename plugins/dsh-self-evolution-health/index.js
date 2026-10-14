/**
 * dsh-self-evolution-health — the feedback-loop row.
 *
 * Pure rules: which skills a session actually used, how the outcome landed, and
 * the three-axis scorecard the flow reports. The collector and the flow call
 * into it; there is no registry to attach to, so the row only resolves the
 * shared settings.
 *
 * @module dsh-self-evolution-health
 */

import { settingsFor } from 'dsh-self-evolution-core/lib/runtime.js'

/** Plugin name shown in the Loader inventory. */
export const name = 'self-evolution-health'

/** No required service: the row is a library over the data root. */
export const inject = []

/**
 * Resolve the shared settings so this row's data root matches every other row's.
 *
 * @param ctx - the plugin's context.
 * @param rowConfig - the plugin row's `config` from the composition.
 */
export function apply(ctx, rowConfig) {
  settingsFor(rowConfig)
}
