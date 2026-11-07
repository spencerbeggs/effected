import { HttpRedaction } from "@effected/crypto";
import { Clock, Context, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { API_VERSION_PATTERN, DEFAULT_API_VERSION } from "./internal/apiVersion.js";
import { unstubbed } from "./internal/unstubbed.js";

/**
 * Which `GitHubUserAuth` operation a failure came from.
 *
 * @public
 */
export const GitHubUserAuthOperation = Schema.Literals(["exchange", "refresh", "revokeGrant"]);

/**
 * The decoded type of {@link (GitHubUserAuthOperation:variable)}.
 *
 * @public
 */
export type GitHubUserAuthOperation = typeof GitHubUserAuthOperation.Type;

/**
 * A user-to-server token pair that expires: what GitHub issues to a GitHub
 * App with "Expire user authorization tokens" turned on, which is the default.
 *
 * @remarks
 * Times are absolute instants, computed from GitHub's `expires_in` and
 * `refresh_token_expires_in` against `Clock` when the reply arrived, the same
 * way `InstallationToken.expiresAt` is.
 *
 * Encodable, like `InstallationToken`: `Schema.encodeUnknownEffect` over
 * {@link (GitHubUserTokens:variable)} produces JSON with both tokens as plain
 * strings and both times as ISO instants, which is how a caller persists a
 * user's grant. Encrypting it at rest is the caller's job.
 *
 * @public
 */
export class ExpiringUserTokens extends Schema.Class<ExpiringUserTokens>("ExpiringUserTokens")({
	/** The discriminant: these tokens expire, and the refresh token renews them. */
	expiry: Schema.tag("expiring"),
	/** The user access token. Decodes to `Redacted`, encodes back to the raw string. */
	accessToken: Schema.RedactedFromValue(Schema.String),
	/** GitHub's `token_type`, `bearer` in practice. */
	tokenType: Schema.String,
	/**
	 * GitHub's `scope`, as sent: a comma-separated list for an OAuth App and
	 * the empty string for a GitHub App, whose user tokens carry the app's
	 * permissions instead of scopes.
	 */
	scope: Schema.String,
	/** When GitHub stops accepting the access token — eight hours out by default. */
	expiresAt: Schema.DateTimeUtcFromString,
	/** The refresh token. Decodes to `Redacted`, encodes back to the raw string. */
	refreshToken: Schema.RedactedFromValue(Schema.String),
	/** When GitHub stops accepting the refresh token — six months out by default. */
	refreshTokenExpiresAt: Schema.DateTimeUtcFromString,
}) {
	/**
	 * Whether the access token is spent, `skew` before its stated expiry.
	 *
	 * @remarks
	 * `skew` defaults to one minute, so a token is treated as spent slightly
	 * early rather than answering 401 mid-request.
	 */
	isExpired(nowMillis: number, skew: Duration.Duration = DEFAULT_SKEW): boolean {
		return isSpent(DateTime.toEpochMillis(this.expiresAt), nowMillis, skew);
	}

	/**
	 * Whether the refresh token is spent, `skew` before its stated expiry. A
	 * spent refresh token cannot renew the grant: the user has to authorize
	 * again.
	 */
	isRefreshExpired(nowMillis: number, skew: Duration.Duration = DEFAULT_SKEW): boolean {
		return isSpent(DateTime.toEpochMillis(this.refreshTokenExpiresAt), nowMillis, skew);
	}
}

/**
 * A user access token that does not expire: what GitHub issues to an OAuth
 * App, or to a GitHub App with "Expire user authorization tokens" turned off.
 * It carries no refresh token and no expiry.
 *
 * @public
 */
export class NonExpiringUserTokens extends Schema.Class<NonExpiringUserTokens>("NonExpiringUserTokens")({
	/** The discriminant: this token does not expire and cannot be refreshed. */
	expiry: Schema.tag("non-expiring"),
	/** The user access token. Decodes to `Redacted`, encodes back to the raw string. */
	accessToken: Schema.RedactedFromValue(Schema.String),
	/** GitHub's `token_type`, `bearer` in practice. */
	tokenType: Schema.String,
	/** GitHub's `scope`, as sent; see `ExpiringUserTokens.scope`. */
	scope: Schema.String,
}) {}

/**
 * What a code exchange answers, discriminated by `expiry`: `expiring` carries
 * a refresh token and both expiry instants, `non-expiring` carries neither.
 *
 * @remarks
 * **Construct the variant classes, never the union.** The union's inherited
 * `make` typechecks against both variants at once and reports a wrong field
 * as a two-branch error; {@link ExpiringUserTokens}`.make` and
 * {@link NonExpiringUserTokens}`.make` fill `expiry` themselves. The union is
 * a `Schema` so a stored grant decodes back into the right variant.
 *
 * @public
 */
export const GitHubUserTokens = Schema.Union([ExpiringUserTokens, NonExpiringUserTokens]);

/**
 * The decoded type of {@link (GitHubUserTokens:variable)}:
 * {@link ExpiringUserTokens} `|` {@link NonExpiringUserTokens}.
 *
 * @public
 */
export type GitHubUserTokens = typeof GitHubUserTokens.Type;

/**
 * GitHub refused the call, and repeating it will not change the answer.
 *
 * @remarks
 * `remedy` says what has to change, and it is the field to branch on:
 *
 * - `"reconnect"` — the user's side is dead: the authorization code was
 *   wrong, expired or already used (`bad_verification_code`), the refresh
 *   token was revoked or expired (`bad_refresh_token`), or the grant is
 *   already gone. Send the user through the authorization flow again, and
 *   drop the tokens you hold for them.
 * - `"reconfigure"` — the app's side is wrong: its client id or secret
 *   (`incorrect_client_credentials`), its callback URL
 *   (`redirect_uri_mismatch`), refresh tokens being turned off for it
 *   (`unsupported_grant_type`), or a code GitHub sent that this package does
 *   not know. Nothing about the user's grant is learned, and reconnecting the
 *   user does not help; an operator has to fix the app. A 401, 403 or 404
 *   with no `error` code lands here too — but never a 403 whose message
 *   names a rate limit (or GitHub's older "abuse detection" wording), which
 *   is a {@link GitHubUserAuthTemporary}.
 *
 * **Never wipe a user's tokens on `GitHubUserAuthFinal` alone.** The obvious
 * handler, `Effect.catchTag("GitHubUserAuthFinal", () => forgetUser(id))`,
 * typechecks, runs and reports success, and on a rotated or mistyped client
 * secret it signs every user out at once, because every refresh then answers
 * `incorrect_client_credentials`. silk-app's hand-rolled flow carried this
 * exact rule as a comment before the kit had this error. Match on
 * `remedy === "reconnect"`.
 *
 * GitHub answers the token endpoint with HTTP 200 and an `error` body when it
 * refuses a code or a refresh token, so `status` is usually 200. `code` is
 * GitHub's `error` code when it sent one (an unrecognisable one reads
 * `unknown_error`), and `http_<status>` when GitHub answered a non-success
 * status with no error code. `description` is GitHub's `error_description`
 * (or the REST `message`), with any credential this call carried replaced by
 * `REDACTED`.
 *
 * @public
 */
export class GitHubUserAuthFinal extends Schema.TaggedError<GitHubUserAuthFinal>()("GitHubUserAuthFinal", {
	/** The operation GitHub refused. */
	operation: GitHubUserAuthOperation,
	/** What has to change before the call can succeed. */
	remedy: Schema.Literals(["reconnect", "reconfigure"]),
	/** GitHub's `error` code, or `http_<status>`. */
	code: Schema.String,
	/** GitHub's own explanation, scrubbed of this call's credentials. */
	description: Schema.optionalKey(Schema.String),
	/** The HTTP status GitHub answered with. */
	status: Schema.Int,
}) {
	override get message(): string {
		return `GitHub user auth ${this.operation} refused (${this.code}, HTTP ${this.status})${
			this.description === undefined ? "" : `: ${this.description}`
		} — ${this.remedy === "reconnect" ? "the user must authorize again" : "the app's configuration must be fixed"}`;
	}
}

/**
 * The call did not get an answer GitHub meant: try it again later.
 *
 * @remarks
 * `kind` is the reason:
 *
 * - `"network"` — `fetch` threw, or the body could not be read;
 * - `"timeout"` — no complete answer within the layer's `timeout`;
 * - `"status"` — GitHub answered 5xx, 429 or 408, or a 403 whose message
 *   names a rate limit or "abuse detection" (GitHub's primary REST rate
 *   limit answers 403, and its secondary limits answer 403 or 429);
 * - `"malformed"` — a success status whose body is not a token reply, or a
 *   refresh that answered a token with no refresh token.
 *
 * None of these is a refusal of the user's grant, so a caller keeps the
 * tokens it holds and retries later.
 *
 * One case does not leave the grant as it was. GitHub refresh tokens are
 * single-use and rotate when a refresh succeeds, so a refresh GitHub
 * processed has already spent the refresh token the caller sent: a
 * `"malformed"` with a 2xx `status` (GitHub answered, the reply was
 * rejected), or a `"network"` or `"timeout"` that ended after the request
 * reached GitHub. Retrying such a refresh with the same refresh token answers
 * `bad_refresh_token`, a {@link GitHubUserAuthFinal} with
 * `remedy: "reconnect"`. That is the expected consequence, not a second
 * fault: the user authorizes again.
 *
 * `cause` is a copy of what `fetch` threw, rebuilt with its message, stack
 * and primitive fields scrubbed of this call's credentials, never the
 * original: a custom `fetch` can put the request (and so the client secret)
 * in its error.
 *
 * @public
 */
export class GitHubUserAuthTemporary extends Schema.TaggedError<GitHubUserAuthTemporary>()("GitHubUserAuthTemporary", {
	/** The operation that did not complete. */
	operation: GitHubUserAuthOperation,
	/** Why it did not complete. */
	kind: Schema.Literals(["network", "timeout", "status", "malformed"]),
	/** The HTTP status, when a response arrived. */
	status: Schema.optionalKey(Schema.Int),
	/** A credential-free copy of what `fetch` threw, for `network`. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		const status = this.status === undefined ? "" : ` (HTTP ${this.status})`;
		const what =
			this.kind === "network"
				? "the request could not be sent or its reply read"
				: this.kind === "timeout"
					? "GitHub did not answer in time"
					: this.kind === "status"
						? "GitHub answered with a server error or a rate limit"
						: "GitHub answered with a body that is not a token reply";
		return `GitHub user auth ${this.operation} failed temporarily${status}: ${what}`;
	}
}

/**
 * Every failure of a `GitHubUserAuth` operation: final (reconnect or
 * reconfigure) or temporary (retry later).
 *
 * @public
 */
export type GitHubUserAuthError = GitHubUserAuthFinal | GitHubUserAuthTemporary;

/**
 * How a {@link GitHubUserAuth} layer is built.
 *
 * @public
 */
export interface GitHubUserAuthOptions {
	/** The app's OAuth client id (`Iv1.…` or `Iv23…` for a GitHub App). */
	readonly clientId: string;
	/** The app's OAuth client secret. */
	readonly clientSecret: Redacted.Redacted<string>;
	/**
	 * A replacement for the global `fetch`, for Workers, proxies and tests —
	 * the same shape as `GitHubClientOptions.fetch`.
	 *
	 * @remarks
	 * It receives an `AbortSignal` on every call, aborted when the call times
	 * out or the caller is interrupted.
	 */
	readonly fetch?: typeof globalThis.fetch | undefined;
	/**
	 * The token endpoint. Defaults to
	 * `https://github.com/login/oauth/access_token`; a GitHub Enterprise Server
	 * app uses `https://<host>/login/oauth/access_token`.
	 */
	readonly tokenUrl?: string | undefined;
	/**
	 * The REST API root the grant revoke goes to. Defaults to
	 * `https://api.github.com`; a GitHub Enterprise Server app uses
	 * `https://<host>/api/v3`.
	 */
	readonly apiUrl?: string | undefined;
	/**
	 * The REST api-version the grant revoke pins, sent as
	 * `x-github-api-version`. Defaults to the same version `GitHubClient`
	 * pins; must be `YYYY-MM-DD`.
	 */
	readonly apiVersion?: string | undefined;
	/** The `user-agent` every request sends. Defaults to `@effected/github`. */
	readonly userAgent?: string | undefined;
	/**
	 * How long one call may take, request and body together, before it fails
	 * as `GitHubUserAuthTemporary` with `kind: "timeout"`. Defaults to ten
	 * seconds; must be finite and positive.
	 */
	readonly timeout?: Duration.Input | undefined;
}

/**
 * The code a user brought back from GitHub's authorize page.
 *
 * @public
 */
export interface UserAuthExchangeRequest {
	/** The `code` query parameter GitHub redirected back with. */
	readonly code: string;
	/** The PKCE `code_verifier` whose S256 challenge the authorize URL carried. */
	readonly codeVerifier?: string | undefined;
	/** The `redirect_uri` the authorize URL carried, when it carried one. */
	readonly redirectUri?: string | undefined;
}

/**
 * A refresh token to renew.
 *
 * @public
 */
export interface UserAuthRefreshRequest {
	/** The refresh token from the last exchange or refresh. */
	readonly refreshToken: Redacted.Redacted<string>;
}

/**
 * A user's grant to revoke.
 *
 * @public
 */
export interface UserAuthRevokeRequest {
	/** Any live access token from the grant. */
	readonly accessToken: Redacted.Redacted<string>;
}

/**
 * The operations of {@link GitHubUserAuth}.
 *
 * @public
 */
export interface GitHubUserAuthShape {
	/**
	 * Trade an authorization code (and its PKCE verifier) for the user's
	 * tokens.
	 */
	readonly exchange: (request: UserAuthExchangeRequest) => Effect.Effect<GitHubUserTokens, GitHubUserAuthError>;
	/**
	 * Renew an expiring grant. GitHub rotates the refresh token, so store the
	 * answer's `refreshToken` in place of the one you sent.
	 */
	readonly refresh: (request: UserAuthRefreshRequest) => Effect.Effect<ExpiringUserTokens, GitHubUserAuthError>;
	/**
	 * Revoke the user's whole grant to the app, every token it issued included:
	 * `DELETE /applications/{client_id}/grant` with HTTP Basic client
	 * authentication.
	 *
	 * @remarks
	 * A grant that is already gone answers 422, which fails as
	 * `GitHubUserAuthFinal` with `remedy: "reconnect"`; a caller that treats
	 * revocation as idempotent recovers that case.
	 */
	readonly revokeGrant: (request: UserAuthRevokeRequest) => Effect.Effect<void, GitHubUserAuthError>;
}

/**
 * The OAuth web flow a GitHub App (or an OAuth App) uses to act as a user:
 * PKCE code exchange, refresh, and grant revoke.
 *
 * @remarks
 * None of these calls go through `GitHubClient`: the token endpoint lives on
 * the web host rather than the REST host, and the revoke authenticates as the
 * app's OAuth client with HTTP Basic rather than with a bearer token. So the
 * service speaks to `fetch` directly, and this module imports neither octokit
 * nor the JWT signer — a Worker that only signs users in links neither.
 *
 * Every failure is one of two errors, and the split is the point:
 * {@link GitHubUserAuthFinal} when GitHub refused (read its `remedy` before
 * dropping anything), {@link GitHubUserAuthTemporary} when no real answer
 * arrived. GitHub answers a refused code or refresh token with HTTP 200 and an
 * `error` body, which is read as the refusal it is.
 *
 * The client secret, the code, the verifier and both tokens appear in no
 * error message, no span annotation and no kept cause.
 *
 * @example
 * ```ts
 * import { GitHubUserAuth } from "@effected/github";
 * import { Effect, Redacted } from "effect";
 *
 * const UserAuth = GitHubUserAuth.layer({
 *   clientId: "Iv23liExample",
 *   clientSecret: Redacted.make("app-client-secret"),
 * });
 *
 * const signIn = (code: string, codeVerifier: string) =>
 *   Effect.gen(function* () {
 *     const auth = yield* GitHubUserAuth;
 *     return yield* auth.exchange({ code, codeVerifier, redirectUri: "https://app.example/callback" });
 *   });
 *
 * Effect.runPromise(signIn("code-from-query", "verifier").pipe(Effect.provide(UserAuth)));
 * ```
 *
 * @public
 */
export class GitHubUserAuth extends Context.Service<GitHubUserAuth, GitHubUserAuthShape>()(
	"@effected/github/GitHubUserAuth",
) {
	/**
	 * The live service over `fetch`.
	 *
	 * @remarks
	 * Parameterized, so **bind the result to a `const`** and reuse it: each
	 * call mints a fresh layer, and layers are memoized by reference.
	 *
	 * Bad wiring — an empty client id, a URL that does not parse or is not
	 * `http(s)`, an api-version that is not `YYYY-MM-DD`, a timeout that is not
	 * finite and positive — dies while the layer builds, with a defect naming
	 * the option.
	 */
	static readonly layer = (options: GitHubUserAuthOptions): Layer.Layer<GitHubUserAuth> =>
		Layer.effect(GitHubUserAuth, makeUserAuth(options));

	/** An in-memory double; an unstubbed member dies when run, naming itself. */
	static readonly makeTest = (overrides: Partial<GitHubUserAuthShape> = {}): GitHubUserAuthShape => ({
		exchange: overrides.exchange ?? (() => dies("exchange")),
		refresh: overrides.refresh ?? (() => dies("refresh")),
		revokeGrant: overrides.revokeGrant ?? (() => dies("revokeGrant")),
	});

	/** {@link GitHubUserAuth.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<GitHubUserAuthShape> = {}): Layer.Layer<GitHubUserAuth> =>
		Layer.succeed(GitHubUserAuth, GitHubUserAuth.makeTest(overrides));
}

const dies = unstubbed("GitHubUserAuth.makeTest");

const DEFAULT_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEFAULT_API_URL = "https://api.github.com";
const DEFAULT_USER_AGENT = "@effected/github";
const DEFAULT_TIMEOUT = Duration.seconds(10);
const DEFAULT_SKEW = Duration.seconds(60);
const REDACTED = "REDACTED";
const MAX_DESCRIPTION = 500;
const MAX_CAUSE_DEPTH = 4;

const isSpent = (expiresAtMillis: number, nowMillis: number, skew: Duration.Duration): boolean =>
	expiresAtMillis - Duration.toMillis(skew) <= nowMillis;

// ---------------------------------------------------------------------------
// Pure core: classification and scrubbing, no IO.
// ---------------------------------------------------------------------------

/** GitHub `error` codes meaning the user's code, refresh token or grant is dead. */
const RECONNECT_CODES: ReadonlySet<string> = new Set([
	"bad_verification_code",
	"bad_refresh_token",
	"expired_token",
	"invalid_grant",
	"access_denied",
	"unverified_user_email",
]);

const ERROR_CODE = /^[a-z0-9_]{1,64}$/;

/** GitHub's prefixed token shapes (`ghu_`, `ghr_`, `gho_`, `ghp_`, `ghs_`, `github_pat_`), whoever sent them. */
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})/g;

/**
 * Replace every credential this call carried, then any GitHub token shape,
 * then anything else that reads as a credential.
 */
const scrub = (text: string, secrets: ReadonlyArray<string>): string => {
	let out = text;
	for (const secret of secrets) {
		// Short values would redact ordinary words; every real credential here is longer.
		if (secret.length >= 4) out = out.split(secret).join(REDACTED);
	}
	return HttpRedaction.text(out.replace(GITHUB_TOKEN, REDACTED));
};

/** A copy of a thrown value with nothing a credential could hide in left unscrubbed. */
const scrubCause = (thrown: unknown, secrets: ReadonlyArray<string>, depth = 0): Error => {
	if (!(thrown instanceof Error)) {
		return new Error(scrub(typeof thrown === "string" ? thrown : Object.prototype.toString.call(thrown), secrets));
	}
	const copy = new Error(scrub(thrown.message, secrets));
	copy.name = scrub(thrown.name, secrets);
	if (thrown.stack !== undefined) copy.stack = scrub(thrown.stack, secrets);
	for (const [key, value] of Object.entries(thrown)) {
		if (key === "message" || key === "stack" || key === "cause" || key === "name") continue;
		const kept =
			typeof value === "string"
				? scrub(value, secrets)
				: typeof value === "number" || typeof value === "boolean"
					? value
					: undefined;
		if (kept !== undefined) {
			Object.defineProperty(copy, key, { value: kept, enumerable: true, writable: true, configurable: true });
		}
	}
	if (thrown.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
		Object.defineProperty(copy, "cause", {
			value: scrubCause(thrown.cause, secrets, depth + 1),
			enumerable: false,
			writable: true,
			configurable: true,
		});
	}
	return copy;
};

/** `JSON.parse` that answers `undefined` rather than throwing. */
const parseJson = (text: string): unknown => {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
};

const ErrorReply = Schema.Struct({
	error: Schema.String,
	error_description: Schema.optionalKey(Schema.String),
});

const RestMessage = Schema.Struct({ message: Schema.String });

const TokenReply = Schema.Struct({
	access_token: Schema.NonEmptyString,
	token_type: Schema.optionalKey(Schema.String),
	scope: Schema.optionalKey(Schema.String),
	expires_in: Schema.optionalKey(Schema.Number),
	refresh_token: Schema.optionalKey(Schema.String),
	refresh_token_expires_in: Schema.optionalKey(Schema.Number),
});

type TokenReply = typeof TokenReply.Type;

// The decode answers are read as `Option`s and their failures dropped: a
// `SchemaError` over a token reply would carry the token it failed on.
const decodeErrorReply = Schema.decodeUnknownOption(ErrorReply);
const decodeRestMessage = Schema.decodeUnknownOption(RestMessage);
const decodeTokenReply = Schema.decodeUnknownOption(TokenReply);

/** 5xx, a rate limit or a request timeout: GitHub meant "later", not "no". */
const isRetryableStatus = (status: number): boolean => status >= 500 || status === 429 || status === 408;

const isSuccess = (status: number): boolean => status >= 200 && status < 300;

/**
 * GitHub's rate-limit wording: "rate limit" in its current bodies, "abuse
 * detection" in the older secondary-limit body ("You have triggered an abuse
 * detection mechanism …"). The match follows GitHub's English wording; a
 * reworded body falls back to the plain 403 classification.
 */
const RATE_LIMIT_MESSAGE = /rate limit|abuse detection/i;

/**
 * A 403 whose decoded REST `message` names a rate limit. GitHub's primary
 * REST rate limit answers 403, and its secondary limits answer 403 or 429;
 * the reply's headers are not kept, so the body's message ("API rate limit
 * exceeded for …", "You have exceeded a secondary rate limit …") is what tells
 * it from a 403 refusal of the app's credentials. Takes the already-decoded
 * message so a classifier reads the body through one decode.
 */
const isRateLimited403 = (status: number, message: Option.Option<typeof RestMessage.Type>): boolean =>
	status === 403 && Option.isSome(message) && RATE_LIMIT_MESSAGE.test(message.value.message);

const final = (
	operation: GitHubUserAuthOperation,
	status: number,
	code: string,
	remedy: GitHubUserAuthFinal["remedy"],
	description: string | undefined,
	secrets: ReadonlyArray<string>,
): GitHubUserAuthFinal =>
	new GitHubUserAuthFinal({
		operation,
		remedy,
		code,
		status,
		...(description === undefined ? {} : { description: scrub(description, secrets).slice(0, MAX_DESCRIPTION) }),
	});

const temporary = (
	operation: GitHubUserAuthOperation,
	kind: GitHubUserAuthTemporary["kind"],
	extra: { readonly status?: number; readonly cause?: Error } = {},
): GitHubUserAuthTemporary => new GitHubUserAuthTemporary({ operation, kind, ...extra });

/**
 * What a token-endpoint reply means: the token fields, or the failure.
 *
 * @remarks
 * The order is load-bearing. A retryable status wins over its body (a 503
 * page is never a refusal); an `error` body wins over the status (GitHub
 * refuses with 200); a 403 with no `error` whose message names a rate limit
 * is temporary; any other non-success status with no `error` is a refusal of
 * the app's request; only then is a success read as tokens.
 */
const classifyTokenReply = (
	operation: GitHubUserAuthOperation,
	status: number,
	text: string,
	secrets: ReadonlyArray<string>,
): TokenReply | GitHubUserAuthError => {
	if (isRetryableStatus(status)) return temporary(operation, "status", { status });
	const json = parseJson(text);
	const refusal = decodeErrorReply(json);
	if (Option.isSome(refusal)) {
		const raw = refusal.value.error;
		const code = ERROR_CODE.test(raw) ? raw : "unknown_error";
		const remedy = RECONNECT_CODES.has(code) ? "reconnect" : "reconfigure";
		return final(operation, status, code, remedy, refusal.value.error_description, secrets);
	}
	if (isRateLimited403(status, decodeRestMessage(json))) return temporary(operation, "status", { status });
	if (!isSuccess(status)) {
		return final(operation, status, `http_${status}`, "reconfigure", undefined, secrets);
	}
	const reply = decodeTokenReply(json);
	return Option.isSome(reply) ? reply.value : temporary(operation, "malformed", { status });
};

const isPositiveInteger = (value: number | undefined): value is number =>
	value !== undefined && Number.isInteger(value) && value > 0;

/** The tokens a reply carries at `nowMillis`, or `undefined` when its expiring fields are partial or invalid. */
const toTokens = (reply: TokenReply, nowMillis: number): GitHubUserTokens | undefined => {
	const base = {
		accessToken: Redacted.make(reply.access_token),
		tokenType: reply.token_type ?? "bearer",
		scope: reply.scope ?? "",
	};
	const { expires_in, refresh_token, refresh_token_expires_in } = reply;
	if (expires_in === undefined && refresh_token === undefined && refresh_token_expires_in === undefined) {
		return NonExpiringUserTokens.make(base);
	}
	if (
		!isPositiveInteger(expires_in) ||
		!isPositiveInteger(refresh_token_expires_in) ||
		refresh_token === undefined ||
		refresh_token.length === 0
	) {
		return undefined;
	}
	return ExpiringUserTokens.make({
		...base,
		expiresAt: DateTime.makeUnsafe(nowMillis + expires_in * 1000),
		refreshToken: Redacted.make(refresh_token),
		refreshTokenExpiresAt: DateTime.makeUnsafe(nowMillis + refresh_token_expires_in * 1000),
	});
};

/**
 * What a grant-revoke reply means.
 *
 * @remarks
 * 204 is success. 422 is GitHub's documented answer for an access token that
 * is not a live token of this app, so the grant is already gone. 401, 403 and
 * 404 are what GitHub answers a wrong client id or secret with — except a 403
 * whose message names a rate limit, which is GitHub's primary (or a
 * secondary) rate limit and so temporary.
 *
 * GitHub documents 422 as "Validation failed, or the endpoint has been
 * spammed", so a 422 can also be an abuse refusal of a grant that still
 * exists. It maps to `reconnect` all the same: a caller revoking is already
 * discarding the grant on its side, and the mapping has not been checked
 * against a live spam refusal.
 */
const classifyRevokeReply = (
	status: number,
	text: string,
	secrets: ReadonlyArray<string>,
): GitHubUserAuthError | undefined => {
	if (isSuccess(status)) return undefined;
	if (isRetryableStatus(status)) return temporary("revokeGrant", "status", { status });
	const message = decodeRestMessage(parseJson(text));
	if (isRateLimited403(status, message)) return temporary("revokeGrant", "status", { status });
	const description = Option.isSome(message) ? message.value.message : undefined;
	return status === 422
		? final("revokeGrant", status, "validation_failed", "reconnect", description, secrets)
		: final("revokeGrant", status, `http_${status}`, "reconfigure", description, secrets);
};

// ---------------------------------------------------------------------------
// Effectful edge: one `fetch` per call.
// ---------------------------------------------------------------------------

interface Reply {
	readonly status: number;
	readonly text: string;
}

const wiring = (message: string): Effect.Effect<never> => Effect.die(new Error(`GitHubUserAuth: ${message}`));

const validUrl = (name: string, value: string): Effect.Effect<string> => {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return wiring(`the ${name} option must be an absolute URL, got ${JSON.stringify(value)}`);
	}
	return parsed.protocol === "https:" || parsed.protocol === "http:"
		? Effect.succeed(value.replace(/\/+$/, ""))
		: wiring(`the ${name} option must be an http(s) URL, got ${JSON.stringify(value)}`);
};

const makeUserAuth = (options: GitHubUserAuthOptions): Effect.Effect<GitHubUserAuthShape> =>
	Effect.gen(function* () {
		if (options.clientId.length === 0) return yield* wiring("the clientId option must not be empty");
		const tokenUrl = yield* validUrl("tokenUrl", options.tokenUrl ?? DEFAULT_TOKEN_URL);
		const apiUrl = yield* validUrl("apiUrl", options.apiUrl ?? DEFAULT_API_URL);
		const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
		if (!API_VERSION_PATTERN.test(apiVersion)) {
			return yield* wiring(
				`the apiVersion option must be a calendar version like "${DEFAULT_API_VERSION}" (YYYY-MM-DD), got ${JSON.stringify(apiVersion)}`,
			);
		}
		const timeout = options.timeout === undefined ? Option.some(DEFAULT_TIMEOUT) : Duration.fromInput(options.timeout);
		if (Option.isNone(timeout) || !Duration.isFinite(timeout.value) || Duration.toMillis(timeout.value) <= 0) {
			return yield* wiring("the timeout option must be a finite, positive duration");
		}
		const ceiling = timeout.value;
		const { clientId, clientSecret } = options;
		const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
		const doFetch: typeof globalThis.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

		// One call: the request and its whole body inside the timeout, the
		// thrown value scrubbed before it is kept.
		//
		// The body is read inside the SAME `tryPromise` as the request, so the
		// one signal core aborts on an interrupt covers both. Core aborts a
		// `tryPromise` signal only while that effect is pending; a second
		// `tryPromise` for `response.text()` would leave a timeout during the
		// body read abandoning the request with its connection still open.
		const send = (
			operation: GitHubUserAuthOperation,
			url: string,
			init: RequestInit,
			secrets: ReadonlyArray<string>,
		): Effect.Effect<Reply, GitHubUserAuthTemporary> =>
			Effect.gen(function* () {
				// The status once headers arrive, so a body-read failure still reports it.
				let status: number | undefined;
				const reply = yield* Effect.tryPromise({
					try: async (signal): Promise<Reply> => {
						const response = await doFetch(url, { ...init, signal });
						status = response.status;
						return { status: response.status, text: await response.text() };
					},
					catch: (thrown) =>
						temporary(operation, "network", {
							...(status === undefined ? {} : { status }),
							cause: scrubCause(thrown, secrets),
						}),
				});
				yield* Effect.annotateCurrentSpan({ status: reply.status });
				return reply;
			}).pipe(
				Effect.timeoutOrElse({
					duration: ceiling,
					orElse: () => Effect.fail(temporary(operation, "timeout")),
				}),
			);

		const postToken = (
			operation: GitHubUserAuthOperation,
			fields: Record<string, string>,
			secrets: ReadonlyArray<string>,
		): Effect.Effect<TokenReply, GitHubUserAuthError> =>
			send(
				operation,
				tokenUrl,
				{
					method: "POST",
					headers: {
						accept: "application/json",
						"content-type": "application/x-www-form-urlencoded",
						"user-agent": userAgent,
					},
					body: new URLSearchParams(fields).toString(),
				},
				secrets,
			).pipe(
				Effect.flatMap((reply) => {
					const outcome = classifyTokenReply(operation, reply.status, reply.text, secrets);
					return outcome instanceof GitHubUserAuthFinal || outcome instanceof GitHubUserAuthTemporary
						? Effect.fail(outcome)
						: Effect.succeed(outcome);
				}),
			);

		const exchange = Effect.fn("GitHubUserAuth.exchange")(function* (request: UserAuthExchangeRequest) {
			const secret = Redacted.value(clientSecret);
			const secrets = [secret, request.code, ...(request.codeVerifier === undefined ? [] : [request.codeVerifier])];
			const reply = yield* postToken(
				"exchange",
				{
					client_id: clientId,
					client_secret: secret,
					code: request.code,
					...(request.codeVerifier === undefined ? {} : { code_verifier: request.codeVerifier }),
					...(request.redirectUri === undefined ? {} : { redirect_uri: request.redirectUri }),
				},
				secrets,
			);
			const tokens = toTokens(reply, yield* Clock.currentTimeMillis);
			if (tokens === undefined) return yield* temporary("exchange", "malformed", { status: 200 });
			return tokens;
		});

		const refresh = Effect.fn("GitHubUserAuth.refresh")(function* (request: UserAuthRefreshRequest) {
			const secret = Redacted.value(clientSecret);
			const refreshToken = Redacted.value(request.refreshToken);
			const reply = yield* postToken(
				"refresh",
				{
					client_id: clientId,
					client_secret: secret,
					grant_type: "refresh_token",
					refresh_token: refreshToken,
				},
				[secret, refreshToken],
			);
			const tokens = toTokens(reply, yield* Clock.currentTimeMillis);
			// A refresh that answers no refresh token leaves the caller unable to
			// refresh again; it is not the expiring pair this call promises.
			if (tokens === undefined || tokens.expiry !== "expiring") {
				return yield* temporary("refresh", "malformed", { status: 200 });
			}
			return tokens;
		});

		const revokeGrant = Effect.fn("GitHubUserAuth.revokeGrant")(function* (request: UserAuthRevokeRequest) {
			const secret = Redacted.value(clientSecret);
			const accessToken = Redacted.value(request.accessToken);
			const basic = Base64.encode(`${clientId}:${secret}`);
			const reply = yield* send(
				"revokeGrant",
				`${apiUrl}/applications/${encodeURIComponent(clientId)}/grant`,
				{
					method: "DELETE",
					headers: {
						authorization: `Basic ${basic}`,
						accept: "application/vnd.github+json",
						"content-type": "application/json",
						"x-github-api-version": apiVersion,
						"user-agent": userAgent,
					},
					body: JSON.stringify({ access_token: accessToken }),
				},
				[secret, accessToken, basic],
			);
			const failure = classifyRevokeReply(reply.status, reply.text, [secret, accessToken, basic]);
			if (failure !== undefined) return yield* Effect.fail(failure);
		});

		return { exchange, refresh, revokeGrant } satisfies GitHubUserAuthShape;
	});
