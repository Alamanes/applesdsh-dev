/**
 * Host half of dsh-ui-copy.
 *
 * This row contributes browser presentation only; the empty `apply` gives the
 * Loader a host-side row while the browser half ships through
 * `exports["./client"]`, exactly as the shipped brand package does.
 *
 * The bundle's second component is `exports["./ask"]`, which owns the ask
 * surface stylesheet. Splitting them into two rows of one package keeps them
 * separately switchable in the plugin page without splitting the package.
 *
 * The one host-side duty is the configuration declaration. The settings seam
 * projects a Settings → General row for every active profile entry whose
 * `Config` declares volatile fields, and a volatile field is read and written
 * from the page through `ctx.configForms.get('ui-copy')`; a plain field would
 * be read-only there. `accent.light` and `accent.dark` are the two colours the
 * browser half paints the accent tokens with, one per theme, and declaring them
 * volatile is what makes the accent box in Settings possible at all.
 */

import Schema from '@deepseek-ai/schemastery'

/** Cordis plugin name; keep it equal to the loading row's id so diagnostics agree. */
export const name = 'ui-copy'

/**
 * Declared configuration.
 *
 * `accent` holds one colour per theme. An empty string means "leave the shipped
 * colour alone", so an entry that configures nothing changes nothing; a colour
 * that is not a hex value still paints, it only loses the derived ink and hover
 * shades that have to be measured here.
 */
export const Config = Schema.object({
  accent: Schema.object({
    light: Schema.string().volatile(),
    dark: Schema.string().volatile(),
  }),
})

/** Host plugin body — every behaviour lives in the browser half. */
export function apply() {}
