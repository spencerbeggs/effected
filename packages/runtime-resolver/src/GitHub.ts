/**
 * Talking to GitHub: pluggable authentication, a REST client, and the typed
 * failure ladder that every network fetch in this package reports through.
 *
 * The two nodejs.org feeds reuse this ladder rather than minting a parallel
 * one, so the module is named for its dominant user rather than for the
 * lowest common denominator.
 *
 * @packageDocumentation
 */

import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import type { HttpFailure, PageOptions } from "./internal/http.js";
import { paginate } from "./internal/http.js";

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * GitHub rejected the credentials.
 *
 * @public
 */
export class AuthenticationError extends Schema.TaggedErrorClass<AuthenticationError>()("AuthenticationError", {
	/** How the request was authenticated when it was rejected. */
	method: Schema.Literals(["token", "anonymous"]),
}) {}

/**
 * GitHub's rate limit was exhausted.
 *
 * `retryAfter` is what a caller needs to back off correctly, which is why it is
 * a structured field rather than prose in a message.
 *
 * @public
 */
export class RateLimitError extends Schema.TaggedErrorClass<RateLimitError>()("RateLimitError", {
	/** Seconds to wait before retrying, when GitHub said. */
	retryAfter: Schema.optionalKey(Schema.Number),
	/** The request quota for the window. */
	limit: Schema.Number,
	/** Requests left in the window. */
	remaining: Schema.Number,
}) {}

/**
 * A request did not complete, or completed with an unusable status.
 *
 * @public
 */
export class NetworkError extends Schema.TaggedErrorClass<NetworkError>()("NetworkError", {
	/** The URL that failed. */
	url: Schema.String,
	/** The HTTP status, when there was a response at all. */
	status: Schema.optionalKey(Schema.Number),
	/** The underlying transport failure. */
	cause: Schema.Defect(),
}) {}

/**
 * A feed responded, but not with the shape this package expects.
 *
 * An operator-facing signal that an upstream feed changed.
 *
 * @public
 */
export class ResponseParseError extends Schema.TaggedErrorClass<ResponseParseError>()("ResponseParseError", {
	/** The URL whose body could not be decoded. */
	source: Schema.String,
	/** The decoding failure. */
	cause: Schema.Defect(),
}) {}

/**
 * Every way a fetch against a release feed can fail.
 *
 * @public
 */
export type GitHubError = AuthenticationError | RateLimitError | NetworkError | ResponseParseError;

/**
 * Materialize the engine's raw failure record into the public error ladder.
 *
 * The engine (`internal/http.ts`) never imports these classes — it returns raw
 * records and this is the single place they become errors. That is what keeps
 * the transport layer free of the facade and the import graph acyclic.
 *
 * @internal
 */
export const mapHttpFailure = (failure: HttpFailure): GitHubError => {
	switch (failure._kind) {
		case "auth":
			return new AuthenticationError({ method: "token" });
		case "rateLimit":
			return new RateLimitError({
				...(failure.retryAfter !== undefined ? { retryAfter: failure.retryAfter } : {}),
				limit: failure.limit,
				remaining: failure.remaining,
			});
		case "network":
			return new NetworkError({
				url: failure.url,
				...(failure.status !== undefined ? { status: failure.status } : {}),
				cause: failure.cause,
			});
		case "parse":
			return new ResponseParseError({ source: failure.source, cause: failure.cause });
	}
};

// ── Wire schemas ─────────────────────────────────────────────────────────────

/**
 * A tag as `GET /repos/{owner}/{repo}/tags` returns it.
 *
 * @public
 */
export class GitHubTag extends Schema.Class<GitHubTag>("GitHubTag")({
	name: Schema.String,
}) {}

/**
 * A release as `GET /repos/{owner}/{repo}/releases` returns it.
 *
 * @public
 */
export class GitHubRelease extends Schema.Class<GitHubRelease>("GitHubRelease")({
	tag_name: Schema.String,
	draft: Schema.Boolean,
	prerelease: Schema.Boolean,
	published_at: Schema.NullOr(Schema.String),
}) {}

// ── Authentication ───────────────────────────────────────────────────────────

/**
 * The shape of a GitHub credential: something that can produce request headers.
 *
 * Making this a service rather than a concrete token is what lets GitHub App
 * authentication live outside this package. App auth needs JWT signing and an
 * installation-token exchange, which means a runtime dependency — forbidden in
 * a boundary-tier package. A consumer who needs it supplies their own
 * `Layer<GitHubAuth>` that mints installation tokens; nothing else changes.
 *
 * @public
 */
export interface GitHubAuthShape {
	/** Headers to attach to each GitHub request. */
	readonly headers: Effect.Effect<Readonly<Record<string, string>>, AuthenticationError>;
}

const bearer = (token: Redacted.Redacted<string>): Readonly<Record<string, string>> => ({
	authorization: `Bearer ${Redacted.value(token)}`,
});

const patConfig = Config.string("GITHUB_PERSONAL_ACCESS_TOKEN").pipe(Config.option);
const tokenConfig = Config.string("GITHUB_TOKEN").pipe(Config.option);

/**
 * How GitHub requests are authenticated.
 *
 * @public
 */
export class GitHubAuth extends Context.Service<GitHubAuth, GitHubAuthShape>()(
	"@effected/runtime-resolver/GitHubAuth",
) {
	/**
	 * Send no credentials. GitHub allows this, at a much lower rate limit.
	 */
	static readonly anonymous: Layer.Layer<GitHubAuth> = Layer.succeed(GitHubAuth)({
		headers: Effect.succeed({}),
	});

	/**
	 * Authenticate with a personal access token.
	 *
	 * This returns a fresh layer per call, so bind it to a constant rather than
	 * calling it inline twice — layers are memoized by reference.
	 */
	static readonly token = (token: Redacted.Redacted<string>): Layer.Layer<GitHubAuth> =>
		Layer.succeed(GitHubAuth)({ headers: Effect.succeed(bearer(token)) });

	/**
	 * Detect a credential from the environment, preferring an explicit PAT.
	 *
	 * Precedence is `GITHUB_PERSONAL_ACCESS_TOKEN`, then `GITHUB_TOKEN`, then
	 * unauthenticated — the v3 policy, kept, but read through `Config` so a test
	 * can swap the `ConfigProvider` instead of mutating `process.env`.
	 */
	static readonly layer: Layer.Layer<GitHubAuth> = Layer.effect(
		GitHubAuth,
		Effect.gen(function* () {
			const pat = yield* patConfig;
			const token = yield* tokenConfig;

			if (Option.isSome(pat)) {
				if (Option.isSome(token)) {
					yield* Effect.logWarning("Both GITHUB_PERSONAL_ACCESS_TOKEN and GITHUB_TOKEN are set; using the former");
				}
				return { headers: Effect.succeed(bearer(Redacted.make(pat.value))) };
			}
			if (Option.isSome(token)) {
				return { headers: Effect.succeed(bearer(Redacted.make(token.value))) };
			}
			return { headers: Effect.succeed({}) };
		}).pipe(
			// Both reads are optional, so the only way they fail is a broken
			// ConfigProvider — a wiring defect, not something a caller recovers from.
			Effect.orDie,
		),
	);
}

// ── Client ───────────────────────────────────────────────────────────────────

/**
 * How much of a paginated listing to fetch.
 *
 * Both fields must be positive integers. A `NaN` or fractional value is a
 * wiring bug, not a data condition, and dies rather than failing typed.
 *
 * @public
 */
export interface ListOptions extends PageOptions {}

/**
 * The GitHub REST operations this package needs.
 *
 * @public
 */
export interface GitHubClientShape {
	/** List a repository's tags, newest first. */
	readonly listTags: (
		owner: string,
		repo: string,
		options?: ListOptions,
	) => Effect.Effect<ReadonlyArray<GitHubTag>, GitHubError>;
	/** List a repository's releases, newest first. */
	readonly listReleases: (
		owner: string,
		repo: string,
		options?: ListOptions,
	) => Effect.Effect<ReadonlyArray<GitHubRelease>, GitHubError>;
}

const TagList = Schema.Array(GitHubTag);
const ReleaseList = Schema.Array(GitHubRelease);

const listUrl = (owner: string, repo: string, kind: "tags" | "releases") => (page: number, perPage: number) =>
	`https://api.github.com/repos/${owner}/${repo}/${kind}?per_page=${perPage}&page=${page}`;

const GITHUB_HEADERS = {
	accept: "application/vnd.github+json",
	"x-github-api-version": "2022-11-28",
} as const;

/**
 * A GitHub REST client over `HttpClient`.
 *
 * v3 reached for `octokit` here, which cost two large dependency graphs to fund
 * two GET requests. Programming against `HttpClient` from `effect` core keeps
 * the package boundary tier and lets a consumer supply any transport.
 *
 * @public
 */
export class GitHubClient extends Context.Service<GitHubClient, GitHubClientShape>()(
	"@effected/runtime-resolver/GitHubClient",
) {
	/**
	 * The client, requiring an `HttpClient` and a `GitHubAuth` from the context.
	 */
	static readonly layer: Layer.Layer<GitHubClient, never, HttpClient.HttpClient | GitHubAuth> = Layer.effect(
		GitHubClient,
		Effect.gen(function* () {
			const auth = yield* GitHubAuth;
			const http = yield* HttpClient.HttpClient;

			const list = <A, I>(
				owner: string,
				repo: string,
				kind: "tags" | "releases",
				schema: Schema.Codec<ReadonlyArray<A>, ReadonlyArray<I>>,
				options: ListOptions | undefined,
			): Effect.Effect<ReadonlyArray<A>, GitHubError> =>
				Effect.gen(function* () {
					const headers = yield* auth.headers;
					return yield* paginate(listUrl(owner, repo, kind), schema, { ...GITHUB_HEADERS, ...headers }, options).pipe(
						Effect.mapError(mapHttpFailure),
					);
				}).pipe(Effect.provideService(HttpClient.HttpClient, http));

			return {
				listTags: Effect.fn("GitHubClient.listTags")(function* (owner, repo, options) {
					yield* Effect.annotateCurrentSpan({ owner, repo });
					return yield* list(owner, repo, "tags", TagList, options);
				}),
				listReleases: Effect.fn("GitHubClient.listReleases")(function* (owner, repo, options) {
					yield* Effect.annotateCurrentSpan({ owner, repo });
					return yield* list(owner, repo, "releases", ReleaseList, options);
				}),
			};
		}),
	);

	/**
	 * The client with batteries: environment-detected auth over `fetch`.
	 *
	 * The common wiring, in one import. Use {@link GitHubClient.layer} directly
	 * to supply your own credential or transport.
	 */
	static readonly layerDefault: Layer.Layer<GitHubClient> = GitHubClient.layer.pipe(
		Layer.provide(Layer.mergeAll(GitHubAuth.layer, FetchHttpClient.layer)),
	);
}
