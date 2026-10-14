/**
 * The enabled-skill provider.
 *
 * This is where the quarantine becomes real. Everything under
 * `$SE_ROOT/skills/` is served to the model as an ordinary skill; everything
 * under `candidates/` is not served at all. Promotion is therefore a file move,
 * not a flag, and "what the model can invoke" is always the same set the user
 * reviewed.
 *
 * Serving them through the skill registry — rather than symlinking into a skill
 * directory as the original did — is the part of the port that changes shape
 * with the host: the registry merges providers, applies invocation policy and
 * invalidates caches, so enabling, archiving and the bundled flow skill all
 * behave like any other skill surface in DSH.
 *
 * @module dsh-self-evolution/lib/skills
 */

import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exists, readText } from 'dsh-self-evolution-core/lib/store.js'

/** Absolute directory of this package, which carries the bundled flow skill. */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The bundled flow skill, served to the model through the skill registry. */
export const FLOW_SKILL_DIR = join(PACKAGE_DIR, 'skills', 'self-evolve')

/** Provider name reported to the registry; also the `source` label. */
export const PROVIDER_NAME = 'self-evolution'

/** Name of the bundled flow skill, exempt from archiving. */
export const FLOW_SKILL_NAME = 'self-evolve'

/**
 * Parse the frontmatter fields the registry needs.
 *
 * Only the two required fields plus the optional `whenToUse` are read, and
 * without a YAML dependency: the collector's prompt mandates one unquoted
 * `key: value` per line, and the preflight validates that shape before a
 * candidate can ever reach this module.
 *
 * @param raw - the SKILL.md text.
 * @returns the parsed fields, or undefined when the file is not a usable skill.
 */
export function parseSkill(raw) {
  const lines = String(raw ?? '').split('\n')
  if (lines.length === 0 || lines[0].trim() !== '---') return undefined
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      end = index
      break
    }
  }
  if (end < 0) return undefined

  const fields = {}
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*)$/.exec(line)
    if (match === null) continue
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (value.length > 0) fields[match[1]] = value
  }
  const name = fields.name
  const description = fields.description
  if (typeof name !== 'string' || name.length === 0) return undefined
  if (typeof description !== 'string' || description.length === 0) return undefined
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return undefined
  return {
    name,
    description,
    whenToUse: fields.whenToUse,
    content: lines.slice(end + 1).join('\n').trim(),
  }
}

/**
 * Build one registry candidate for a skill directory.
 *
 * @param directory - the skill's directory.
 * @param rank - the provider-local rank; lower wins a duplicate name.
 * @returns the candidate, or undefined when the directory holds no usable skill.
 */
function candidateFor(directory, rank) {
  const path = join(directory, 'SKILL.md')
  if (!exists(path)) return undefined
  const parsed = parseSkill(readText(path, ''))
  if (parsed === undefined) return undefined
  return {
    name: parsed.name,
    description: parsed.description,
    ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
    invocation: { modelInvocable: true, userInvocable: true },
    provider: PROVIDER_NAME,
    source: PROVIDER_NAME,
    rank,
    locator: { path, directory },
    resourceBase: { kind: 'directory', path: directory },
    path,
  }
}

/** List the enabled skill directories, sorted by name. */
export function enabledSkillNames(skillsDir, readDir = readdirSync) {
  try {
    return readDir(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Build the provider object the registry mounts.
 *
 * @param options - the provider inputs.
 * @param options.settings - resolved settings.
 * @param options.onInvalidate - called with the invalidate capability once
 *   registered, so the flow can republish the catalog after a promotion.
 * @returns the provider.
 */
export function createSkillProvider({ settings, onInvalidate }) {
  const provider = {
    name: PROVIDER_NAME,

    /** Discover the enabled skills plus the bundled flow skill. */
    async list() {
      const candidates = []
      const flow = candidateFor(FLOW_SKILL_DIR, 1)
      if (flow !== undefined && settings.flowSkill) candidates.push(flow)
      for (const name of enabledSkillNames(settings.paths.skills)) {
        const candidate = candidateFor(join(settings.paths.skills, name), 0)
        // A same-named enabled skill shadows the bundled flow skill, which is
        // how a user takes over the flow definition.
        if (candidate !== undefined) candidates.push(candidate)
      }
      return candidates
    },

    /** Load one skill body. */
    async get(candidate) {
      const directory = candidate?.locator?.directory
      if (typeof directory !== 'string') return undefined
      const path = join(directory, 'SKILL.md')
      const parsed = parseSkill(readText(path, ''))
      if (parsed === undefined) return undefined
      return {
        name: parsed.name,
        description: parsed.description,
        ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
        invocation: { modelInvocable: true, userInvocable: true },
        source: candidate.source ?? PROVIDER_NAME,
        provider: PROVIDER_NAME,
        resourceBase: { kind: 'directory', path: directory },
        path,
        content: parsed.content,
      }
    },

    /** The registry owns the watcher; this provider reads on every call. */
    dispose() {},
  }

  return {
    provider,
    /**
     * Mount the provider on a context.
     *
     * @param ctx - the context that owns the registration.
     * @returns whether the registry was available.
     */
    mount(ctx) {
      if (ctx.skills === undefined || typeof ctx.skills.registerProvider !== 'function') return false
      // Registered directly on the calling context: provider ownership is the
      // fiber's, so unloading the plugin row removes the served skills with it.
      ctx.skills.registerProvider((control) => {
        if (typeof onInvalidate === 'function') onInvalidate(() => control?.invalidate?.())
        return provider
      })
      return true
    },
  }
}

/**
 * Collect the skills the host already knows about, excluding this provider's.
 *
 * The review step uses this so a promoted skill cannot silently shadow, or be
 * shadowed by, a skill that came from somewhere else.
 *
 * @param ctx - the plugin context.
 * @param cwd - the workspace directory the catalog is built for.
 * @returns a map from skill name to its source label.
 */
export async function hostSkillCatalog(ctx, cwd) {
  const out = {}
  // Read optionally: this runs on the plugin's root context, where an accessor
  // for a service the plugin did not inject throws instead of answering.
  let skills
  try {
    skills = typeof ctx?.get === 'function' ? ctx.get('skills') : undefined
  } catch {
    skills = undefined
  }
  if (skills === undefined || typeof skills.snapshot !== 'function') return out
  try {
    const snapshot = await skills.snapshot({ cwd })
    const list = Array.isArray(snapshot) ? snapshot : (snapshot?.skills ?? snapshot?.candidates ?? [])
    for (const skill of list) {
      if (skill === null || typeof skill !== 'object') continue
      if (skill.provider === PROVIDER_NAME) continue
      if (typeof skill.name !== 'string') continue
      out[skill.name] = String(skill.source ?? skill.provider ?? 'host')
    }
  } catch {
    // A catalog that cannot be read simply produces no warnings.
  }
  return out
}
