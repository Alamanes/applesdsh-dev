/**
 * Node half of the sidebar Plugins entry.
 *
 * This package contributes browser presentation only; the empty `apply` gives
 * the Loader a host-side row while the browser half ships through
 * `exports["./client"]`, exactly as the shipped brand package does.
 */

/** Host plugin body — no host-side behaviour. */
function apply() {}

export { apply }
