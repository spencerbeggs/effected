import { Octokit } from "@octokit/core";
import { composePaginateRest } from "@octokit/plugin-paginate-rest";
import type { OctokitResponse } from "@octokit/types";
import { Clock, Effect, Option, Redacted, Ref } from "effect";
import { GitHubError, readRateLimitHeaders } from "../GitHubError.js";
import { GitHubGraphQLError } from "../GraphQL.js";
import type { RetryPolicy, RetryableFailure } from "../Resilience.js";
import { RateLimitSnapshot } from "../Resilience.js";
import type { PageSource } from "./paginate.js";
import { reservedRawParam } from "./requestOptions.js";
import { DOTCOM_API_BASE_URL, originOf } from "./uploads.js";

/**
 * The one place `@octokit/core` is constructed, and the one place its
 * throwables become typed errors.
 *
 * @remarks
 * `@octokit/rest` is deliberately **not** used. Route-keyed typing comes from
 * `@octokit/types`' generated `Endpoints` map, which `@octokit/core`'s `request`
 * already consumes; the rest wrapper would add `plugin-request-log` (which this
 * package would immediately have to silence) plus a second, 1.4 MB spelling of
 * the same endpoint types.
 *
 * @internal
 */

/** How a transport is built. */
export interface TransportOptions {
	/**
	 * The bearer credential. Absent means **unauthenticated**, which GitHub
	 * serves at 60 requests per hour per IP — the only call that legitimately
	 * wants it is the bot-user lookup, which rejects an app JWT.
	 */
	readonly token?: Redacted.Redacted<string> | undefined;
	readonly retry: RetryPolicy;
	readonly baseUrl?: string | undefined;
	readonly userAgent?: string | undefined;
	readonly fetch?: typeof globalThis.fetch | undefined;
	/** The `x-github-api-version` every request carries unless the call sets its own. */
	readonly apiVersion: string;
}

/** The REST api-version a client pins when its options name none. */
export const DEFAULT_API_VERSION = "2026-03-10";

/** What a client layer holds. */
export interface Transport {
	/**
	 * One request to the configured API host: retried, classified, with its
	 * rate-limit headers recorded. Refused, with nothing sent, when `route` and
	 * `params` resolve to any other origin or carry a reserved request option.
	 */
	readonly request: <A>(
		operation: string,
		route: string,
		params: Record<string, unknown>,
	) => Effect.Effect<OctokitResponse<A>, GitHubError>;
	/**
	 * `request` against `baseUrl` instead of the configured base, confined to
	 * `baseUrl`'s origin. For the release-asset upload channel only, whose host
	 * is derived from the configured base.
	 */
	readonly requestAt: <A>(
		operation: string,
		route: string,
		params: Record<string, unknown>,
		baseUrl: string,
	) => Effect.Effect<OctokitResponse<A>, GitHubError>;
	/**
	 * A single-use page cursor over a paginating route, confined to the
	 * configured API host: a first page or a `Link` next page on any other
	 * origin fails the walk `rejected` before it is requested.
	 */
	readonly pageSource: <A>(operation: string, route: string, params: Record<string, unknown>) => PageSource<A>;
	/** One GraphQL call: retried and classified. */
	readonly graphql: (
		operation: string,
		document: string,
		variables: Record<string, unknown>,
	) => Effect.Effect<unknown, GitHubGraphQLError>;
	/** The most recent rate-limit headers seen, if any. */
	readonly rateLimit: Effect.Effect<Option.Option<RateLimitSnapshot>>;
}

const SILENT_LOG = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

/**
 * Build the octokit instance.
 *
 * @remarks
 * `auth` takes the raw token string. `@octokit/auth-token` inspects it and
 * emits `bearer` for a three-segment JWT and `token` otherwise — exactly the
 * distinction an app JWT and an installation token need, so the App path
 * requires no separate auth strategy.
 *
 * `log` is silenced. Retries log through `Effect.logDebug`, and an application
 * maps Effect's logs to whatever its runtime wants, so no GitHub Actions
 * knowledge lives in this client.
 */
const makeOctokit = (options: TransportOptions): Octokit => {
	const octokit = new Octokit({
		// The one deliberate unwrap in this package: octokit needs the string.
		// Nothing downstream re-exposes it — errors, spans and logs never carry it.
		...(options.token !== undefined ? { auth: Redacted.value(options.token) } : {}),
		...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
		...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
		...(options.fetch !== undefined ? { request: { fetch: options.fetch } } : {}),
		log: SILENT_LOG,
	});
	// octokit's constructor takes no default headers, so the pin rides a
	// `before` hook. By the time it runs the call's own headers are merged in
	// (lowercased), so a per-call `x-github-api-version` — the attestation
	// routes set one — is left alone. Every surface goes through this hook:
	// request, the paginator and GraphQL, which ignores the header.
	octokit.hook.before("request", (request) => {
		request.headers["x-github-api-version"] ??= options.apiVersion;
	});
	return octokit;
};

/**
 * Build a transport over a freshly constructed octokit instance.
 *
 * @remarks
 * The rate-limit cell lives here, in the closure of the layer that writes it,
 * so the writer and the reader can never see different cells.
 */
export const makeTransport = (options: TransportOptions): Effect.Effect<Transport> =>
	Effect.gen(function* () {
		const octokit = makeOctokit(options);
		const snapshot = yield* Ref.make(Option.none<RateLimitSnapshot>());
		const policy = options.retry;

		const record = (headers: Readonly<Record<string, unknown>> | undefined): Effect.Effect<void> => {
			const parsed = readRateLimitHeaders(headers);
			return parsed === undefined ? Effect.void : Ref.set(snapshot, Option.some(RateLimitSnapshot.make(parsed)));
		};

		/**
		 * Run one promise-producing call, classifying whatever it throws.
		 *
		 * @remarks
		 * The `AbortSignal` `Effect.tryPromise` supplies is threaded into octokit's
		 * `request.signal`, so interrupting the fiber aborts the in-flight HTTP
		 * request rather than leaving it running unobserved.
		 */
		const attempt = <A, E>(
			call: (signal: AbortSignal) => Promise<A>,
			classify: (error: unknown, nowMillis: number) => E,
		): Effect.Effect<A, E> =>
			Effect.tryPromise({ try: call, catch: (error) => error }).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						const now = yield* Clock.currentTimeMillis;
						yield* record(readThrownHeaders(error));
						return yield* Effect.fail(classify(error, now));
					}),
				),
			);

		const withRetry = <A, E extends RetryableFailure>(
			operation: string,
			effect: Effect.Effect<A, E>,
		): Effect.Effect<A, E> =>
			effect.pipe(
				Effect.tapError((error) =>
					policy.retries(error)
						? Effect.logDebug("github.retry").pipe(Effect.annotateLogs({ operation }))
						: Effect.void,
				),
				Effect.retry(policy.schedule<E>()),
			);

		const apiOrigin = originOf(options.baseUrl ?? DOTCOM_API_BASE_URL);

		// Why `route` with `params` may not be sent to `allowed`, or `undefined`.
		// The URL checked is the one octokit itself would build — template
		// expansion, an absolute route and the base all applied — so no spelling
		// of the route reaches a host this check did not see.
		const refusal = (
			route: string,
			params: Record<string, unknown>,
			allowed: string | undefined,
		): string | undefined => {
			let url: string;
			try {
				url = octokit.request.endpoint(route, params).url;
			} catch {
				return "the route does not expand to a URL";
			}
			if (allowed === undefined) return "the configured base URL is not an absolute URL";
			const origin = originOf(url);
			return origin === allowed
				? undefined
				: `the route resolves to ${origin ?? "a URL that does not parse"}, not the configured host ${allowed}; refusing to send the token there`;
		};

		// A reserved request option among the CALLER's params, checked before
		// anything this module adds.
		const reservedKey = (params: Record<string, unknown>): string | undefined => {
			for (const key of Object.keys(params)) {
				const reason = reservedRawParam(key);
				if (reason !== undefined) return `the parameter "${key}" ${reason}`;
			}
			return undefined;
		};

		const refused = (operation: string, reason: string): GitHubError =>
			new GitHubError({ kind: "rejected", operation, reason });

		const send = <A>(operation: string, route: string, params: Record<string, unknown>) =>
			withRetry(
				operation,
				attempt(
					(signal) => octokit.request(route, withSignal(params, signal)) as Promise<OctokitResponse<A>>,
					(error, now) => GitHubError.fromOctokit(operation, error, now),
				).pipe(Effect.tap((response) => record(response.headers))),
			);

		const request = <A>(operation: string, route: string, params: Record<string, unknown>) =>
			Effect.suspend(() => {
				const reason = reservedKey(params) ?? refusal(route, params, apiOrigin);
				return reason !== undefined ? Effect.fail(refused(operation, reason)) : send<A>(operation, route, params);
			});

		const requestAt = <A>(operation: string, route: string, params: Record<string, unknown>, baseUrl: string) =>
			Effect.suspend(() => {
				const target = { ...params, baseUrl };
				const reason = reservedKey(params) ?? refusal(route, target, originOf(baseUrl));
				return reason !== undefined ? Effect.fail(refused(operation, reason)) : send<A>(operation, route, target);
			});

		const pageSource = <A>(operation: string, route: string, params: Record<string, unknown>): PageSource<A> => {
			// octokit's iterator advances its cursor only on a SUCCESSFUL page, so
			// retrying `next()` re-requests the same page rather than skipping it.
			// That is what makes per-page retry safe, and it is why this uses the
			// iterator rather than a hand-rolled Link-header walk: the iterator also
			// carries the compare endpoint's `total_commits` continuation, the
			// search-shaped `{ total_count, items }` normalization, and the
			// empty-repository 409 that GitHub answers commit listings with.
			//
			// The iterator follows the absolute `next` URL of GitHub's `Link`
			// header (and, for compare, the response's own URL) wherever it
			// points, token attached. It accepts a request FUNCTION in place of
			// the route, so every page it asks for goes through `onApiHost`, which
			// refuses a page on any origin but the configured one before sending.
			const reason = reservedKey(params) ?? refusal(route, params, apiOrigin);
			if (reason !== undefined) return { next: Effect.fail(refused(operation, reason)) };
			const onApiHost = Object.assign(
				(page: { readonly url: string }) => {
					const origin = originOf(page.url);
					return origin === apiOrigin
						? octokit.request(page as never)
						: Promise.reject(new CrossOriginPage(origin, apiOrigin));
				},
				{ endpoint: (parameters: Record<string, unknown>) => octokit.request.endpoint(route as never, parameters) },
			);
			// `onApiHost` is octokit's `RequestInterface` in the only two members
			// the iterator reads: a call, and `endpoint`.
			const pages: AsyncIterable<unknown> = composePaginateRest.iterator(octokit, onApiHost as never, params as never);
			const iterator = pages[Symbol.asyncIterator]();
			let finished = false;
			return {
				next: Effect.suspend(() =>
					finished
						? Effect.succeed(Option.none<ReadonlyArray<A>>())
						: withRetry(
								operation,
								attempt(
									() => iterator.next(),
									(error, now) =>
										error instanceof CrossOriginPage
											? refused(operation, error.message)
											: GitHubError.fromOctokit(operation, error, now),
								).pipe(
									Effect.flatMap((result) => {
										if (result.done === true || result.value === undefined) {
											finished = true;
											return Effect.succeed(Option.none<ReadonlyArray<A>>());
										}
										const response = result.value as OctokitResponse<ReadonlyArray<A>>;
										return record(response.headers).pipe(Effect.as(Option.some(response.data)));
									}),
								),
							),
				),
			};
		};

		const graphqlUrl = graphqlEndpoint(options.baseUrl);
		const graphql = (operation: string, document: string, variables: Record<string, unknown>) =>
			withRetry(
				operation,
				attempt(
					(signal) =>
						octokit
							.request("POST /graphql", {
								...(graphqlUrl !== undefined ? { url: graphqlUrl } : {}),
								// The document and its variables ride as `data`, the whole body,
								// and nowhere else. octokit's own `graphql` merges the variables
								// into its request options and lifts `baseUrl`, `headers`,
								// `request`, `mediaType` and `operationName` out of them as the
								// REQUEST — a variable named `baseUrl` sent the authenticated
								// call, token attached, to that host. Inside `data` no key is
								// ever read as an option.
								data: Object.keys(variables).length > 0 ? { query: document, variables } : { query: document },
								request: { signal },
							})
							.then((response) => readGraphQLResponse(response)),
					(error, now) => GitHubGraphQLError.fromThrowable(operation, error, now),
				),
			);

		return { request, requestAt, pageSource, graphql, rateLimit: Ref.get(snapshot) };
	});

/**
 * The GraphQL endpoint for a GitHub Enterprise Server base URL, or `undefined`
 * for the route's own `/graphql` under the configured base.
 *
 * @remarks
 * GHES serves REST under `/api/v3` and GraphQL under `/api/graphql`, so
 * `<base>/graphql` would miss it. This is the rewrite `@octokit/graphql`
 * applies, kept because the call no longer goes through it. The result is
 * derived from the configured base alone, so it never names another host.
 */
const graphqlEndpoint = (baseUrl: string | undefined): string | undefined =>
	baseUrl !== undefined && GHES_V3_SUFFIX.test(baseUrl) ? baseUrl.replace(GHES_V3_SUFFIX, "/api/graphql") : undefined;

const GHES_V3_SUFFIX = /\/api\/v3\/?$/;

/**
 * The `data` of a GraphQL answer, or a throw carrying its `errors`.
 *
 * @remarks
 * GitHub answers a GraphQL failure with HTTP 200 and an `errors` array. The
 * throw carries `errors` and the response `headers` — the fields
 * `GitHubGraphQLError.fromThrowable` reads structurally — so it classifies
 * exactly as `@octokit/graphql`'s `GraphqlResponseError` did.
 */
const readGraphQLResponse = (response: { readonly data: unknown; readonly headers: unknown }): unknown => {
	const body =
		typeof response.data === "object" && response.data !== null ? (response.data as Record<string, unknown>) : {};
	if (body.errors !== undefined) {
		const errors = Array.isArray(body.errors) ? body.errors : [];
		const messages = errors.map((entry) =>
			typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>).message === "string"
				? ` - ${(entry as Record<string, unknown>).message as string}`
				: ` - ${String(entry)}`,
		);
		throw Object.assign(new Error(`Request failed due to following response errors:\n${messages.join("\n")}`), {
			name: "GraphqlResponseError",
			errors: body.errors,
			headers: response.headers,
			data: body.data,
		});
	}
	return body.data;
};

/** A paginated walk's next page named a host other than the configured one. */
class CrossOriginPage extends Error {
	constructor(origin: string | undefined, allowed: string | undefined) {
		super(
			`a next page is on ${origin ?? "a URL that does not parse"}, not the configured host ${allowed ?? "(none)"}; refusing to send the token there`,
		);
		this.name = "CrossOriginPage";
	}
}

/** Merge our abort signal into octokit's per-request options without clobbering them. */
const withSignal = (params: Record<string, unknown>, signal: AbortSignal): Record<string, unknown> => {
	const existing = typeof params.request === "object" && params.request !== null ? params.request : {};
	return { ...params, request: { ...existing, signal } };
};

/** Response headers off a throwable, when it carried any. */
const readThrownHeaders = (error: unknown): Record<string, unknown> | undefined => {
	if (typeof error !== "object" || error === null) return undefined;
	const response = (error as Record<string, unknown>).response;
	if (typeof response !== "object" || response === null) return undefined;
	const headers = (response as Record<string, unknown>).headers;
	return typeof headers === "object" && headers !== null ? (headers as Record<string, unknown>) : undefined;
};
