/**
 * Bounds on remote-feed traversal.
 *
 * A paginated GitHub listing is driven by a remote server's paging behaviour,
 * so an unbounded page loop is a denial-of-service surface: the v3 code
 * defaulted `maxPages` to `Number.POSITIVE_INFINITY`. Every listing is capped.
 *
 * @internal
 */

/** Items requested per page. GitHub's own maximum. */
export const DEFAULT_PER_PAGE = 100;

/** Pages fetched per listing unless the caller asks for fewer. */
export const DEFAULT_MAX_PAGES = 5;

/** Hard ceiling on pages, whatever the caller asks for. */
export const PAGE_CEILING = 100;
