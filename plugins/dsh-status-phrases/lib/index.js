/**
 * dsh-status-phrases — host half.
 *
 * The plugin is almost entirely a browser-half concern: it rewrites the turn
 * status line. The host half exists for one reason — the configuration box.
 *
 * The settings seam projects an entry row for every active profile entry whose
 * `Config` declares volatile fields, and the browser half reads and writes that
 * row through `ctx.configForms.get('dsh-status-phrases')`. Declaring `phrases`
 * volatile is therefore what makes the single box in Settings → General
 * possible; a plain (non-volatile) field would be read-only from the page.
 *
 * The value is one multi-line string, not a list: one phrase per line. The
 * browser half splits it, so the box stays a single text field and the stored
 * document stays human-editable.
 *
 * @module dsh-status-phrases
 */

import Schema from '@deepseek-ai/schemastery'

/** Cordis plugin name; keep it equal to the package name so diagnostics agree. */
export const name = 'status-phrases'

/**
 * Declared configuration.
 *
 * `phrases` holds the whole phrase list, one phrase per line. It is volatile so
 * the Settings → General box can edit it; leaving it unset means "use the
 * browser half's built-in list" rather than "show nothing".
 */
export const Config = Schema.object({
	phrases: Schema.string().volatile(),
})

/**
 * Activate the host half.
 *
 * Everything the plugin does to the page happens in the browser half, which is
 * mounted from the boot graph rather than from this function, so there is
 * nothing to wire up here.
 */
export function apply() {}
