/**
 * Bundled reference documents.
 *
 * The original installed its flow documentation into `$SE_ROOT/docs/` and the
 * flow read it from there, which is why its integrity check had to verify those
 * paths still existed. Inside a package the documents travel with the code, so
 * the paths are derived from the package directory and the flow is handed
 * absolute paths by the `brief` action rather than being told to guess a data
 * root. Nothing here is held in context: the flow reads a file only when the
 * brief says which one applies.
 *
 * @module dsh-self-evolution/lib/docs
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FLOW_SKILL_DIR } from 'dsh-self-evolution-skills/lib/skills.js'

/** Absolute directory of this package, which carries the bundled documents. */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Bundled reference docs, read on demand by the flow (never held in context). */
const DOCS_DIR = join(PACKAGE_DIR, 'docs')

/** Absolute paths of the reference material. */
export const DOCS = {
  candidateReview: join(DOCS_DIR, 'candidate-review.md'),
  skillHealth: join(DOCS_DIR, 'skill-health.md'),
  reportTemplate: join(DOCS_DIR, 'report-template.md'),
  stateLedger: join(DOCS_DIR, 'state-ledger.md'),
  flowSkill: join(FLOW_SKILL_DIR, 'SKILL.md'),
}
