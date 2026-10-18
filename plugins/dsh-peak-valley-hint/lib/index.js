/**
 * Host half of dsh-peak-valley-hint.
 *
 * The row exists so the Loader has a host-side entry to hang the browser bundle
 * off (`exports["./client"]`, resolved by the client-modules host scan). The
 * whole plugin is page-side: the peak/valley clock is arithmetic on the local
 * clock, so there is no host work to do and nothing to configure.
 *
 * Nothing is declared here on purpose: no configuration, no host hooks, and no
 * imports, so the row cannot fail to load for a missing dependency.
 */

/** Cordis plugin name; keep it equal to the loading row's id so diagnostics agree. */
export const name = 'peak-valley-hint'

/** Host plugin body — empty, because the hint is page-side only. */
export function apply() {}
