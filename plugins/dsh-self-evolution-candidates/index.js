/**
 * dsh-self-evolution-candidates — the quarantine row.
 *
 * Holds the file-level rules of the candidate area: reading a candidate, the
 * mechanical preflight, and the enable, merge and reject verdicts with their
 * paper trail. It registers no surface of its own; the collector writes into the
 * area and the manual flow moves things out of it.
 *
 * @module dsh-self-evolution-candidates
 */

import { settingsFor } from 'dsh-self-evolution-core/lib/runtime.js'

/** Plugin name shown in the Loader inventory. */
export const name = 'self-evolution-candidates'

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
