import { Jwt, JwtKey } from "@effected/jwt";
import type { Scope } from "effect";
import {
	Cause,
	Clock,
	Context,
	DateTime,
	Duration,
	Effect,
	Layer,
	Option,
	Redacted,
	Ref,
	Schema,
	Semaphore,
	Stream,
} from "effect";
import type { GitHubClientShape } from "./GitHubClient.js";
import { GitHubClient, makeClientShape } from "./GitHubClient.js";
import { GitHubError } from "./GitHubError.js";
import { GitHubGraphQLError } from "./GraphQL.js";
import { InstallationTokenStore } from "./InstallationTokenStore.js";
import { numericId } from "./internal/ids.js";
import type { RetryPolicy } from "./Resilience.js";

/**
 * A GitHub App call failed.
 *
 * @remarks
 * Distinct from `GitHubError` because "I could not obtain credentials" and "the
 * API call failed" are different problems with different fixes: the first is a
 * misconfigured app, a wrong private key or a missing installation; the second
 * is the request that used the credentials.
 *
 * @public
 */
export class GitHubAppError extends Schema.TaggedError<GitHubAppError>()("GitHubAppError", {
	/** Which step failed. */
	kind: Schema.Literals(["jwt", "token", "revoke", "identity", "installation"]),
	/** Human-readable cause. */
	reason: Schema.String,
	/** The underlying failure, when there is one. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		return `GitHub App ${this.kind} failed: ${this.reason}`;
	}

	/** @internal */
	static of(kind: GitHubAppError["kind"], reason: string, cause?: unknown): GitHubAppError {
		return new GitHubAppError({ kind, reason, ...(cause !== undefined ? { cause } : {}) });
	}
}

/**
 * The credentials that identify a GitHub App.
 *
 * @remarks
 * `appId` accepts either the numeric app id or the newer client id — GitHub
 * accepts both as the JWT issuer, and this package does not care which you use.
 *
 * @public
 */
export interface AppCredentials {
	/** The app id or client id. */
	readonly appId: string;
	/**
	 * The app's private key, in PEM.
	 *
	 * @remarks
	 * Both PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`, which is what github.com
	 * hands you) and PKCS#8 (`-----BEGIN PRIVATE KEY-----`) are accepted on every
	 * runtime with WebCrypto, Node and workerd alike: a PKCS#1 key is wrapped to
	 * PKCS#8 in-process, so no conversion step is needed. Newlines may also
	 * arrive escaped as the two characters backslash and `n`, the one-line form
	 * an environment variable carries. The key must be RSA of at least 2048
	 * bits; anything else fails with a `kind: "jwt"` error.
	 */
	readonly privateKey: Redacted.Redacted<string>;
}

/**
 * What to mint an installation token for.
 *
 * @public
 */
export interface TokenRequest extends AppCredentials {
	/** The installation. Discovered from `owner` when omitted. */
	readonly installationId?: number | undefined;
	/**
	 * The account whose installation to use, when `installationId` is omitted.
	 *
	 * @remarks
	 * Discovery costs a JWT mint plus a paginated walk of `GET /app/installations`,
	 * so supplying `installationId` is strictly cheaper. When both are omitted and
	 * the app has exactly one installation, that one is used; with several, the
	 * failure names them.
	 */
	readonly owner?: string | undefined;
}

/**
 * What to fetch a cached installation token for.
 *
 * @public
 */
export interface CachedTokenRequest extends TokenRequest {
	/**
	 * The installation. Required here: discovering it on every request would
	 * cost a JWT mint and a paginated walk, which defeats the cache.
	 */
	readonly installationId: number;
	/**
	 * How long before its expiry a stored token stops being served. Defaults to
	 * five minutes; must be finite and not negative.
	 *
	 * @remarks
	 * A served token has at least `margin` left to live unless GitHub issued it
	 * with less than that, in which case it is returned once and not stored.
	 * GitHub issues installation tokens for an hour, so a margin of an hour or
	 * more guarantees that case: every call mints and nothing is cached.
	 */
	readonly margin?: Duration.Input | undefined;
}

/**
 * An installation token from {@link GitHubApp.cachedToken}, and where it came
 * from.
 *
 * @public
 */
export interface CachedToken {
	/** The token. */
	readonly token: InstallationToken;
	/** `"cached"` when it was read from the store, `"minted"` when GitHub issued it just now. */
	readonly source: "cached" | "minted";
}

/**
 * An installation access token and what GitHub said about it.
 *
 * @remarks
 * Encodable on purpose. `@effected/github-actions` persists one across the
 * `pre`/`main`/`post` process boundary through `GITHUB_STATE`, and
 * `Schema.encodeUnknownEffect` produces JSON with the token as a plain string
 * and `expiresAt` as an ISO instant. A `Redacted` cannot survive serialization
 * by design, so masking the encoded value is the caller's job — Actions calls
 * `::add-mask::`.
 *
 * @public
 */
export class InstallationToken extends Schema.Class<InstallationToken>("InstallationToken")({
	/** The token. Decodes to `Redacted`, encodes back to the raw string. */
	token: Schema.RedactedFromValue(Schema.String),
	/** When GitHub will stop accepting it — about an hour out. */
	expiresAt: Schema.DateTimeUtcFromString,
	/** The installation it is scoped to. */
	installationId: Schema.Int,
	/** The permissions GitHub actually granted, which may be narrower than requested. */
	permissions: Schema.Record(Schema.String, Schema.String),
	/** The app's slug, when identity was resolved. */
	appSlug: Schema.optionalKey(Schema.String),
	/** The app's bot user id, when identity was resolved. */
	appUserId: Schema.optionalKey(Schema.Int),
	/** The app's display name, when identity was resolved. */
	appName: Schema.optionalKey(Schema.String),
}) {
	/**
	 * Whether this token is spent, `skew` before its stated expiry.
	 *
	 * @remarks
	 * `skew` defaults to one minute, so a token is treated as spent slightly early
	 * rather than answering 401 mid-request.
	 */
	isExpired(nowMillis: number, skew: Duration.Duration = DEFAULT_SKEW): boolean {
		return isSpent(DateTime.toEpochMillis(this.expiresAt), nowMillis, skew);
	}

	/** The committer identity a commit made with this token should carry. */
	botIdentity(): BotIdentity {
		return this.appSlug === undefined
			? BotIdentity.githubActions
			: BotIdentity.forApp({
					appSlug: this.appSlug,
					...(this.appUserId !== undefined ? { appUserId: this.appUserId } : {}),
				});
	}
}

/** Re-mint a minute before GitHub would start refusing the token. */
const DEFAULT_SKEW = Duration.seconds(60);

/** Whether a credential expiring at `expiresAtMillis` should be replaced at `nowMillis`. */
const isSpent = (expiresAtMillis: number, nowMillis: number, skew: Duration.Duration = DEFAULT_SKEW): boolean =>
	expiresAtMillis - Duration.toMillis(skew) <= nowMillis;

/**
 * Who a bot commits as.
 *
 * @remarks
 * A **pure class**, not a `GitHubApp` service member: a synchronous method on
 * the service shape would be required in every `Layer.mock` and would silently
 * degrade every partial double to a full implementation. Get one from
 * `InstallationToken.botIdentity` or `AppIdentity.botIdentity`.
 *
 * @public
 */
export class BotIdentity extends Schema.Class<BotIdentity>("BotIdentity")({
	/** The git author/committer name, e.g. `"my-app[bot]"`. */
	name: Schema.String,
	/** The no-reply address GitHub attributes to that account. */
	email: Schema.String,
}) {
	/** The identity for an app, given whatever of its identity is known. */
	static forApp(source: { readonly appSlug: string; readonly appUserId?: number | undefined }): BotIdentity {
		const name = `${source.appSlug}[bot]`;
		return BotIdentity.make({
			name,
			email:
				source.appUserId === undefined
					? `${name}@users.noreply.github.com`
					: `${source.appUserId}+${name}@users.noreply.github.com`,
		});
	}

	/** The well-known identity of the `github-actions` bot. */
	static readonly githubActions: BotIdentity = BotIdentity.make({
		name: "github-actions[bot]",
		email: "41898282+github-actions[bot]@users.noreply.github.com",
	});

	/**
	 * The DCO sign-off trailer for this identity.
	 *
	 * @remarks
	 * `Signed-off-by: name <email>` — DCO 1.1's fixed casing and spacing, with
	 * only the email in angle brackets, rendered by the type that owns the
	 * data. Commits created
	 * through the Git Data API bypass `git commit -s`, so no porcelain adds
	 * the trailer, and a hand-built one that is subtly wrong fails late as a
	 * red DCO check on someone else's pull request. Whether a missing
	 * identity falls back to {@link BotIdentity.githubActions} stays the
	 * caller's policy.
	 */
	get signoff(): string {
		return `Signed-off-by: ${this.name} <${this.email}>`;
	}
}

/**
 * What GitHub knows about the app itself.
 *
 * @public
 */
export class AppIdentity extends Schema.Class<AppIdentity>("AppIdentity")({
	/** The URL slug, e.g. `"my-app"`. */
	slug: Schema.String,
	/** The display name. */
	name: Schema.String,
	/** The bot user's numeric id, when it could be resolved. */
	userId: Schema.optionalKey(Schema.Int),
}) {
	/** The committer identity for this app. */
	botIdentity(): BotIdentity {
		return BotIdentity.forApp({
			appSlug: this.slug,
			...(this.userId !== undefined ? { appUserId: this.userId } : {}),
		});
	}
}

/** `suspended_at` as GitHub sends it: an ISO string, or `null` while active. */
const SuspendedAt = Schema.OptionFromNullOr(Schema.DateTimeUtcFromString);

/**
 * One optional field read leniently: `{ [key]: decoded }` when the value
 * decodes, `{}` otherwise. An absent key reads as `undefined`, which none of
 * the schemas this is called with accepts, so absence and an unreadable value
 * alike omit the field rather than failing the installation.
 */
const readField = <K extends string, S extends Schema.Top & { readonly DecodingServices: never }>(
	key: K,
	schema: S,
	value: unknown,
): { readonly [P in K]?: S["Type"] } => {
	const decoded = Schema.decodeUnknownOption(schema)(value);
	return Option.isSome(decoded) ? ({ [key]: decoded.value } as { readonly [P in K]?: S["Type"] }) : {};
};

/**
 * One installation of the app.
 *
 * @remarks
 * Every field but `id` is filled only when GitHub's response carries it and
 * it reads cleanly; an unreadable field is omitted rather than failing the
 * listing. A test double built with `Installation.make({ id })` stays valid.
 * An enterprise account carries `accountId` and `accountType` without a
 * login `account`. Encodable:
 * the dates encode to ISO strings and `suspendedAt` to an ISO string or
 * `null`, the same shape GitHub sends.
 *
 * @public
 */
export class Installation extends Schema.Class<Installation>("Installation")({
	/** The installation id, which is what a token is minted against. */
	id: Schema.Int,
	/** The account the app is installed on (its login), when GitHub reported one. */
	account: Schema.optionalKey(Schema.String),
	/** The account kind, e.g. "Organization" or "User"; open-ended, because GitHub adds kinds. */
	accountType: Schema.optionalKey(Schema.String),
	/**
	 * The account's numeric id.
	 *
	 * @remarks
	 * Not paired with `account`: an enterprise installation carries
	 * `accountId` (and may carry `accountType`) but has no login, so `account`
	 * is absent.
	 */
	accountId: Schema.optionalKey(Schema.Int),
	/** When the installation was suspended; `Option.none()` when it is active. */
	suspendedAt: Schema.optionalKey(SuspendedAt),
	/** When GitHub last changed the installation. */
	updatedAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
}) {}

/**
 * Transport settings for the app's own API calls.
 *
 * @public
 */
export interface GitHubAppOptions {
	/** A GitHub Enterprise API root. */
	readonly baseUrl?: string | undefined;
	/** Appended to octokit's user agent. */
	readonly userAgent?: string | undefined;
	/** Retry behavior for the app's own calls. */
	readonly retry?: RetryPolicy | "off" | undefined;
	/** A replacement `fetch`, for tests and proxies. */
	readonly fetch?: typeof globalThis.fetch | undefined;
}

/**
 * GitHub App authentication: mint, revoke and identify.
 *
 * @remarks
 * **This is the only module in the package that imports a JWT signer**, which is
 * what makes the tree-shaking invariant structural rather than aspirational: a
 * consumer that authenticates with a token it already holds imports
 * `GitHubClient` and never reaches this module or its dependency.
 *
 * That constraint is also why the App-authenticated **client** layer lives here
 * as {@link GitHubApp.clientLayer} rather than as a third static on
 * `GitHubClient`: statics on one class share one module, and putting it there
 * would make every token-only consumer link the signer. The kit has this shape
 * already — `@effected/workspaces` ships `localExecLayer`, which builds
 * `@effected/commands`' service, for the same reason.
 *
 * The JWT signer is `@effected/jwt` — WebCrypto RS256 with no runtime
 * dependencies, so App auth runs on any runtime that has `crypto.subtle`.
 *
 * @example
 * ```ts
 * import { GitHubApp, GitHubClient } from "@effected/github";
 * import { Effect, Redacted } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const client = yield* GitHubClient;
 *   const accessible = yield* client.request("GET /installation/repositories", { per_page: 1 });
 *   return accessible.total_count;
 * });
 *
 * // Mints an installation token on build, re-mints before expiry, revokes on release.
 * const layer = GitHubApp.clientLayer({
 *   appId: "12345",
 *   privateKey: Redacted.make("-----BEGIN PRIVATE KEY-----\n..."),
 *   owner: "my-org",
 * });
 *
 * Effect.runPromise(Effect.provide(program, layer));
 * ```
 *
 * @public
 */
export class GitHubApp extends Context.Service<GitHubApp, GitHubAppShape>()("@effected/github/GitHubApp") {
	/** The default transport. Bind it once; layers are memoized by reference. */
	static readonly layer: Layer.Layer<GitHubApp> = Layer.effect(this, makeApp({}));

	/**
	 * A transport with custom settings.
	 *
	 * @remarks
	 * Parameterized, so **bind the result to a `const`** and reuse it. Calling
	 * this at two provide sites builds two instances, because layers are
	 * memoized by reference.
	 */
	static readonly layerWith = (options: GitHubAppOptions): Layer.Layer<GitHubApp> =>
		Layer.effect(GitHubApp, makeApp(options));

	/**
	 * A {@link GitHubClient} authenticated as an app installation.
	 *
	 * @remarks
	 * The token's lifetime is the layer's scope: it is minted on build and
	 * **revoked on release**, best-effort, so a workflow does not leave live
	 * credentials behind. It is also **re-minted automatically** a minute before
	 * it expires, so a long-running program does not start answering 401 when
	 * the hour ends.
	 *
	 * Building the layer mints the first token, so a misconfigured app fails
	 * construction with `GitHubAppError`. After that, a failure to obtain
	 * credentials surfaces to the caller as a
	 * `GitHubError { kind: "unauthorized" }` carrying the `GitHubAppError` as its
	 * cause: from a request's point of view, "could not authenticate" is an
	 * authorization failure, and widening every method's error channel to say so
	 * would tax every caller for a case only this layer can produce.
	 */
	static readonly clientLayer = (
		request: TokenRequest,
		options: GitHubAppOptions = {},
	): Layer.Layer<GitHubClient, GitHubAppError> =>
		Layer.effect(
			GitHubClient,
			Effect.flatMap(GitHubApp, (app) =>
				makeRotatingClient(
					Effect.map(app.token(request), (minted) => ({
						token: minted.token,
						expiresAtMillis: DateTime.toEpochMillis(minted.expiresAt),
					})),
					app.revoke,
					options,
					"GitHubApp.clientLayer",
				),
			),
		).pipe(Layer.provide(GitHubApp.layerWith(options)));

	/**
	 * A {@link GitHubClient} authenticated as the app itself, with an App JWT.
	 *
	 * @remarks
	 * An App JWT authenticates only the app-level routes: `/app` and everything
	 * under `/app/*` (the app's installations and their token mint, its webhook
	 * configuration and deliveries), plus the three installation lookups that
	 * require a JWT: `GET /repos/{owner}/{repo}/installation`,
	 * `GET /orgs/{org}/installation` and `GET /users/{username}/installation`.
	 * Installation-scoped routes (a repository's contents, issues, pulls and the
	 * rest) answer 401 to it; reach those through {@link GitHubApp.clientLayer}
	 * with an installation token instead.
	 *
	 * The motivating use is a webhook redelivery sweep, which lists recent
	 * deliveries with `GET /app/hook/deliveries` and redelivers a failed one
	 * with `POST /app/hook/deliveries/{delivery_id}/attempts`.
	 *
	 * The JWT is signed locally, never fetched, so building the layer makes no
	 * request; a key that will not sign fails construction with
	 * `GitHubAppError { kind: "jwt" }`. A JWT lives nine minutes and is
	 * re-signed a minute before it expires, so a long-running sweep keeps
	 * authenticating; calls in between reuse it. It cannot be revoked, so
	 * release does nothing. A later signing failure surfaces to the caller as
	 * `GitHubError { kind: "unauthorized" }` carrying the `GitHubAppError` as
	 * its cause, as with {@link GitHubApp.clientLayer}.
	 *
	 * @example
	 * ```ts
	 * import { GitHubApp, GitHubClient } from "@effected/github";
	 * import { Effect, Redacted } from "effect";
	 *
	 * const sweep = Effect.gen(function* () {
	 *   const client = yield* GitHubClient;
	 *   const deliveries = yield* client.request("GET /app/hook/deliveries", { per_page: 100 });
	 *   for (const delivery of deliveries) {
	 *     if (delivery.status_code >= 400) {
	 *       yield* client.request("POST /app/hook/deliveries/{delivery_id}/attempts", {
	 *         // octokit types a delivery id as number | bigint; the route takes a number.
	 *         delivery_id: Number(delivery.id),
	 *       });
	 *     }
	 *   }
	 * });
	 *
	 * const layer = GitHubApp.appClientLayer({
	 *   appId: "12345",
	 *   privateKey: Redacted.make("-----BEGIN RSA PRIVATE KEY-----\n..."),
	 * });
	 *
	 * Effect.runPromise(Effect.provide(sweep, layer));
	 * ```
	 */
	static readonly appClientLayer = (
		credentials: AppCredentials,
		options: GitHubAppOptions = {},
	): Layer.Layer<GitHubClient, GitHubAppError> =>
		Layer.effect(
			GitHubClient,
			makeRotatingClient(mintJwt(credentials), () => Effect.void, options, "GitHubApp.appClientLayer"),
		);

	/**
	 * An installation token, reused from an {@link InstallationTokenStore}
	 * while it has `margin` (five minutes by default) left to live.
	 *
	 * @remarks
	 * For a program that authenticates per request scope (a Worker handling a
	 * webhook, say) and would otherwise mint a fresh token every time. The store
	 * is keyed by installation id. A stored value that will not decode, or a
	 * token within `margin` of expiry, is a miss: the token is minted with
	 * {@link GitHubAppShape.token} and written back with a TTL of its expiry
	 * minus `margin`. A token minted with less than `margin` to live is returned
	 * but not stored.
	 *
	 * The store never fails this call: a `get` that fails or dies is a miss and
	 * a `set` that fails or dies is ignored. Only interruption propagates.
	 *
	 * **A cached token is never revoked**: another scope or isolate may be using
	 * it. It expires on its own, within the hour.
	 *
	 * Two concurrent calls that both miss will both mint, and the later write
	 * wins. That is expected: the store may span isolates, so the kit cannot
	 * lock it, and an extra token costs one call and expires on its own.
	 *
	 * The encoded value written to the store contains the raw token, so
	 * encrypting it at rest is the store's job.
	 */
	static readonly cachedToken = (
		request: CachedTokenRequest,
	): Effect.Effect<CachedToken, GitHubAppError, GitHubApp | InstallationTokenStore> => cachedTokenFor(request);

	/**
	 * A {@link GitHubClient} authenticated with {@link GitHubApp.cachedToken}.
	 *
	 * @remarks
	 * Built per request scope: provide it where the request is handled, over a
	 * `GitHubApp` and an `InstallationTokenStore` provided once at the edge.
	 * Unlike {@link GitHubApp.clientLayer} it **never revokes** the token, not
	 * even on release, because the token is shared through the store, and it
	 * does not rotate, so set `margin` longer than the scope's work can take;
	 * the token is good for at least `margin` unless GitHub issued it with less
	 * (see {@link CachedTokenRequest.margin}).
	 *
	 * `options` configures this client's transport only, not the mint: the
	 * token is minted by whichever `GitHubApp` the edge provides. On GitHub
	 * Enterprise, build that with the same API root, for example
	 * `GitHubApp.layerWith({ baseUrl })`, or the mint goes to github.com.
	 *
	 * @example
	 * ```ts
	 * import { GitHubApp, GitHubClient, InstallationTokenStore } from "@effected/github";
	 * import { Effect, Layer, Redacted } from "effect";
	 *
	 * const handle = (installationId: number) =>
	 *   Effect.flatMap(GitHubClient, (client) =>
	 *     client.request("GET /repos/{owner}/{repo}", { owner: "acme", repo: "widgets" }),
	 *   ).pipe(
	 *     Effect.provide(
	 *       GitHubApp.cachedClientLayer({
	 *         appId: "12345",
	 *         privateKey: Redacted.make("-----BEGIN RSA PRIVATE KEY-----\n..."),
	 *         installationId,
	 *       }),
	 *     ),
	 *   );
	 *
	 * // Once, at the edge. On GitHub Enterprise, use GitHubApp.layerWith({ baseUrl }).
	 * const Live = Layer.mergeAll(GitHubApp.layer, InstallationTokenStore.layerMemory);
	 *
	 * Effect.runPromise(Effect.provide(handle(42), Live));
	 * ```
	 */
	static readonly cachedClientLayer = (
		request: CachedTokenRequest,
		options: GitHubAppOptions = {},
	): Layer.Layer<GitHubClient, GitHubAppError, GitHubApp | InstallationTokenStore> =>
		Layer.unwrap(
			Effect.map(cachedTokenFor(request), (cached) =>
				GitHubClient.layerFromToken({ ...options, token: cached.token.token }),
			),
		);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<GitHubAppShape> = {}): GitHubAppShape => ({
		token: overrides.token ?? (() => unstubbed("token")),
		scopedToken: overrides.scopedToken ?? (() => unstubbed("scopedToken")),
		revoke: overrides.revoke ?? (() => unstubbed("revoke")),
		identity: overrides.identity ?? (() => unstubbed("identity")),
		installations: overrides.installations ?? (() => unstubbed("installations")),
	});

	/** {@link GitHubApp.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<GitHubAppShape> = {}): Layer.Layer<GitHubApp> =>
		Layer.succeed(GitHubApp, GitHubApp.makeTest(overrides));
}

/**
 * The app-authentication surface.
 *
 * @remarks
 * Every member is a function returning an `Effect`, so a partial double stays
 * partial. `installations` takes credentials rather than being an
 * `Effect`-valued property because the credentials are per-call, not per-layer.
 *
 * @public
 */
export interface GitHubAppShape {
	/**
	 * Mint an installation token.
	 *
	 * @remarks
	 * `installationId` is used when given; otherwise the installation is
	 * discovered from `owner`, or from the app's only installation.
	 */
	readonly token: (request: TokenRequest) => Effect.Effect<InstallationToken, GitHubAppError>;
	/**
	 * Mint a token that is revoked, best-effort, when the scope closes.
	 *
	 * @remarks
	 * Mints through `token` and releases through `revoke`.
	 */
	readonly scopedToken: (request: TokenRequest) => Effect.Effect<InstallationToken, GitHubAppError, Scope.Scope>;
	/**
	 * Revoke a token now.
	 */
	readonly revoke: (token: Redacted.Redacted<string>) => Effect.Effect<void, GitHubAppError>;
	/**
	 * Resolve the app's slug, name and bot user id.
	 *
	 * @remarks
	 * Supply `installationToken` when you have one: `GET /users/{slug}[bot]`
	 * rejects an app JWT, so without it the lookup runs unauthenticated at
	 * GitHub's 60-requests-per-hour-per-IP limit.
	 */
	readonly identity: (
		request: AppCredentials & { readonly installationToken?: Redacted.Redacted<string> | undefined },
	) => Effect.Effect<AppIdentity, GitHubAppError>;
	/** Every installation of the app. */
	readonly installations: (credentials: AppCredentials) => Effect.Effect<ReadonlyArray<Installation>, GitHubAppError>;
}

/** The cached-token margin when a request names none. */
const DEFAULT_CACHE_MARGIN = Duration.minutes(5);

/** `InstallationToken` as the JSON string an {@link InstallationTokenStore} holds. */
const StoredToken = Schema.fromJsonString(InstallationToken);

/** A store call that can never fail its caller: failures and defects become `fallback`; interruption propagates. */
const swallowStore = <A>(effect: Effect.Effect<A>, fallback: A): Effect.Effect<A> =>
	Effect.catchCause(effect, (cause) =>
		Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.succeed(fallback),
	);

const cachedTokenFor = Effect.fn("GitHubApp.cachedToken")(function* (request: CachedTokenRequest) {
	// `Duration.fromInput(NaN)` is zero, not `None`, so a raw non-finite
	// number is refused before the conversion.
	const input = request.margin ?? DEFAULT_CACHE_MARGIN;
	const margin =
		typeof input === "number" && !Number.isFinite(input)
			? Option.none<Duration.Duration>()
			: Option.filter(
					Duration.fromInput(input),
					(duration) => Duration.isFinite(duration) && !Duration.isNegative(duration),
				);
	if (Option.isNone(margin)) {
		return yield* GitHubAppError.of("token", "the cache margin must be a finite, non-negative duration");
	}
	const app = yield* GitHubApp;
	const store = yield* InstallationTokenStore;

	const stored = yield* swallowStore(store.get(request.installationId), Option.none<string>());
	if (Option.isSome(stored)) {
		const decoded = yield* Effect.option(Schema.decodeUnknownEffect(StoredToken)(stored.value));
		const now = yield* Clock.currentTimeMillis;
		if (
			Option.isSome(decoded) &&
			decoded.value.installationId === request.installationId &&
			!decoded.value.isExpired(now, margin.value)
		) {
			return { token: decoded.value, source: "cached" } satisfies CachedToken;
		}
	}

	const minted = yield* app.token(request);
	const now = yield* Clock.currentTimeMillis;
	const ttlMillis = DateTime.toEpochMillis(minted.expiresAt) - Duration.toMillis(margin.value) - now;
	// A token that will not outlive the margin is served once but never stored:
	// a zero or negative TTL means nothing a store can honour.
	if (ttlMillis > 0) {
		const encoded = yield* Effect.option(Schema.encodeUnknownEffect(StoredToken)(minted));
		if (Option.isSome(encoded)) {
			yield* swallowStore(store.set(request.installationId, encoded.value, Duration.millis(ttlMillis)), undefined);
		}
	}
	return { token: minted, source: "minted" } satisfies CachedToken;
});

const unstubbed = (member: string): never => {
	throw new Error(`GitHubApp.makeTest: ${member}() was called but not stubbed — pass an override.`);
};

/** Mint an app JWT: iat 60 s in the past (clock drift), exp 9 minutes after now (GitHub caps at 10). */
const mintJwt = (credentials: AppCredentials): Effect.Effect<RotatingCredential, GitHubAppError> =>
	Effect.gen(function* () {
		const key = yield* JwtKey.fromPkcs8Pem(credentials.privateKey, { alg: "RS256" });
		const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
		const exp = now + 9 * 60;
		const token = yield* Jwt.sign({ iat: now - 60, exp, iss: credentials.appId }, key);
		return { token: Redacted.make(token), expiresAtMillis: exp * 1000 };
	}).pipe(Effect.catchTag("JwtError", (error) => Effect.fail(GitHubAppError.of("jwt", error.detail, error))));

/** A client speaking as the app itself. */
const asApp = (
	credentials: AppCredentials,
	options: GitHubAppOptions,
): Effect.Effect<GitHubClientShape, GitHubAppError> =>
	Effect.flatMap(mintJwt(credentials), ({ token }) => makeClientShape({ ...options, token }));

/** A client speaking as a holder of `token`, or as nobody when there is none. */
const asBearer = (
	token: Redacted.Redacted<string> | undefined,
	options: GitHubAppOptions,
): Effect.Effect<GitHubClientShape> => makeClientShape({ ...options, token: token ?? Redacted.make("") });

const appFailure = (kind: GitHubAppError["kind"]) => (error: GitHubError) =>
	Effect.fail(GitHubAppError.of(kind, error.reason, error));

function makeApp(options: GitHubAppOptions): Effect.Effect<GitHubAppShape> {
	return Effect.sync(() => {
		const installations = Effect.fn("GitHubApp.installations")(function* (credentials: AppCredentials) {
			const client = yield* asApp(credentials, options);
			const raw = yield* client.paginate("GET /app/installations", {}).pipe(Effect.catch(appFailure("installation")));
			return raw.map((entry) => {
				const account: Record<string, unknown> | undefined = entry.account ?? undefined;
				return Installation.make({
					id: numericId(entry.id),
					...(account !== undefined && typeof account.login === "string" ? { account: account.login } : {}),
					...readField("accountType", Schema.String, account?.type),
					...readField("accountId", Schema.Int, typeof account?.id === "bigint" ? numericId(account.id) : account?.id),
					...readField("suspendedAt", SuspendedAt, entry.suspended_at),
					...readField("updatedAt", Schema.DateTimeUtcFromString, entry.updated_at),
				});
			});
		});

		const resolveInstallationId = (request: TokenRequest): Effect.Effect<number, GitHubAppError> =>
			request.installationId !== undefined
				? Effect.succeed(request.installationId)
				: Effect.gen(function* () {
						const all = yield* installations(request);
						if (request.owner !== undefined) {
							const wanted = request.owner.toLowerCase();
							const match = all.find((entry) => entry.account?.toLowerCase() === wanted);
							if (match !== undefined) return match.id;
							return yield* Effect.fail(
								GitHubAppError.of(
									"installation",
									`the app is not installed on ${request.owner} (installed on: ${all.map((entry) => entry.account ?? entry.id).join(", ") || "nothing"})`,
								),
							);
						}
						const only = all[0];
						if (all.length === 1 && only !== undefined) return only.id;
						return yield* Effect.fail(
							GitHubAppError.of(
								"installation",
								all.length === 0
									? "the app has no installations"
									: `the app has ${all.length} installations; pass installationId or owner`,
							),
						);
					});

		const token = Effect.fn("GitHubApp.token")(function* (request: TokenRequest) {
			const installationId = yield* resolveInstallationId(request);
			const client = yield* asApp(request, options);
			const minted = yield* client
				.request("POST /app/installations/{installation_id}/access_tokens", { installation_id: installationId })
				.pipe(Effect.catch(appFailure("token")));
			return yield* Schema.decodeUnknownEffect(InstallationToken)({
				token: minted.token,
				expiresAt: minted.expires_at,
				installationId,
				permissions: normalizePermissions(minted.permissions),
			}).pipe(
				Effect.catchTag("SchemaError", (error) =>
					Effect.fail(GitHubAppError.of("token", "GitHub returned an unexpected token payload", error)),
				),
			);
		});

		const revoke = Effect.fn("GitHubApp.revoke")(function* (value: Redacted.Redacted<string>) {
			const client = yield* asBearer(value, options);
			yield* client.request("DELETE /installation/token", {}).pipe(Effect.catch(appFailure("revoke")));
		});

		const scopedToken = (request: TokenRequest): Effect.Effect<InstallationToken, GitHubAppError, Scope.Scope> =>
			Effect.acquireRelease(token(request), (minted) => Effect.ignore(revoke(minted.token)));

		const identity = Effect.fn("GitHubApp.identity")(function* (
			request: AppCredentials & { readonly installationToken?: Redacted.Redacted<string> | undefined },
		) {
			const appClient = yield* asApp(request, options);
			const app = yield* appClient.request("GET /app", {}).pipe(Effect.catch(appFailure("identity")));
			if (app === null) {
				return yield* Effect.fail(GitHubAppError.of("identity", "GET /app returned no app"));
			}
			const slug = app.slug ?? "";
			const name = app.name;
			// `GET /users/{slug}[bot]` rejects an app JWT, so this bears the
			// installation token when one was supplied and otherwise runs
			// unauthenticated — 60 requests per hour per IP.
			const userClient = yield* asBearer(request.installationToken, options);
			const user = yield* userClient.request("GET /users/{username}", { username: `${slug}[bot]` }).pipe(Effect.option);
			return AppIdentity.make({
				slug,
				name,
				...(Option.isSome(user) ? { userId: numericId(user.value.id) } : {}),
			});
		});

		return { token, scopedToken, revoke, identity, installations };
	});
}

/** GitHub's permission values are strings; anything else is not a permission. */
const normalizePermissions = (raw: unknown): Record<string, string> => {
	if (typeof raw !== "object" || raw === null) return {};
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value === "string") out[key] = value;
	}
	return out;
};

/** A credential a rotating client holds: the bearer value and when it stops working. */
interface RotatingCredential {
	readonly token: Redacted.Redacted<string>;
	readonly expiresAtMillis: number;
}

/**
 * A client shape that re-mints its credential before it expires.
 *
 * @remarks
 * The rotation is invisible to a caller: each member resolves the current
 * client first, and "current" means "minted, and not within a minute of
 * expiry" (the same skew as {@link InstallationToken.isExpired}). Rotating
 * releases the credential it replaces, so at most one live credential exists
 * at a time and the scope's release releases the last of them. An
 * installation token is released by revoking it; an App JWT has nothing to
 * release.
 */
const makeRotatingClient = (
	mint: Effect.Effect<RotatingCredential, GitHubAppError>,
	release: (token: Redacted.Redacted<string>) => Effect.Effect<void, GitHubAppError>,
	options: GitHubAppOptions,
	operation: string,
): Effect.Effect<GitHubClientShape, GitHubAppError, Scope.Scope> =>
	Effect.gen(function* () {
		const held = yield* Ref.make(Option.none<{ credential: RotatingCredential; client: GitHubClientShape }>());

		const revokeHeld = Effect.flatMap(Ref.get(held), (current) =>
			Option.isSome(current) ? Effect.ignore(release(current.value.credential.token)) : Effect.void,
		);

		const rotate = Effect.gen(function* () {
			yield* revokeHeld;
			const minted = yield* mint;
			const client = yield* makeClientShape({ ...options, token: minted.token });
			yield* Ref.set(held, Option.some({ credential: minted, client }));
			return client;
		});

		// Mint eagerly so a misconfigured app fails at layer construction, where
		// the error is a `GitHubAppError` a caller can read, rather than on the
		// first request as an opaque authorization failure.
		yield* rotate;
		yield* Effect.addFinalizer(() => revokeHeld);

		const live: Effect.Effect<Option.Option<GitHubClientShape>> = Effect.gen(function* () {
			const now = yield* Clock.currentTimeMillis;
			const state = yield* Ref.get(held);
			return Option.isSome(state) && !isSpent(state.value.credential.expiresAtMillis, now)
				? Option.some(state.value.client)
				: Option.none();
		});

		// One rotation at a time. Without the lock, N fibers that find the
		// credential spent together each mint, overwriting (and so leaking) all
		// but the last replacement, and one fiber's release can revoke the token
		// another has just installed and is using. A fiber that waited re-checks
		// after acquiring, so the first rotation serves every waiter.
		const lock = yield* Semaphore.make(1);

		/** The live client, re-minting first if the held credential is spent. */
		const fresh: Effect.Effect<GitHubClientShape, GitHubAppError> = Effect.flatMap(live, (current) =>
			Option.isSome(current)
				? Effect.succeed(current.value)
				: lock.withPermit(
						Effect.flatMap(live, (rechecked) => (Option.isSome(rechecked) ? Effect.succeed(rechecked.value) : rotate)),
					),
		);

		// A credential failure is reported in the channel the caller is already
		// handling: "could not authenticate" IS an authorization failure from a
		// request's point of view, and widening every method's error type to add a
		// GitHubAppError would tax every caller for a case only this layer can
		// produce.
		const current: Effect.Effect<GitHubClientShape, GitHubError> = fresh.pipe(
			Effect.catchTag("GitHubAppError", (error) =>
				Effect.fail(
					new GitHubError({
						kind: "unauthorized",
						operation,
						reason: error.reason,
						cause: error,
					}),
				),
			),
		);

		const currentForGraphQL: Effect.Effect<GitHubClientShape, GitHubGraphQLError> = fresh.pipe(
			Effect.catchTag("GitHubAppError", (error) =>
				Effect.fail(
					new GitHubGraphQLError({
						kind: "unauthorized",
						operation,
						reason: error.reason,
						errors: [],
						cause: error,
					}),
				),
			),
		);

		return {
			request: (route, params) => Effect.flatMap(current, (client) => client.request(route, params)),
			requestDecoded: (route, params, schema) =>
				Effect.flatMap(current, (client) => client.requestDecoded(route, params, schema)),
			paginate: (route, params, pageOptions) =>
				Effect.flatMap(current, (client) => client.paginate(route, params, pageOptions)),
			paginateStream: (route, params, pageOptions) =>
				Stream.unwrap(Effect.map(current, (client) => client.paginateStream(route, params, pageOptions))),
			graphql: (document, variables) =>
				Effect.flatMap(currentForGraphQL, (client) => client.graphql(document, variables)),
			rateLimit: Effect.flatMap(Ref.get(held), (state) =>
				Option.isSome(state) ? state.value.client.rateLimit : Effect.succeed(Option.none()),
			),
		} satisfies GitHubClientShape;
	});
