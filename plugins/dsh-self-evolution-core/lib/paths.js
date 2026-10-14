/**
 * Data-directory layout for the evolution system.
 *
 * The on-disk layout is the port's compatibility contract: it is the same tree
 * the pi/claude-code/codex builds of agent-self-evolution use, so an existing
 * `SE_ROOT` keeps working and every file stays plain text the user can read,
 * edit, diff and commit.
 *
 * Root resolution, in order:
 *   1. the plugin row's `root` config
 *   2. `SE_ROOT`                — the original environment variable
 *   3. `$DSH_HOME/evolution`    — the native location inside the DSH home, which
 *                                 is `~/.dsh/evolution` when DSH_HOME is unset
 *
 * The pi-era default `~/.config/agent-self-evolution` is deliberately gone: this
 * is a DSH plugin, so its data lives in the DSH home next to the harness's own
 * state. Data from a pi installation is moved by hand.
 *
 * @module dsh-self-evolution-core/lib/paths
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * The DSH home, following the harness convention: `$DSH_HOME`, else `~/.dsh`.
 *
 * The harness resolves its own home that way, and does not export `DSH_HOME` to
 * the process that loads plugins, so the fallback carries the normal case.
 *
 * @returns the absolute DSH home.
 */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return resolve(expandHome(fromEnv.trim()))
  return join(homedir(), '.dsh')
}

/** Default data root: a sibling of the harness state inside the DSH home. */
export function defaultRoot() {
  return join(dshHome(), 'evolution')
}

/**
 * Resolve the evolution data root.
 *
 * @param override - an explicit root from the plugin config, if any.
 * @returns the absolute data root.
 */
export function resolveRoot(override) {
  if (typeof override === 'string' && override.trim().length > 0) return resolve(expandHome(override.trim()))
  const fromEnv = process.env.SE_ROOT
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return resolve(expandHome(fromEnv.trim()))
  return defaultRoot()
}

/** Expand a leading `~` to the home directory. */
export function expandHome(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Every path the system owns, derived from one root.
 *
 * @param root - the absolute data root.
 * @returns the path table.
 */
export function paths(root) {
  return {
    root,
    candidates: join(root, 'candidates'),
    skills: join(root, 'skills'),
    archived: join(root, 'archived'),
    memory: join(root, 'memory'),
    profile: join(root, 'memory', 'PROFILE.md'),
    inbox: join(root, 'memory', 'inbox'),
    drafts: join(root, 'memory', 'drafts'),
    memoryArchive: join(root, 'memory', 'archive'),
    draftsArchive: join(root, 'memory', 'archive', 'drafts'),
    logs: join(root, 'logs'),
    experienceLog: join(root, 'logs', 'experience-log.md'),
    logArchive: join(root, 'logs', 'archive'),
    ledgerBackup: join(root, 'logs', 'archive', 'ledger-backup'),
    rejectedDrafts: join(root, 'logs', 'rejected-drafts'),
    state: join(root, 'state.json'),
    config: join(root, 'config.json'),
    usage: join(root, 'usage.json'),
    lock: join(root, '.lock'),
    sweepLock: join(root, '.sweep.lock'),
  }
}


