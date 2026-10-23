/**
 * Suite self-check.
 *
 * Verifies the pieces that the bundler cannot: that every component file obeys
 * the contract, that no migrated file still reads a shipped `--dsw-*` token
 * directly, and that the built bundle defines the factory the registry names.
 *
 * Usage: `node scripts/verify.mjs` — exits non-zero with a list of problems.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const notes = []

function read(path) {
  return readFileSync(join(ROOT, path), 'utf8')
}

function list(dir) {
  try {
    return readdirSync(join(ROOT, dir)).sort()
  } catch {
    return []
  }
}

/** `30-session-delete.js` -> `session_deleted` factory suffix. */
function factoryOf(file) {
  return `dshuiComponent_${file.replace(/^\d+[-_]/, '').replace(/\.js$/, '').replace(/-/g, '_')}`
}

/* ---- components ------------------------------------------------------- */

const components = list('src/components').filter((file) => file.endsWith('.js'))
if (components.length === 0) problems.push('src/components/ has no component files')

for (const file of components) {
  const path = `src/components/${file}`
  const source = read(path)
  const factory = factoryOf(file)

  if (!source.includes(`function ${factory}(`)) problems.push(`${path}: missing \`function ${factory}(rt)\``)
  if (/(^|\n)\s*(import|export)\s/.test(source)) problems.push(`${path}: must be classic script, not ESM`)
  if (source.includes('__ModuleLoader__.load')) problems.push(`${path}: must not load itself`)
  if (source.includes('new MutationObserver')) problems.push(`${path}: use rt.observe instead of its own observer`)
  if (/document\.head\.appendChild/.test(source)) problems.push(`${path}: use rt.style instead of appending <style>`)
  // The accent component repaints the shipped token families on purpose, so a
  // user-picked accent also reaches the host's own buttons; it is the one
  // component allowed to name a `--dsw-*` token.
  // A mention inside a comment is documentation, not a token read; only live
  // code counts.
  const codeOnly = source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
  if (file !== '10-copy.js' && /--dsw-/.test(codeOnly)) {
    problems.push(`${path}: still reads a shipped --dsw-* token`)
  }

  // A migrated body can keep the bundle's lowercase `react.useState` while the
  // guard above binds `React`; node --check cannot see that, and the panel only
  // fails the moment it opens. Catch the mismatch statically.
  for (const binding of ['react', 'React']) {
    const used = new RegExp(`(^|[^\\w.$])${binding}\\.`, 'm').test(source)
    const declared = new RegExp(`(const|let|var)\\s+${binding}\\s*=`).test(source)
    if (used && !declared) problems.push(`${path}: uses \`${binding}.\` but never declares it`)
  }

  try {
    execFileSync(process.execPath, ['--check', join(ROOT, path)], { stdio: 'pipe' })
  } catch (error) {
    problems.push(`${path}: node --check failed\n${String(error.stderr ?? error.stdout ?? error)}`)
  }
}

/* ---- host halves ------------------------------------------------------ */

const hosts = list('lib/host').filter((file) => file.endsWith('.js'))
for (const file of hosts) {
  const path = `lib/host/${file}`
  const source = read(path)
  if (!/export const KEY = '\w+'/.test(source)) problems.push(`${path}: missing \`export const KEY\``)
  if (!/export (function|const) apply\b/.test(source)) problems.push(`${path}: missing an exported \`apply\``)
  if (/--dsw-/.test(source)) problems.push(`${path}: still reads a shipped --dsw-* token`)
}

/* ---- stylesheets ------------------------------------------------------ */

const sheets = list('lib/styles').filter((file) => file.endsWith('.css'))
if (!sheets.includes('tokens.css')) problems.push('lib/styles/tokens.css is missing')
for (const file of sheets) {
  if (file === 'tokens.css') continue
  const source = read(`lib/styles/${file}`)
  const codeOnly = source
    .split('\n')
    .filter((line) => !/^\s*(\/\*|\*)/.test(line))
    .join('\n')
  const stale = codeOnly.match(/--dsw-[a-z0-9-]+/g)
  if (stale !== null) {
    const unique = [...new Set(stale)]
    problems.push(`lib/styles/${file}: ${unique.length} shipped token(s) left: ${unique.slice(0, 6).join(', ')}`)
  }
  notes.push(`${file}: ${(source.match(/var\(--dshui-[a-z0-9-]+\)/g) ?? []).length} token reads`)
}

/* ---- the built bundle ------------------------------------------------- */

const built = existsSync(join(ROOT, 'lib/client.js')) ? read('lib/client.js') : ''
if (built === '') problems.push('lib/client.js is missing; run `node scripts/build.mjs`')
for (const file of components) {
  const factory = factoryOf(file)
  if (built !== '' && !built.includes(`function ${factory}(`)) problems.push(`lib/client.js: ${factory} not bundled`)
  if (built !== '' && !built.includes(`'${file.replace(/^\d+[-_]/, '').replace(/\.js$/, '')}'`)) {
    problems.push(`lib/client.js: ${file} has no registry row`)
  }
}

/* ---- the host entry --------------------------------------------------- */

const hostEntry = read('lib/index.js')
for (const file of hosts) {
  const spec = `./host/${file}`
  if (!hostEntry.includes(spec)) problems.push(`lib/index.js: host module ${spec} is not imported`)
}

/* ---- report ----------------------------------------------------------- */

for (const note of notes) console.log(`  ${note}`)
if (problems.length === 0) {
  console.log(`\n  ${components.length} components, ${hosts.length} host halves, ${sheets.length} sheets: all checks passed`)
  process.exit(0)
}
console.error(`\n  ${problems.length} problem(s):`)
for (const problem of problems) console.error(`  - ${problem}`)
process.exit(1)
