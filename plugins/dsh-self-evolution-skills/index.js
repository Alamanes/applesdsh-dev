/**
 * dsh-self-evolution-skills — the skill-supply row.
 *
 * Serves the approved skills under the data root plus the bundled flow skill,
 * through the harness skill registry. What the collector drafted is not reachable
 * from here: the provider only ever publishes what a review already enabled.
 *
 * @module dsh-self-evolution-skills
 */

import { settingsFor, runtime, optionalIn } from 'dsh-self-evolution-core/lib/runtime.js'
import { createSkillProvider } from './lib/skills.js'

/** Plugin name shown in the Loader inventory. */
export const name = 'self-evolution-skills'

/** No required service: a composition without a skill registry still loads. */
export const inject = []

/**
 * Mount the provider and hand its invalidation capability to the flow.
 *
 * @param ctx - the plugin's context.
 * @param rowConfig - the plugin row's `config` from the composition.
 */
export function apply(ctx, rowConfig) {
  const settings = settingsFor(rowConfig)
  const skillProvider = createSkillProvider({
    settings,
    onInvalidate: (capability) => {
      runtime.invalidateSkills = capability
    },
  })
  optionalIn(ctx, ['skills'], '技能供给（skills 服务）', (skillsCtx) => {
    skillProvider.mount(skillsCtx)
  })
}
