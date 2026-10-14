/**
 * dsh-self-evolution-core — the ledger row.
 *
 * Owns what every other row reads: the resolved settings, the data-directory
 * layout, the state ledger's first write, and the shared `runtime` record the
 * component rows hand objects through. It registers no model-facing surface of
 * its own.
 *
 * @module dsh-self-evolution-core
 */

import { settingsFor, runtime } from './lib/runtime.js'
import { ensureLayout, exists, logExperience } from './lib/store.js'
import { readState, writeState } from './lib/state.js'

/** Plugin name shown in the Loader inventory. */
export const name = 'self-evolution-core'

/** No required service: the ledger only touches the file system. */
export const inject = []

/**
 * Prepare the data root and publish the shared settings.
 *
 * @param ctx - the plugin's context.
 * @param rowConfig - the plugin row's `config` from the composition.
 */
export function apply(ctx, rowConfig) {
  const settings = settingsFor(rowConfig)
  ensureLayout(settings.paths)
  // `init.py` created state.json at install time in the original; here the
  // first activation does it, so the counters are readable before the first
  // collection pass rather than appearing out of nowhere afterwards.
  if (!exists(settings.paths.state)) {
    try {
      writeState(settings.paths, readState(settings.paths))
    } catch {
      // A read-only data root is reported by the integrity check instead.
    }
  }
  runtime.settings = settings
  runtime.log = (line) => logExperience(settings.paths, line)
}
