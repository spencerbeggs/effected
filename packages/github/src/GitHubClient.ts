import type { Redacted } from "effect";
import { Config, Context, Effect, Layer, Option, Schema, Stream } from "effect";
import { GitHubError } from "./GitHubError.js";
import type { GraphQLDocument } from "./GraphQL.js";
import { GitHubGraphQLError } from "./GraphQL.js";
import { makeTransport } from "./internal/octokit.js";
import { fromArray, paginate } from "./internal/paginate.js";
import type { RateLimitSnapshot } from "./Resilience.js";
import { RetryPolicy } from "./Resilience.js";
import type * as Rest from "./Rest.js";
import type { PageOptions } from "./Rest.js";

/** GitHub's own maximum page size, and the default this package requests. */
const DEFAULT_PER_PAGE = 100;

/**
 * The typed GitHub transport: one request, one paginated read, one GraphQL
 * document, and whatever the rate-limit headers last said.
 *
 * @remarks
 * Every member is an `Effect`, a `Stream`, or a function returning one — the
 * rule that keeps `Layer.mock` and `layerTest(Partial<Shape>)` useful. That
 * includes `rateLimit`, which is an `Effect`-valued property rather than a
 * getter for exactly this reason.
 *
 * @public
 */
export interface GitHubClientShape {
	/**
	 * One request. The route types both the parameters and the returned `data`.
	 *
	 * @example
	 * ```ts
	 * import { GitHubClient } from "@effected/github";
	 * import { Effect } from "effect";
	 *
	 * const defaultBranch = Effect.gen(function* () {
	 *   const client = yield* GitHubClient;
	 *   const repo = yield* client.request("GET /repos/{owner}/{repo}", { owner: "o", repo: "r" });
	 *   return repo.default_branch; // string — no cast, no hand-written interface
	 * });
	 * ```
	 */
	readonly request: <R extends Rest.Route>(
		route: R,
		params: Rest.Params<R>,
	) => Effect.Effect<Rest.Data<R>, GitHubError>;

	/**
	 * A route GitHub does not describe in its OpenAPI schema, or one whose live
	 * shape differs from it.
	 *
	 * @remarks
	 * The `schema` is **mandatory**. This is an escape hatch from the route
	 * table, never from typing: the payload still arrives decoded, and a shape
	 * mismatch fails as `kind: "decode"` rather than surfacing as a value nobody
	 * checked. The attestations read uses it, because pinning
	 * `X-GitHub-Api-Version` puts the response on a contract the generated types
	 * do not describe.
	 */
	readonly requestDecoded: <A, I>(
		route: string,
		params: Record<string, unknown> & Rest.RequestExtras,
		schema: Schema.Codec<A, I>,
	) => Effect.Effect<A, GitHubError>;

	/**
	 * Collect every page of a paginating route, honoring {@link PageOptions}.
	 *
	 * @remarks
	 * Handing this a non-paginating route is a compile error.
	 */
	readonly paginate: <R extends Rest.PaginatingRoute>(
		route: R,
		params: Rest.Params<R>,
		options?: PageOptions,
	) => Effect.Effect<ReadonlyArray<Rest.Item<R>>, GitHubError>;

	/**
	 * The same traversal as a `Stream`, for when the caller decides where to stop.
	 *
	 * @remarks
	 * Lazy in requests: a downstream `Stream.take` stops the walk rather than
	 * filtering pages that were already fetched.
	 */
	readonly paginateStream: <R extends Rest.PaginatingRoute>(
		route: R,
		params: Rest.Params<R>,
		options?: PageOptions,
	) => Stream.Stream<Rest.Item<R>, GitHubError>;

	/** Run an owned GraphQL document and decode its answer. */
	readonly graphql: <A, V extends Record<string, unknown>>(
		document: GraphQLDocument<A, V>,
		variables: V,
	) => Effect.Effect<A, GitHubGraphQLError>;

	/**
	 * What GitHub's rate-limit headers said on the most recent response.
	 *
	 * @remarks
	 * Observation, not policy: **nothing here throttles on your behalf.** The
	 * client retries a rate-limited failure with GitHub's own advised delay, and
	 * a caller that wants to pace itself proactively reads this.
	 */
	readonly rateLimit: Effect.Effect<Option.Option<RateLimitSnapshot>>;
}

/**
 * How a client layer is built.
 *
 * @public
 */
export interface GitHubClientOptions {
	/** The token every request authenticates with. */
	readonly token: Redacted.Redacted<string>;
	/** Retry behavior. Defaults to {@link RetryPolicy.default}; `"off"` disables it. */
	readonly retry?: RetryPolicy | "off" | undefined;
	/** A GitHub Enterprise API root, e.g. `https://github.acme.com/api/v3`. */
	readonly baseUrl?: string | undefined;
	/** Appended to octokit's own user agent. */
	readonly userAgent?: string | undefined;
	/**
	 * A replacement for the global `fetch`.
	 *
	 * @remarks
	 * octokit's own documented hook. It is the seam a test drives the **real**
	 * request path through — classification, header capture, retry and
	 * pagination all exercised against canned HTTP responses instead of against
	 * a hand-written double of this service.
	 */
	readonly fetch?: typeof globalThis.fetch | undefined;
}

/**
 * A recorded response table for {@link GitHubClient.layerFixture}.
 *
 * @public
 */
export interface GitHubFixtures {
	/** Keyed by route; the value is the `data` payload a request answers with. */
	readonly request?: Readonly<Record<string, unknown>> | undefined;
	/** Keyed by route; the value is the whole collection, paged on demand. */
	readonly paginate?: Readonly<Record<string, ReadonlyArray<unknown>>> | undefined;
	/** Keyed by document name; the value is the raw payload to decode. */
	readonly graphql?: Readonly<Record<string, unknown>> | undefined;
	/** What `rateLimit` answers. */
	readonly rateLimit?: RateLimitSnapshot | undefined;
	/**
	 * Every route a paginated read requested, in order, with the page size asked
	 * for. Populated by the fixture as the test runs.
	 */
	readonly requested?: Array<{ readonly route: string; readonly perPage: number }> | undefined;
}

const resolvePolicy = (retry: RetryPolicy | "off" | undefined): RetryPolicy =>
	retry === undefined ? RetryPolicy.default : retry === "off" ? RetryPolicy.none : retry;

const perPageOf = (options: PageOptions | undefined): number => options?.perPage ?? DEFAULT_PER_PAGE;

const unstubbed = (member: string): never => {
	throw new Error(
		`GitHubClient.makeTest: ${member}() was called but not stubbed — pass an override, or use GitHubClient.layerFixture for recorded responses.`,
	);
};

/**
 * The typed GitHub API client.
 *
 * @remarks
 * The route is the key. `@octokit/types` generates a map from GitHub's OpenAPI
 * description that carries every endpoint's parameter and response shapes, and
 * `@octokit/core`'s `request` already consumes it — so a caller writes a route
 * literal and gets both sides typed, with no callback, no type parameter to
 * invent, and no cast.
 *
 * That is the whole point of this package. The surface it replaces was
 * `rest<T>(operation: string, fn: (octokit: any) => Promise<{ data: T }>)`,
 * where `T` was whatever the caller wrote and nothing connected it to the
 * endpoint. Four consumer repos paid for that with sixteen cast sites and three
 * hand-written octokit interfaces, one of which gave up and typed its methods as
 * `Record<string, (p: unknown) => Promise<{ data: unknown }>>`.
 *
 * @public
 */
export class GitHubClient extends Context.Service<GitHubClient, GitHubClientShape>()("@effected/github/GitHubClient") {
	/**
	 * A client authenticated with a token you already hold.
	 *
	 * @remarks
	 * This module imports `@octokit/core` and nothing heavier. A consumer that
	 * only ever authenticates with a token never links the GitHub App JWT signer,
	 * because the App-authenticated layer lives in `GitHubApp` — a different
	 * module — rather than as a third static here.
	 */
	static readonly layerFromToken = (options: GitHubClientOptions): Layer.Layer<GitHubClient> =>
		Layer.effect(this, makeFromOptions(options));

	/**
	 * A client authenticated from configuration, `GITHUB_TOKEN` by default.
	 *
	 * @remarks
	 * Reads through the ambient `ConfigProvider`, not `process.env`, so a test
	 * provides a provider instead of mutating the environment and a non-Actions
	 * consumer can source the token however it likes.
	 *
	 * Construction fails with core's `ConfigError` — an honest "no token is
	 * configured". The layer this replaces failed with a **wire-failure** error
	 * type instead, which is why one consumer wrapped it in `Layer.orDie` under a
	 * five-line comment explaining that the error did not mean what it said.
	 */
	static readonly layerFromConfig = (
		options: Omit<GitHubClientOptions, "token"> & { readonly name?: string | undefined } = {},
	): Layer.Layer<GitHubClient, Config.ConfigError> =>
		Layer.effect(
			this,
			Effect.gen(function* () {
				const token = yield* Config.redacted(options.name ?? "GITHUB_TOKEN");
				return yield* makeFromOptions({ ...options, token });
			}),
		);

	/**
	 * An in-memory double: stub the members a test exercises, and every other
	 * member **dies** naming itself.
	 *
	 * @remarks
	 * No member has an honest default. A fabricated response — an empty list, a
	 * made-up sha — would leak into the code under test as fact, so the double
	 * fails loudly instead, which also makes it proof that a test touches nothing
	 * but what it stubbed.
	 *
	 * For recorded responses that page for real, use
	 * {@link GitHubClient.layerFixture}.
	 */
	static readonly makeTest = (overrides: Partial<GitHubClientShape> = {}): GitHubClientShape => ({
		request: overrides.request ?? (() => unstubbed("request")),
		requestDecoded: overrides.requestDecoded ?? (() => unstubbed("requestDecoded")),
		paginate: overrides.paginate ?? (() => unstubbed("paginate")),
		paginateStream: overrides.paginateStream ?? (() => unstubbed("paginateStream")),
		graphql: overrides.graphql ?? (() => unstubbed("graphql")),
		rateLimit: overrides.rateLimit ?? Effect.succeed(Option.none()),
	});

	/** {@link GitHubClient.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<GitHubClientShape> = {}): Layer.Layer<GitHubClient> =>
		Layer.succeed(GitHubClient, GitHubClient.makeTest(overrides));

	/**
	 * A double over recorded responses that **pages them for real**.
	 *
	 * @remarks
	 * The one recorded-response double in this package, and the single narrow
	 * exception to the no-behavior-reimplementing-doubles rule — safe precisely
	 * because it reimplements nothing: it builds a `PageSource` over the recorded
	 * array and hands it to the same `paginate` engine the live client uses, so
	 * `perPage` and `maxPages` cannot behave differently here than in production.
	 *
	 * The double it replaces named its pagination parameters `_options` and
	 * ignored them, returning every recorded page regardless of what the caller
	 * asked for — which made every truncation path in every consumer
	 * structurally untestable.
	 *
	 * `fixtures.requested` is appended to as the test runs, so a suite can assert
	 * which routes were walked and at what page size.
	 */
	static readonly layerFixture = (fixtures: GitHubFixtures): Layer.Layer<GitHubClient> =>
		Layer.succeed(GitHubClient, makeFixture(fixtures));
}

/** Builds the live shape over a constructed transport. */
const makeFromOptions = (options: GitHubClientOptions): Effect.Effect<GitHubClientShape> =>
	Effect.gen(function* () {
		const transport = yield* makeTransport({
			token: options.token,
			retry: resolvePolicy(options.retry),
			baseUrl: options.baseUrl,
			userAgent: options.userAgent,
			fetch: options.fetch,
		});

		const request = Effect.fn("GitHubClient.request")(function* <R extends Rest.Route>(
			route: R,
			params: Rest.Params<R>,
		) {
			yield* Effect.annotateCurrentSpan({ route });
			const response = yield* transport.request<Rest.Data<R>>(route, route, params as Record<string, unknown>);
			return response.data;
		});

		const requestDecoded = Effect.fn("GitHubClient.requestDecoded")(function* <A, I>(
			route: string,
			params: Record<string, unknown> & Rest.RequestExtras,
			schema: Schema.Codec<A, I>,
		) {
			yield* Effect.annotateCurrentSpan({ route });
			const response = yield* transport.request<unknown>(route, route, params);
			return yield* Schema.decodeUnknownEffect(schema)(response.data).pipe(
				Effect.catchTag("SchemaError", (error) =>
					Effect.fail(GitHubError.decode(route, "response did not match its schema", error)),
				),
			);
		});

		const paginateStream = <R extends Rest.PaginatingRoute>(
			route: R,
			params: Rest.Params<R>,
			options?: PageOptions,
		): Stream.Stream<Rest.Item<R>, GitHubError> =>
			paginate<Rest.Item<R>>(
				() =>
					transport.pageSource<Rest.Item<R>>(route, route, {
						per_page: perPageOf(options),
						...(params as Record<string, unknown>),
					}),
				options?.maxPages,
			);

		const paginateAll = Effect.fn("GitHubClient.paginate")(function* <R extends Rest.PaginatingRoute>(
			route: R,
			params: Rest.Params<R>,
			options?: PageOptions,
		) {
			yield* Effect.annotateCurrentSpan({ route, perPage: perPageOf(options), maxPages: options?.maxPages ?? -1 });
			return yield* Stream.runCollect(paginateStream(route, params, options));
		});

		const graphql = Effect.fn("GitHubClient.graphql")(function* <A, V extends Record<string, unknown>>(
			document: GraphQLDocument<A, V>,
			variables: V,
		) {
			yield* Effect.annotateCurrentSpan({ document: document.name });
			const raw = yield* transport.graphql(document.name, document.document, document.encodeVariables(variables));
			return yield* document.decode(raw).pipe(
				// Normalized at the boundary: a SchemaError never escapes into
				// application logic.
				Effect.catchTag("SchemaError", (error) =>
					Effect.fail(GitHubGraphQLError.decode(document.name, "response did not match its schema", error)),
				),
			);
		});

		return {
			request,
			requestDecoded,
			paginate: paginateAll,
			paginateStream,
			graphql,
			rateLimit: transport.rateLimit,
		};
	});

const makeFixture = (fixtures: GitHubFixtures): GitHubClientShape => {
	const requested = fixtures.requested;
	const paginateStream = <R extends Rest.PaginatingRoute>(
		route: R,
		_params: Rest.Params<R>,
		options?: PageOptions,
	): Stream.Stream<Rest.Item<R>, GitHubError> => {
		const items = fixtures.paginate?.[route];
		if (items === undefined) {
			return Stream.fail(GitHubError.notFound("GitHubClient.paginate", `fixture for ${route}`));
		}
		const perPage = perPageOf(options);
		requested?.push({ route, perPage });
		return paginate<Rest.Item<R>>(() => fromArray(items as ReadonlyArray<Rest.Item<R>>, perPage), options?.maxPages);
	};

	return {
		request: <R extends Rest.Route>(route: R, _params: Rest.Params<R>) => {
			const data = fixtures.request?.[route];
			return data === undefined
				? Effect.fail(GitHubError.notFound("GitHubClient.request", `fixture for ${route}`))
				: Effect.succeed(data as Rest.Data<R>);
		},
		requestDecoded: <A, I>(route: string, _params: Record<string, unknown>, schema: Schema.Codec<A, I>) => {
			const data = fixtures.request?.[route];
			return data === undefined
				? Effect.fail(GitHubError.notFound("GitHubClient.requestDecoded", `fixture for ${route}`))
				: Schema.decodeUnknownEffect(schema)(data).pipe(
						Effect.catchTag("SchemaError", (error) =>
							Effect.fail(GitHubError.decode(route, "fixture did not match its schema", error)),
						),
					);
		},
		paginate: (route, params, options) => Stream.runCollect(paginateStream(route, params, options)),
		paginateStream,
		graphql: <A, V extends Record<string, unknown>>(document: GraphQLDocument<A, V>, _variables: V) => {
			const raw = fixtures.graphql?.[document.name];
			return raw === undefined
				? Effect.die(new Error(`GitHubClient.layerFixture: no graphql fixture for ${document.name}`))
				: document
						.decode(raw)
						.pipe(
							Effect.catchTag("SchemaError", (error) =>
								Effect.fail(GitHubGraphQLError.decode(document.name, "fixture did not match its schema", error)),
							),
						);
		},
		rateLimit: Effect.succeed(Option.fromUndefinedOr(fixtures.rateLimit)),
	};
};
