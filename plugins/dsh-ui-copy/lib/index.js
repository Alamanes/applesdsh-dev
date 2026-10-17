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
 */

/** Host plugin body — no host-side behaviour. */
export function apply() {}
