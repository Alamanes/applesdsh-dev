/**
 * dsh-self-evolution-portrait — the article row.
 *
 * Owns the portrait on disk: the memory files, the article rules, the review
 * gate a Dream's output passes through, and the model's on-demand read. The
 * article body never stands in the prompt; only the lead line does, and the
 * reader re-reads it only when the file changes.
 *
 * @module dsh-self-evolution-portrait
 */

import { settingsFor } from 'dsh-self-evolution-core/lib/runtime.js'
import { ensureMemoryFiles, createIdentityReader } from './lib/memory.js'
import { memoryTool } from './lib/memory-tool.js'

/** Plugin name shown in the Loader inventory. */
export const name = 'self-evolution-portrait'

/** The tool registry carries the read; the prompt registry carries the lead line. */
export const inject = ['tools', 'systemPrompt']

/** Identity section identity and order, directly before the discipline. */
const IDENTITY_SECTION = 'evolve:identity'
const IDENTITY_ORDER = 3040

/**
 * The frame around the identity line.
 *
 * The line exists so the assistant behaves as if it already knows who it is
 * talking to; the frame exists so that advantage is not spent by announcing it.
 */
const IDENTITY_FRAME = '已知用户背景（内部信息，用来调整称呼、语气与默认做法；不要复述给用户，也不要写「根据我的记忆」）'

/**
 * Lay out the portrait files and publish the two surfaces that read them.
 *
 * @param ctx - the plugin's context.
 * @param rowConfig - the plugin row's `config` from the composition.
 */
export function apply(ctx, rowConfig) {
  const settings = settingsFor(rowConfig)
  ensureMemoryFiles(settings.paths)

  // The one-line identity, when there is an accepted article to take it from.
  // It is a prompt section rather than runtime context on purpose: a section is
  // standing background the deployment owns, while runtime context arrives as a
  // user-role message, and a portrait that looks like the user's own words gets
  // obeyed like them.
  if (settings.identityLine) {
    const identity = createIdentityReader(settings.paths)
    ctx.systemPrompt.section({
      name: IDENTITY_SECTION,
      order: IDENTITY_ORDER,
      interpolate: false,
      text: () => {
        const line = identity()
        return line.length === 0 ? '' : `[plugin: self-evolution] ${IDENTITY_FRAME}：${line}`
      },
    })
  }

  // The on-demand read of the full portrait. One small schema, one action field,
  // and nothing beyond the identity line standing in the prompt.
  if (settings.memoryTool) {
    ctx.effect(
      () => ctx.tools.register(memoryTool({ settings })),
      'self-evolution: memory tool',
    )
  }
}
