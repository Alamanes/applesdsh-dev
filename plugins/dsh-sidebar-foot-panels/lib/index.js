/**
 * Host half of dsh-sidebar-foot-panels.
 *
 * The row exists so the Loader has a host-side entry to hang the browser bundle
 * off (`exports["./client"]`, resolved by the client-modules host scan). Every
 * behavior lives in the browser half, which registers into the sidebar's own
 * `sidebar.footer.action` slot and hides the two shipped panel rows in the DOM.
 *
 * Nothing is declared here on purpose: no configuration, no host hooks, and no
 * imports, so the row cannot fail to load for a missing dependency.
 */

/** Cordis plugin name; keep it equal to the loading row's id so diagnostics agree. */
export const name = 'sidebar-foot-panels'

/** Host plugin body — empty, because the sidebar reshape is page-side only. */
export function apply() {}
