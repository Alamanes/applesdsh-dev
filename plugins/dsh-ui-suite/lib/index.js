/**
 * dsh-ui-suite — a bundle row with no logic of its own.
 *
 * The host's own experimental bundles (`dsh-experimental-agent-team-profile` and
 * friends) are exactly this shape: an empty body, a `dsh.bundle.patch` that
 * inserts one row per component package, and the component packages declared as
 * dependencies. The plugin page then lists the bundle with one switchable
 * component per row.
 */

export {};
