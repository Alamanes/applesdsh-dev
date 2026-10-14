/**
 * Plain-text storage: atomic writes, a cross-process lock, and the experience
 * log.
 *
 * Two properties matter here. Every value is ordinary JSON or Markdown on disk
 * that the user can read, edit, diff and commit; and a write either lands whole
 * or not at all, so a crash or a second DSH instance can never leave a
 * half-written `state.json` behind.
 *
 * @module dsh-self-evolution/lib/store
 */

import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, readdirSync, statSync, unlinkSync, openSync, closeSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Bytes after which the experience log is archived and restarted. */
export const LOG_MAX_BYTES = 256 * 1024

/** Line count past which the experience log is rotated. */
export const LOG_ROTATE_LIMIT_LINES = 100

/** Lines kept in place after a rotation. */
export const LOG_KEEP_LINES = 40

/** Banner lines preserved across a rotation. */
export const LOG_BANNER_LINES = 6

/** Milliseconds after which an abandoned lock is considered stale. */
export const LOCK_STALE_MS = 60 * 1000

/** Create every directory the layout owns. Idempotent. */
export function ensureLayout(paths) {
  for (const dir of [
    paths.root,
    paths.candidates,
    paths.skills,
    paths.archived,
    paths.memory,
    paths.inbox,
    paths.drafts,
    paths.memoryArchive,
    paths.logs,
    paths.logArchive,
    paths.ledgerBackup,
    paths.rejectedDrafts,
  ]) {
    mkdirSync(dir, { recursive: true })
  }
}

/** Write a human-readable Markdown file. */
export function writeTextAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

/** Write pretty JSON with a trailing newline. */
export function writeJsonAtomic(path, value) {
  writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

/** Read UTF-8 text, returning the fallback when the file is missing. */
export function readText(path, fallback = '') {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return fallback
  }
}

/**
 * Read one JSON value, returning the fallback on a missing or corrupt file.
 *
 * A corrupt control file must never take the collector down: the fallback is
 * handed back and the caller's next write repairs the file.
 */
export function readJson(path, fallback) {
  try {
    const text = readFileSync(path, 'utf8')
    const value = JSON.parse(text)
    return value === null || value === undefined ? fallback : value
  } catch {
    return fallback
  }
}

/** Whether a path exists. */
export function exists(path) {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

/** List directory entry names, returning an empty array when absent. */
export function listDir(path) {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

/** Append one line to a text file, creating the parent directory. */
export function appendLine(path, line) {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${line}\n`, 'utf8')
}

/** Remove a file, ignoring absence. */
export function removeFile(path) {
  try {
    unlinkSync(path)
  } catch {
    // Absence is the desired end state.
  }
}

/** Remove a directory tree, ignoring absence. */
export function removeTree(path) {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {
    // Absence is the desired end state.
  }
}

/**
 * Archive the experience log once it outgrows its line budget.
 *
 * The rule is the original finish step's: past 100 lines, the banner survives
 * and the most recent 40 lines stay in place; the middle moves to
 * `logs/archive/`. A byte ceiling backs it up, so a log of very long lines is
 * rotated too.
 *
 * @param paths - the layout table.
 * @returns the archive path when a rotation happened.
 */
export function rotateExperienceLog(paths) {
  if (!exists(paths.experienceLog)) return undefined
  const text = readText(paths.experienceLog, '')
  const lines = text.split('\n')
  const tooManyLines = lines.length > LOG_ROTATE_LIMIT_LINES
  const tooManyBytes = Buffer.byteLength(text, 'utf8') > LOG_MAX_BYTES
  if (!tooManyLines && !tooManyBytes) return undefined

  // Keep the file's banner and the newest entries; archive the rest.
  const banner = lines.slice(0, LOG_BANNER_LINES)
  const kept = lines.slice(-LOG_KEEP_LINES)
  const archived = lines.slice(LOG_BANNER_LINES, Math.max(LOG_BANNER_LINES, lines.length - LOG_KEEP_LINES))
  if (archived.length === 0) return undefined

  const month = new Date().toISOString().slice(0, 7)
  const target = join(paths.logArchive, `experience-log-${month}-${Date.now()}.md`)
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `${archived.join('\n')}\n`, 'utf8')
    writeTextAtomic(paths.experienceLog, `${[...banner, ...kept].join('\n')}`)
  } catch {
    return undefined
  }
  return target
}

/**
 * Append one line to the experience log, de-duplicating an immediate repeat.
 *
 * The original system's rule: a log exists so the user can reconstruct what the
 * system decided and why; a repeated identical tail line adds noise, not
 * history.
 *
 * @param paths - the layout table.
 * @param line - the line to append, without a trailing newline.
 * @returns the line when it was written, otherwise undefined.
 */
export function logExperience(paths, line) {
  const text = readText(paths.experienceLog, '')
  const tail = text.trimEnd().split('\n').pop()
  if (tail === line) return undefined
  rotateExperienceLog(paths)
  appendLine(paths.experienceLog, line)
  return line
}

/** `YYYY-MM-DD HH:MM` used by log prefixes. */
export function stamp(now = new Date()) {
  const iso = now.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

/**
 * Run one critical section under a cross-process lock.
 *
 * The lock is an exclusively-created file. A lock older than
 * {@link LOCK_STALE_MS} is treated as abandoned and taken over, which is what
 * makes a crash mid-write recoverable instead of permanently wedging the
 * collector. Waiting is bounded: when the lock cannot be taken the call is
 * skipped, because a skipped collection is retried from its cursor and a
 * blocked DSH process is not acceptable.
 *
 * @param paths - the layout table.
 * @param body - the critical section.
 * @returns the body's value, or undefined when the lock was busy.
 */
export async function withLock(paths, body) {
  const deadline = Date.now() + 5000
  let handle
  for (;;) {
    try {
      mkdirSync(dirname(paths.lock), { recursive: true })
      handle = openSync(paths.lock, 'wx')
      break
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      let age = 0
      try {
        age = Date.now() - statSync(paths.lock).mtimeMs
      } catch {
        continue
      }
      if (age > LOCK_STALE_MS) {
        removeFile(paths.lock)
        continue
      }
      if (Date.now() > deadline) return undefined
      await sleep(120)
    }
  }
  try {
    writeFileSync(handle, `${process.pid} ${new Date().toISOString()}\n`)
  } catch {
    // The lock's existence is what matters, not its contents.
  } finally {
    closeSync(handle)
  }
  try {
    return await body()
  } finally {
    removeFile(paths.lock)
  }
}

/** Await a fixed delay. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Take the sweep lock, which doubles as the sweep cooldown.
 *
 * Several DSH processes can be open at once, and a sweep calls a model per
 * session, so an in-process flag is not enough: the record carries the pid and
 * the start time, any process inside the cooldown window declines, and a lock
 * whose owner is gone (or whose record is too old) is taken over.
 *
 * @param paths - the layout table.
 * @param options - the timing knobs.
 * @param options.cooldownMs - the minimum gap between two sweeps.
 * @param options.staleMs - the age past which a lock is assumed abandoned.
 * @param now - the current time.
 * @returns true when this process now owns the sweep.
 */
export function acquireSweepLock(paths, { cooldownMs, staleMs }, now = Date.now()) {
  try {
    const record = JSON.parse(readText(paths.sweepLock, '{}'))
    const at = Number(record?.at ?? 0)
    const pid = Number(record?.pid ?? 0)
    if (Number.isFinite(at) && at > 0 && now - at < cooldownMs) return false
    if (Number.isFinite(pid) && pid > 0 && now - at < staleMs) {
      try {
        process.kill(pid, 0)
        return false
      } catch {
        // The owner is gone: an abandoned lock may be taken over.
      }
    }
  } catch {
    // No lock, or an unreadable one: the sweep may proceed.
  }
  try {
    writeTextAtomic(paths.sweepLock, `${JSON.stringify({ pid: process.pid, at: now })}\n`)
    return true
  } catch {
    return false
  }
}

/** Release the sweep lock. A failure never affects the sweep's result. */
export function releaseSweepLock(paths) {
  removeFile(paths.sweepLock)
}

/**
 * Snapshot one ledger file into `logs/archive/ledger-backup/`.
 *
 * `state.json` and `usage.json` change every turn and are deliberately kept out
 * of version control; the snapshot is what makes them recoverable after a bad
 * migration.
 *
 * @param paths - the layout table.
 * @param source - the ledger file to copy.
 * @param name - the backup file name.
 * @returns the backup path, or undefined when there was nothing to copy.
 */
export function snapshotLedger(paths, source, name) {
  if (!exists(source)) return undefined
  const target = join(paths.ledgerBackup, name)
  try {
    writeTextAtomic(target, readText(source, ''))
    return target
  } catch {
    return undefined
  }
}

/**
 * Keep one rejected draft for later inspection.
 *
 * A draft the collector refused is evidence about the model's behaviour, and
 * the original kept it under `logs/rejected-drafts/` rather than discarding it.
 *
 * @param paths - the layout table.
 * @param body - the file body.
 * @param now - the current time.
 * @returns the written path, or undefined on failure.
 */
export function writeRejectedDraft(paths, body, now = new Date()) {
  const target = join(paths.rejectedDrafts, `${now.getTime()}.md`)
  try {
    writeTextAtomic(target, body)
    return target
  } catch {
    return undefined
  }
}
