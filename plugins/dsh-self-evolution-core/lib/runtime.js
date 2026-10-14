/**
 * The hand-off between the component packages.
 *
 * Every component loads as its own Loader row, so the system's runtime objects
 * have to cross a package boundary: settings, the collector's model chain, the
 * trace accessor, the memory leg and the manual flow each belong to the row that
 * built them and are needed by another row. The rows share one process, so the
 * hand-off is a module-level record filled in by whoever owns the object and
 * read lazily by whoever needs it. Lazy reads matter: Loader rows settle in no
 * guaranteed order, and a consumer that ran first must still work once the
 * producer arrives.
 *
 * @module dsh-self-evolution-core/lib/runtime
 */

import { resolveSettings } from './config.js'
import { logExperience, stamp } from './store.js'

/**
 * Runtime objects, keyed by owner.
 *
 * Each field is written by exactly one component row and read by the rows that
 * depend on it. A field stays `undefined` until its owner loads, and every
 * consumer checks before use rather than assuming a load order.
 */
export const runtime = {
  settings: undefined,
  log: undefined,
  traceStateOf: undefined,
  llm: undefined,
  memory: undefined,
  evolve: undefined,
  invalidateSkills: undefined,
}

/**
 * A stand-in for an object another row owns.
 *
 * Rows settle in no guaranteed order, so a consumer builds its surface before
 * the producer's object exists. The proxy resolves the real object on every
 * access, which makes the surface usable as soon as the producer loads and
 * keeps an early call from reaching into `undefined`.
 *
 * @param target - a function returning the real object, or undefined.
 * @returns the stand-in, which forwards every call once the object exists.
 */
export function lazy(target) {
  const resolve = () => {
    try {
      return target()
    } catch {
      return undefined
    }
  }
  return new Proxy(
    {},
    {
      get(_self, prop) {
        if (prop === 'then') return undefined
        const value = resolve()
        if (value === undefined) {
          if (typeof prop !== 'string') return undefined
          return () => {
            throw new Error('自进化的对应组件尚未加载')
          }
        }
        const member = value[prop]
        return typeof member === 'function' ? member.bind(value) : member
      },
      has(_self, prop) {
        const value = resolve()
        return value !== undefined && prop in value
      },
    },
  )
}

/**
 * Resolve the shared settings, letting the first row that loads decide them.
 *
 * Every row carries the same defaults, so a row that loads before the core row
 * computes an equivalent object rather than waiting. The first resolution wins,
 * which keeps one settings instance behind every row.
 *
 * @param rowConfig - the row's `config` from the composition.
 * @returns the shared settings.
 */
export function settingsFor(rowConfig) {
  if (runtime.settings === undefined) runtime.settings = resolveSettings(rowConfig)
  return runtime.settings
}

/**
 * Report one degraded component without taking its row down.
 *
 * A row that dies whole because one optional service behaved differently leaves
 * the user with nothing and no way to see which part was at fault. The experience
 * log line is best-effort: before the core row loads there is no log to write to.
 *
 * @param ctx - the row's context, for the host logger.
 * @param label - what was being registered.
 * @param error - the failure.
 */
export function noteDegrade(ctx, label, error) {
  const detail = String(error?.message ?? error).slice(0, 300)
  try {
    if (typeof ctx?.logger?.warn === 'function') ctx.logger.warn(`self-evolution: ${label} 未启用：${detail}`)
  } catch {
    // A missing host logger is not worth a second failure.
  }
  try {
    runtime.log?.(`| ${stamp()} | - | 降级 | ${label} 未启用：${detail} | - |`)
  } catch {
    // A read-only data root is reported by the integrity check instead.
  }
}

/**
 * Claim optional services and run a registration inside the child context.
 *
 * The guard sits inside the callback as well: `ctx.inject()` returns long before
 * the service appears, so a throw from the registration body would otherwise
 * escape every `try` around the call itself.
 *
 * @param ctx - the row's context.
 * @param services - the service names to claim.
 * @param label - what is being registered.
 * @param body - the registration, called with the injected child context.
 */
export function optionalIn(ctx, services, label, body) {
  try {
    ctx.inject(services, (childCtx) => {
      try {
        body(childCtx)
      } catch (error) {
        noteDegrade(ctx, label, error)
      }
    })
  } catch (error) {
    noteDegrade(ctx, label, error)
  }
}

export { logExperience }
