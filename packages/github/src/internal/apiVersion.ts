// The REST api-version vocabulary, in a module that imports nothing.
//
// `GitHubClient` pins it on every octokit request; `GitHubUserAuth` pins it on
// the grant-revoke call it sends through a bare `fetch`. Keeping the constant
// here rather than in `internal/octokit.ts` is what lets `GitHubUserAuth`
// share it without linking octokit.

/**
 * The REST api-version a client pins when its options name none.
 *
 * @internal
 */
export const DEFAULT_API_VERSION = "2026-03-10";

/**
 * A calendar api-version: `YYYY-MM-DD`.
 *
 * @internal
 */
export const API_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
