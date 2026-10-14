/**
 * Settings resolution.
 *
 * Three layers, highest first: the plugin row's `config` in `cordis.patch.yml`,
 * the environment, then `$SE_ROOT/config.json`, then the built-in defaults.
 * Numeric and pattern variables keep the original names, so an existing
 * installation's shell profile and `config.json` keep working unchanged.
 *
 * `SE_LLM_CMD`, `SE_BACKEND`, `SE_API_BASE`, `SE_API_KEY` and `SE_API_MODEL`
 * are deliberately gone: the collector now drafts through the host's own LLM
 * service, so credentials, model choice and pricing live in the DSH settings
 * that already own them.
 *
 * @module dsh-self-evolution-core/lib/config
 */

import { readJson, writeJsonAtomic, exists } from './store.js'
import { privatePatterns } from './text.js'
import { paths as pathsOf, resolveRoot } from './paths.js'

/** Collector defaults, mirroring the original `core/templates/config.json`. */
export const COLLECTOR_DEFAULTS = {
  models: [],
  auto: true,
  includeCurrentModel: true,
  max: 3,
}

/** How long a resolved chain is reused before the model registry is re-read. */
export const CHAIN_CACHE_MS = 6 * 60 * 60 * 1000

/** Every tunable, with its original environment variable and default. */
export const LIMITS = {
  minToolCalls: { env: 'SE_MIN_TOOL_CALLS', default: 5 },
  maxCandidates: { env: 'SE_MAX_CANDIDATES', default: 20 },
  maxTraceChars: { env: 'SE_MAX_TRACE_CHARS', default: 2500 },
  maxOutputTokens: { env: 'SE_MAX_OUTPUT_TOKENS', default: 5120 },
  throttleMs: { env: 'SE_THROTTLE_MS', default: 0 },
  maxSkillChars: { env: 'SE_MAX_SKILL_CHARS', default: 8000 },
  maxSkills: { env: 'SE_MAX_SKILLS', default: 40 },
  maxCollectRetries: { env: 'SE_MAX_COLLECT_RETRIES', default: 3 },
  maxExtracts: { env: 'SE_MAX_EXTRACTS', default: 20 },
  maxExtractOutputTokens: { env: 'SE_MAX_EXTRACT_OUTPUT_TOKENS', default: 3072 },
  maxArticleOutputTokens: { env: 'SE_MAX_ARTICLE_OUTPUT_TOKENS', default: 8192 },
}

/**
 * Interval tunables, in milliseconds.
 *
 * Read separately from the integer limits because `Number(x) || fallback` turns
 * an explicit `0` into the fallback, and `0` is a meaningful interval: it means
 * "no gate".
 */
export const INTERVALS = {
  memoryIdleMs: { env: 'SE_MEMORY_IDLE_MS', default: 5 * 60 * 1000 },
  dreamIntervalMs: { env: 'SE_DREAM_INTERVAL_MS', default: 24 * 60 * 60 * 1000 },
  sweepBackfillMs: { env: 'SE_SWEEP_BACKFILL_MS', default: 7 * 24 * 60 * 60 * 1000 },
  sweepCooldownMs: { env: 'SE_SWEEP_COOLDOWN_MS', default: 10 * 60 * 1000 },
  sweepLockStaleMs: { env: 'SE_SWEEP_LOCK_STALE_MS', default: 30 * 60 * 1000 },
}

/** Read one positive integer tunable from the environment or its default. */
function limit(name) {
  const spec = LIMITS[name]
  const raw = process.env[spec.env]
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : spec.default
}

/** Read one interval tunable, where an explicit `0` is honoured. */
function interval(name) {
  const spec = INTERVALS[name]
  const raw = process.env[spec.env]
  if (raw === undefined || raw === '') return spec.default
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : spec.default
}

/** Build the empty `config.json` body written on first run. */
export function defaultConfigFile() {
  return { collector: { ...COLLECTOR_DEFAULTS } }
}

/**
 * Resolve the whole settings object for one plugin activation.
 *
 * @param rowConfig - the plugin row's `config` from the composition, if any.
 * @returns settings plus the derived path table.
 */
export function resolveSettings(rowConfig) {
  const row = rowConfig !== null && typeof rowConfig === 'object' ? rowConfig : {}
  const root = resolveRoot(typeof row.root === 'string' ? row.root : undefined)
  const paths = pathsOf(root)

  if (!exists(paths.config)) {
    try {
      writeJsonAtomic(paths.config, defaultConfigFile())
    } catch {
      // A read-only root still runs: defaults apply and nothing is written.
    }
  }
  const fileConfig = readJson(paths.config, defaultConfigFile())
  const fileCollector = fileConfig !== null && typeof fileConfig.collector === 'object' && fileConfig.collector !== null ? fileConfig.collector : {}
  const rowCollector = row.collector !== null && typeof row.collector === 'object' && row.collector !== null ? row.collector : {}

  const collector = { ...COLLECTOR_DEFAULTS, ...fileCollector, ...rowCollector }
  collector.models = normalizePinnedModels(collector.models)
  collector.max = Number.isFinite(collector.max) && collector.max > 0 ? Math.floor(collector.max) : COLLECTOR_DEFAULTS.max

  return {
    root,
    paths,
    collector,
    /** Run the background collector after a finished turn. */
    autoCollect: row.autoCollect !== false,
    /** Register the model-facing `memory` tool, the on-demand portrait read. */
    memoryTool: row.memoryTool !== false,
    /**
     * Keep the article's lead sentence in the prompt as one identity line, so
     * the assistant behaves as if it already knows who it is talking to. Set
     * false to keep everything about the user behind the `memory` tool.
     */
    identityLine: row.identityLine !== false,
    /**
     * Require a human verdict before a Dream's rewrite becomes the article.
     * `SE_DREAM_REVIEW=0` restores the pre-review behaviour, where a Dream
     * installs `memory/PROFILE.md` the moment it validates.
     */
    dreamReview: row.dreamReview !== false && process.env.SE_DREAM_REVIEW !== '0',
    /** Sweep sessions that closed before their idle gate could fire. */
    sweep: row.sweep !== false && process.env.SE_SWEEP !== '0',
    /** Serve the bundled flow skill through the skill registry. */
    flowSkill: row.flowSkill !== false,
    /** Register the model-facing `evolve` tool. */
    registerTool: row.tool !== false,
    /** Register the `/evolve` command family. */
    registerCommands: row.commands !== false,
    /** Serve the client panel's HTTP routes. */
    registerRoutes: row.routes !== false,
    limits: {
      minToolCalls: limit('minToolCalls'),
      maxCandidates: limit('maxCandidates'),
      maxTraceChars: limit('maxTraceChars'),
      maxOutputTokens: limit('maxOutputTokens'),
      throttleMs: limit('throttleMs'),
      maxSkillChars: limit('maxSkillChars'),
      maxSkills: limit('maxSkills'),
      maxCollectRetries: limit('maxCollectRetries'),
      maxExtracts: limit('maxExtracts'),
      maxExtractOutputTokens: limit('maxExtractOutputTokens'),
      maxArticleOutputTokens: limit('maxArticleOutputTokens'),
      memoryIdleMs: interval('memoryIdleMs'),
      dreamIntervalMs: interval('dreamIntervalMs'),
      sweepBackfillMs: interval('sweepBackfillMs'),
      sweepCooldownMs: interval('sweepCooldownMs'),
      sweepLockStaleMs: interval('sweepLockStaleMs'),
      chainCacheMs: CHAIN_CACHE_MS,
    },
    privatePatterns: privatePatterns(process.env.SE_PRIVATE_PATTERNS),
    sweepMax: Number.parseInt(String(process.env.SE_SWEEP_MAX ?? ''), 10) || 3,
  }
}

/** Keep only well-formed `{ provider, model }` pins. */
function normalizePinnedModels(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const provider = typeof item.provider === 'string' ? item.provider.trim() : ''
    const model = typeof item.model === 'string' ? item.model.trim() : typeof item.id === 'string' ? item.id.trim() : ''
    if (provider.length === 0 || model.length === 0) continue
    out.push({ provider, model })
  }
  return out
}

