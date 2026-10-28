// Where a client's release-asset uploads may go, derived from the base URL the
// client was CONFIGURED with and never from response data.
//
// Asset uploads do not go to the API host. On github.com they go to
// `https://uploads.github.com`; on GitHub Enterprise Server, whose REST root is
// `https://<host>/api/v3`, they go to `https://<host>/api/uploads` (GitHub's
// GHES REST docs for "Upload a release asset"). `@octokit/plugin-rest-endpoint-
// methods` hard-codes the github.com host for this route and leaves GHES to
// the caller, which is how a GHES client once sent its token to github.com.

/** The upload host on github.com. @internal */
export const DOTCOM_UPLOADS_BASE_URL = "https://uploads.github.com";

const DOTCOM_API_BASE_URL = "https://api.github.com";
const GHES_REST_SUFFIX = "/api/v3";

/**
 * The configured base URL, carried on the client shape under a key only this
 * package can name.
 *
 * @remarks
 * A symbol rather than a `WeakMap` keyed on the shape: a property survives a
 * consumer's `{ ...client, request: wrapped }` spread, a map entry does not.
 * It is not on `GitHubClientShape`, so the public surface does not grow, and a
 * module-private `Symbol` (not `Symbol.for`) cannot be forged from outside.
 */
const CONFIGURED_BASE_URL: unique symbol = Symbol("@effected/github/configuredBaseUrl");

interface Carrier {
	readonly [CONFIGURED_BASE_URL]?: { readonly baseUrl: string | undefined };
}

/**
 * Mark a client shape built by this package with the base URL it was built for.
 *
 * @internal
 */
export const withConfiguredBaseUrl = <S extends object>(shape: S, baseUrl: string | undefined): S =>
	Object.assign(shape, { [CONFIGURED_BASE_URL]: { baseUrl } });

/**
 * The base URL a client was configured with, as `{ baseUrl }` when this
 * package built it, or `undefined` for a shape built elsewhere (a hand-written
 * double, `GitHubClient.makeTest`, a fixture). `{ baseUrl: undefined }` means
 * "built here, for github.com", which is not the same as "not built here".
 *
 * @internal
 */
export const configuredBaseUrlOf = (client: object): { readonly baseUrl: string | undefined } | undefined =>
	(client as Carrier)[CONFIGURED_BASE_URL];

/** `url` with every trailing slash removed — a loop, not a regex. */
const trimTrailingSlashes = (url: string): string => {
	let end = url.length;
	while (end > 0 && url.charCodeAt(end - 1) === 47) end--;
	return url.slice(0, end);
};

/**
 * The release-asset upload base for a configured REST base URL.
 *
 * @remarks
 * - absent, or `https://api.github.com` → `https://uploads.github.com`;
 * - a GHES root `https://<host>/api/v3` → `https://<host>/api/uploads`;
 * - anything else (a proxy, a test server) → the configured base itself, so
 *   the token still only goes to the host the caller configured.
 *
 * @internal
 */
export const uploadsBaseUrlFor = (baseUrl: string | undefined): string => {
	if (baseUrl === undefined) return DOTCOM_UPLOADS_BASE_URL;
	const trimmed = trimTrailingSlashes(baseUrl);
	if (trimmed === DOTCOM_API_BASE_URL) return DOTCOM_UPLOADS_BASE_URL;
	if (trimmed.endsWith(GHES_REST_SUFFIX)) return `${trimmed.slice(0, -GHES_REST_SUFFIX.length)}/api/uploads`;
	return trimmed;
};

/**
 * The origin of `url`, or `undefined` when it does not parse as an absolute URL.
 *
 * @internal
 */
export const originOf = (url: string): string | undefined => {
	try {
		return new URL(url).origin;
	} catch {
		return undefined;
	}
};
