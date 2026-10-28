// Where a client's release-asset uploads may go, derived from the base URL the
// client was CONFIGURED with and never from response data.
//
// Asset uploads do not go to the API host. On github.com they go to
// `https://uploads.github.com`; on GitHub Enterprise Server, whose REST root is
// `https://<host>/api/v3`, they go to `https://<host>/api/uploads` (GitHub's
// GHES REST docs for "Upload a release asset"). `@octokit/plugin-rest-endpoint-
// methods` hard-codes the github.com host for this route and leaves GHES to
// the caller, which is how a GHES client once sent its token to github.com.

import type { Effect, Schema } from "effect";
import type { GitHubError } from "../GitHubError.js";

/** The upload host on github.com. @internal */
export const DOTCOM_UPLOADS_BASE_URL = "https://uploads.github.com";

/** The REST root on github.com, and the base of a client configured with none. @internal */
export const DOTCOM_API_BASE_URL = "https://api.github.com";
const GHES_REST_SUFFIX = "/api/v3";

/**
 * The release-asset upload channel of a client this package built: the base
 * URL it was configured with, and a module-private request function that
 * reaches the upload host derived from it.
 *
 * @remarks
 * The public request surface refuses every host but the configured API host,
 * so an upload to `uploads.github.com` cannot go through it. This is the one
 * way to that host, and only this package can name it: `upload` takes no
 * base URL, it derives the host from the configured base itself.
 *
 * @internal
 */
export interface UploadChannel {
	/** The base URL the client was configured with; `undefined` for github.com. */
	readonly baseUrl: string | undefined;
	/**
	 * One request to the upload host derived from `baseUrl`, decoded against
	 * `schema`. Refused, with nothing sent, when the route resolves anywhere else.
	 */
	readonly upload: <A, I>(
		route: string,
		params: Record<string, unknown>,
		schema: Schema.Codec<A, I>,
	) => Effect.Effect<A, GitHubError>;
}

/**
 * The upload channel, carried on the client shape under a key only this
 * package can name.
 *
 * @remarks
 * A symbol rather than a `WeakMap` keyed on the shape: a property survives a
 * consumer's `{ ...client, request: wrapped }` spread, a map entry does not.
 * It is not on `GitHubClientShape`, so the public surface does not grow, and a
 * module-private `Symbol` (not `Symbol.for`) cannot be forged from outside.
 */
const UPLOAD_CHANNEL: unique symbol = Symbol("@effected/github/uploadChannel");

interface Carrier {
	readonly [UPLOAD_CHANNEL]?: UploadChannel;
}

/**
 * Mark a client shape built by this package with its upload channel.
 *
 * @internal
 */
export const withUploadChannel = <S extends object>(shape: S, channel: UploadChannel): S =>
	Object.assign(shape, { [UPLOAD_CHANNEL]: channel });

/**
 * The upload channel of a client this package built, or `undefined` for a
 * shape built elsewhere (a hand-written double, `GitHubClient.makeTest`, a
 * fixture). A channel whose `baseUrl` is `undefined` means "built here, for
 * github.com", which is not the same as "not built here".
 *
 * @internal
 */
export const uploadChannelOf = (client: object): UploadChannel | undefined => (client as Carrier)[UPLOAD_CHANNEL];

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
