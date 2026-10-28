// The token-confinement rules of the raw request surface (`request`,
// `requestDecoded`, `paginate`, `paginateStream`), written once.
//
// The live transport (`internal/octokit.ts`) applies them before it sends, and
// the shipped doubles (`GitHubClient.makeTest`, `GitHubClient.layerFixture`)
// apply the same functions before they answer, so a consumer's suite on a
// double sees exactly the refusals production would raise. There is no second
// copy of the rules: a double that skipped them would let a test pass a call
// the real client refuses.

import { GitHubError } from "../GitHubError.js";
import { reservedRawParam } from "./requestOptions.js";
import { originOf } from "./uploads.js";

/**
 * Expand a route and its parameters into the request octokit would send —
 * template expansion, an absolute route and the base URL all applied. Only the
 * `url` is read.
 *
 * @internal
 */
export type ExpandRoute = (route: string, params: Record<string, unknown>) => { readonly url: string };

/**
 * Why one of the caller's parameters may not be sent, or `undefined`.
 *
 * @remarks
 * Checked against the CALLER's parameters, before anything the transport adds
 * (`per_page`, a signal, the upload base): `baseUrl` and `url` move the host,
 * `request` swaps the fetch, `method` rewrites the verb.
 *
 * @internal
 */
export const reservedParamReason = (params: Record<string, unknown>): string | undefined => {
	for (const key of Object.keys(params)) {
		const reason = reservedRawParam(key);
		if (reason !== undefined) return `the parameter "${key}" ${reason}`;
	}
	return undefined;
};

/**
 * Why `route` with `params` may not be sent to the origin `allowed`, or
 * `undefined` when it may.
 *
 * @remarks
 * The URL checked is the one `expand` builds, which is the one octokit itself
 * would send, so no spelling of the route reaches a host this check did not
 * see.
 *
 * @internal
 */
export const routeReason = (
	expand: ExpandRoute,
	route: string,
	params: Record<string, unknown>,
	allowed: string | undefined,
): string | undefined => {
	let url: string;
	try {
		url = expand(route, params).url;
	} catch {
		return "the route does not expand to a URL";
	}
	if (allowed === undefined) return "the configured base URL is not an absolute URL";
	const origin = originOf(url);
	return origin === allowed
		? undefined
		: `the route resolves to ${origin ?? "a URL that does not parse"}, not the configured host ${allowed}; refusing to send the token there`;
};

/**
 * Why a raw-surface call may not be sent to `allowed`, or `undefined`: a
 * reserved parameter first, then the route's resolved origin.
 *
 * @internal
 */
export const rawRequestRefusal = (
	expand: ExpandRoute,
	route: string,
	params: Record<string, unknown>,
	allowed: string | undefined,
): string | undefined => reservedParamReason(params) ?? routeReason(expand, route, params, allowed);

/**
 * The error a refused call fails with: `kind: "rejected"`, no status.
 *
 * @internal
 */
export const refusedRequest = (operation: string, reason: string): GitHubError =>
	new GitHubError({ kind: "rejected", operation, reason });
