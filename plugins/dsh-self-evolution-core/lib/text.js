/**
 * Pure text helpers, ported from the original `evolution-core.ts`.
 *
 * Everything here is deterministic and side-effect free: the collector's
 * decisions that can be made without a model are made here, so no tokens are
 * spent on them.
 *
 * The credential masking and the private-path matcher are the two load-bearing
 * pieces. A trace leaves the machine for a cheap third-party model, so secrets
 * are masked and private paths abort the whole session — neither is advisory.
 *
 * @module dsh-self-evolution-core/lib/text
 */

/**
 * Default privacy patterns; the original list, unchanged.
 *
 * Two forms carry meaning for the matcher: `*.ext` matches any path segment
 * ending in that extension, a leading `.` matches that exact file or any
 * `<name>.<ext>`, and anything else is a substring of a path segment.
 */
export const DEFAULT_PRIVATE_PATTERNS = [
  'diary',
  '.env',
  '.ssh',
  'auth.json',
  '.npmrc',
  '.netrc',
  '.pgpass',
  '.my.cnf',
  'hosts.yml',
  'git-credentials',
  'id_rsa',
  'id_ed25519',
  '.pem',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'credential',
  'password',
  'passwd',
  'wallet',
  'keychain',
  'private_key',
  'privatekey',
  'secrets.',
]

/**
 * Resolve the privacy pattern list.
 *
 * `SE_PRIVATE_PATTERNS` is **appended** to the built-in list rather than
 * replacing it: replacement semantics once let a single custom pattern drop
 * every built-in protection.
 *
 * @param envValue - the raw `SE_PRIVATE_PATTERNS` value, if any.
 * @returns the effective patterns.
 */
export function privatePatterns(envValue) {
  const fromEnv = String(envValue ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
  const all = [...DEFAULT_PRIVATE_PATTERNS, ...fromEnv].map((part) => String(part).toLowerCase())
  return [...new Set(all)]
}

/**
 * Argument keys whose whole value is a file path.
 *
 * A value under one of these is a path even without a separator, which is the
 * only way a relative `Diary.md` is recognised at all.
 */
const PATH_ARG_KEYS = new Set([
  'path',
  'file',
  'filepath',
  'filename',
  'dir',
  'directory',
  'cwd',
  'target',
  'source',
  'src',
  'dest',
  'destination',
  'folder',
])

/** Path-shaped tokens: they contain `/` or start with `~`. */
const PATH_TOKEN_RE = /~?\/[\w.~][\w.~+\-@]*(\/[\w.~][\w.~+\-@]*)*/g

/**
 * Every file path one trace window actually touched.
 *
 * Only action evidence counts: the arguments of tool calls, never user or
 * assistant prose. Matching prose was the old behaviour and it broke on
 * ordinary text — `process.env` tripped the `.env` pattern, and a search
 * pattern or a CLI help string did too. A free-text argument (a shell command)
 * contributes only its path-shaped tokens for the same reason.
 *
 * @param entries - the window's records.
 * @param limit - the maximum number of paths collected.
 * @returns the collected paths.
 */
export function extractToolPaths(entries, limit = 2000) {
  const out = []
  const push = (value) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (trimmed.length === 0 || trimmed.length > 500 || out.length >= limit) return
    out.push(trimmed)
  }
  for (const entry of entries ?? []) {
    if (entry === null || typeof entry !== 'object') continue
    const args = entry.toolCall !== null && typeof entry.toolCall === 'object' ? entry.toolCall.args : undefined
    if (args !== null && typeof args === 'object') {
      for (const [key, value] of Object.entries(args)) {
        if (typeof value !== 'string') continue
        if (PATH_ARG_KEYS.has(String(key).toLowerCase())) {
          push(value)
          continue
        }
        PATH_TOKEN_RE.lastIndex = 0
        let match = PATH_TOKEN_RE.exec(value)
        while (match !== null) {
          push(match[0])
          match = PATH_TOKEN_RE.exec(value)
        }
      }
    }
    if (typeof entry.command === 'string' && entry.command.length > 0) {
      PATH_TOKEN_RE.lastIndex = 0
      let match = PATH_TOKEN_RE.exec(entry.command)
      while (match !== null) {
        push(match[0])
        match = PATH_TOKEN_RE.exec(entry.command)
      }
    }
    if (out.length >= limit) break
  }
  return out
}

/**
 * Whether any tool path in the window matches a private pattern.
 *
 * @param entries - the window's records.
 * @param patterns - raw pattern strings.
 * @returns true when the window must not leave the machine.
 */
export function windowTouchesPrivatePath(entries, patterns) {
  const paths = extractToolPaths(entries)
  if (paths.length === 0) return false
  const list = (patterns ?? []).map((pattern) => String(pattern).toLowerCase()).filter(Boolean)
  if (list.length === 0) return false
  for (const raw of paths) {
    const segments = String(raw).toLowerCase().split('/').filter(Boolean)
    if (segments.length === 0) continue
    for (const pattern of list) {
      if (pattern.startsWith('*.')) {
        if (segments.some((segment) => segment.endsWith(pattern.slice(1)))) return true
      } else if (pattern.startsWith('.')) {
        if (segments.some((segment) => segment === pattern || segment.startsWith(`${pattern}.`))) return true
      } else if (segments.some((segment) => segment.includes(pattern))) {
        return true
      }
    }
  }
  return false
}

/**
 * Credential, token and email shapes to mask before a trace leaves the machine.
 *
 * The label is what the text is replaced with, so a masked trace still says
 * what kind of value stood there.
 */
export const SECRET_PATTERNS = [
  { label: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { label: 'openai', re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { label: 'github', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g },
  { label: 'github_pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { label: 'aws', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { label: 'slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { label: 'google', re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { label: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g },
  { label: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi },
  // The scheme word of a header (Basic, Digest) is shorter than any
  // token-length rule would accept, so the whole value goes.
  { label: '授权头', re: /\bAuthorization\s*[:=][^\n]*/gi },
  {
    label: '凭证赋值',
    re: /\b(?:api[_-]?key|access[_-]?key|secret|stoken|token|cookie|passwd|password|passphrase|credential)s?\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{6,}["']?/gi,
  },
  { label: '邮箱', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
]

/**
 * High-confidence credential shapes, recognised by their prefix.
 *
 * These are strong enough to abort a whole session, so the list stays narrow:
 * ordinary prose must not trip it.
 */
export const HARD_SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
]

/** Mask every credential, token and email address found in the text. */
export function maskSecrets(text) {
  return maskSecretsWithCount(text).text
}

/** Same as {@link maskSecrets}, plus how many replacements were made. */
export function maskSecretsWithCount(text) {
  if (!text) return { text, masked: 0 }
  let out = text
  let masked = 0
  for (const { label, re } of SECRET_PATTERNS) {
    out = out.replace(re, () => {
      masked += 1
      return `[已隐去:${label}]`
    })
  }
  return { text: out, masked }
}

/** Whether the text carries a high-confidence credential shape. */
export function containsHardSecret(text) {
  if (!text) return false
  return HARD_SECRET_PATTERNS.some((re) => re.test(text))
}

/**
 * Scan one trace window for high-confidence credentials.
 *
 * The path breaker covers what was touched; this covers what was written into
 * the conversation itself.
 *
 * @param entries - the window's records.
 * @returns true when the window must not be sent anywhere.
 */
export function touchesHardSecretText(entries) {
  for (const entry of entries ?? []) {
    if (entry === null || typeof entry !== 'object') continue
    if (typeof entry.text === 'string' && containsHardSecret(entry.text)) return true
    if (typeof entry.command === 'string' && containsHardSecret(entry.command)) return true
    const call = entry.toolCall
    if (call !== null && typeof call === 'object') {
      try {
        if (containsHardSecret(JSON.stringify(call.args ?? {}))) return true
      } catch {
        // A non-serialisable argument cannot be scanned; nothing is sent either.
      }
    }
  }
  return false
}

/**
 * Redact a trace before it is embedded in a prompt.
 *
 * Home paths collapse to `~` and credentials and emails are masked: the summary
 * goes to a cheap third-party model, and neither belongs there.
 *
 * @param text - the text to sanitize.
 * @param home - the home directory to collapse, if any.
 * @returns the sanitized text.
 */
export function sanitizeTraceText(text, home) {
  if (!text) return text
  const masked = maskSecrets(text)
  const base = typeof home === 'string' && home.length > 1 ? home : process.env.HOME
  if (typeof base !== 'string' || base.length <= 1) return masked
  return masked.split(base).join('~')
}

/**
 * Replace the home directory with `~`.
 *
 * @param text - the text to scrub.
 * @returns the scrubbed text.
 */
export function scrubHome(text) {
  return sanitizeTraceText(text, process.env.HOME)
}

/** Collapse one value to a lowercase hyphen slug usable as a directory name. */
export function slugify(value) {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug
}

/**
 * Whether a slug is a legal candidate/skill directory name.
 *
 * The original format rule (`name`: lowercase letters, digits, hyphens) is
 * enforced mechanically so a malformed draft never reaches the review queue.
 */
export function isLegalSlug(value) {
  return typeof value === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && value.length <= 64
}

/** Strip one surrounding ``` fence from a model answer, keeping the body. */
export function stripOuterFence(value) {
  const text = String(value ?? '').trim()
  const match = /^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n?```$/.exec(text)
  return match ? match[1] : text
}

/**
 * Detect a SKIP reply and return its stated reason, or null when the reply is a
 * real draft.
 *
 * Models pad the marker in ways a bare `startsWith('SKIP:')` misses: a fence, a
 * leading blank line, a list dash, quotes or bold markers. Only the first
 * non-empty line counts.
 *
 * @param raw - the model's answer.
 * @returns the reason, or null.
 */
export function parseSkipDraft(raw) {
  if (!raw || typeof raw !== 'string') return null
  const text = stripOuterFence(raw).trim()
  for (const line of text.split('\n')) {
    const cleaned = line.trim().replace(/^[-*#>\s"'`]+/, '').trim()
    if (!cleaned) continue
    if (/^skip\s*[:：]/i.test(cleaned)) {
      return cleaned
        .replace(/^skip\s*[:：]\s*/i, '')
        .replace(/[*"'`]+$/, '')
        .trim()
    }
    return null
  }
  return null
}

/**
 * Extract readable text from any content shape.
 *
 * The collector accepts a plain string, an array of content blocks, or an
 * object with a `text` field, so one normalizer serves every event shape the
 * harness may hand it.
 *
 * @param content - the raw content.
 * @returns the concatenated visible text.
 */
export function extractText(content) {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = []
    for (const block of content) {
      if (typeof block === 'string') parts.push(block)
      else if (block !== null && typeof block === 'object' && typeof block.text === 'string') parts.push(block.text)
    }
    return parts.join('\n')
  }
  if (typeof content === 'object' && typeof content.text === 'string') return content.text
  return ''
}

/** Whether a value carries no usable content. */
export function isBlank(value) {
  return typeof value !== 'string' || value.trim().length === 0
}

/**
 * Similarity of two strings in `0..1`.
 *
 * A bounded Levenshtein ratio, standing in for the original preflight's
 * `difflib.SequenceMatcher.ratio()`. The thresholds it feeds (0.8 on slugs,
 * 0.55 on descriptions) are advisory warnings either way, so a near-equivalent
 * metric is enough to flag a case for a human read.
 *
 * @param left - first string.
 * @param right - second string.
 * @returns the similarity ratio.
 */
export function similarity(left, right) {
  const a = String(left ?? '')
  const b = String(right ?? '')
  if (a.length === 0 && b.length === 0) return 1
  if (a.length === 0 || b.length === 0) return 0
  const longest = Math.max(a.length, b.length)
  if (longest > 2000) return a === b ? 1 : 0
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
    }
    previous = current
  }
  return 1 - previous[b.length] / longest
}
