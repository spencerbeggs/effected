/**
 * Shared hardening limits for the resolution and fetch machinery.
 *
 * The inputs these bound are untrusted: `exports` / `typesVersions` maps and
 * file trees arrive as JSON fetched from a CDN. Every independent recursive
 * surface imports its guard from this zero-dependency leaf so the caps stay
 * in parity across the package (the `@effected/yaml` / `@effected/jsonc`
 * precedent).
 */

/**
 * Cap on collection-nesting depth for every recursive walk over untrusted
 * input. The cross-package parity constant.
 */
export const MAX_NESTING_DEPTH = 256;

/**
 * Cap on `*` wildcards per exports/typesVersions pattern before regex
 * compilation. npm semantics use exactly one wildcard; a pattern exceeding
 * the bound simply does not match (ReDoS guard — the glob CVE precedent).
 */
export const MAX_WILDCARDS_PER_PATTERN = 1;

/**
 * Cap on declaration files materialized per package by `getTypeFiles`. A
 * pathological or hostile file tree naming more declaration files than this
 * fails typed rather than exhausting memory.
 */
export const MAX_TYPE_FILES_PER_PACKAGE = 5_000;

/**
 * Cap on total downloaded declaration bytes per package, checked as the
 * downloads accumulate. The yaml alias-budget lesson applied to downloads:
 * budget the materialization, not just the input's static size claims.
 */
export const MAX_TYPE_BYTES_PER_PACKAGE = 64 * 1024 * 1024;
