import { assert, describe, it } from "@effect/vitest";
import { Cause, DateTime, Deferred, Effect, Exit, Fiber, Layer, Redacted, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { TestClock } from "effect/testing";
import type { GitHubUserAuthError, GitHubUserAuthOptions } from "../src/GitHubUserAuth.js";
import {
	ExpiringUserTokens,
	GitHubUserAuth,
	GitHubUserAuthFinal,
	GitHubUserAuthTemporary,
	GitHubUserTokens,
	NonExpiringUserTokens,
} from "../src/GitHubUserAuth.js";
import type { Reply } from "./fixtures.js";
import { hangingFetch, scriptedFetch } from "./fixtures.js";

/**
 * `GitHubUserAuth` driven through a scripted `fetch`: the real request
 * building, classification and scrubbing, against canned GitHub replies.
 */

const CLIENT_ID = "Iv23liClientId";
const CLIENT_SECRET = "client-secret-0123456789abcdef";
const CODE = "auth-code-5f3a9b";
const VERIFIER = "pkce-verifier-q8w7e6r5t4y3";
const REFRESH = "ghr_refreshTokenValue123456";
const ACCESS = "ghu_accessTokenValue123456";
const NEW_REFRESH = "ghr_rotatedRefreshToken9876";

const NOW = 1_700_000_000_000;

/** GitHub's primary REST rate-limit body, which it answers with HTTP 403. */
const PRIMARY_RATE_LIMIT =
	"API rate limit exceeded for user ID 1. If you reach out to GitHub Support for help, please include the request ID.";
/** GitHub's secondary rate-limit body, which it answers with HTTP 403 or 429. */
const SECONDARY_RATE_LIMIT =
	"You have exceeded a secondary rate limit. Please wait a few minutes before you try again.";
/** GitHub's older wording for a secondary rate limit, which never says "rate limit". */
const ABUSE_DETECTION =
	"You have triggered an abuse detection mechanism and have been temporarily blocked from content creation. Please retry your request again later.";

const tokenBody = {
	access_token: ACCESS,
	expires_in: 28_800,
	refresh_token: NEW_REFRESH,
	refresh_token_expires_in: 15_897_600,
	scope: "",
	token_type: "bearer",
};

const options = (
	fetch: typeof globalThis.fetch,
	extra: Partial<GitHubUserAuthOptions> = {},
): GitHubUserAuthOptions => ({
	clientId: CLIENT_ID,
	clientSecret: Redacted.make(CLIENT_SECRET),
	fetch,
	...extra,
});

/** Run `body` against a layer over `replies`, handing it the recorder. */
const withReplies = <A, E>(
	replies: ReadonlyArray<Reply>,
	body: (recorder: ReturnType<typeof scriptedFetch>) => Effect.Effect<A, E, GitHubUserAuth>,
	extra: Partial<GitHubUserAuthOptions> = {},
): Effect.Effect<A, E> => {
	const recorder = scriptedFetch(replies);
	return body(recorder).pipe(Effect.provide(GitHubUserAuth.layer(options(recorder.fetch, extra))));
};

const exchange = Effect.flatMap(GitHubUserAuth, (auth) =>
	auth.exchange({ code: CODE, codeVerifier: VERIFIER, redirectUri: "https://app.example/callback" }),
);
const refresh = Effect.flatMap(GitHubUserAuth, (auth) => auth.refresh({ refreshToken: Redacted.make(REFRESH) }));
const revoke = Effect.flatMap(GitHubUserAuth, (auth) => auth.revokeGrant({ accessToken: Redacted.make(ACCESS) }));

const formOf = (body: string | undefined): Record<string, string> =>
	Object.fromEntries(new URLSearchParams(body ?? "").entries());

describe("GitHubUserAuth.exchange", () => {
	it.effect("posts the code, verifier and redirect, and answers an expiring pair with absolute expiries", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW);
			const recorder = scriptedFetch([{ status: 200, body: tokenBody }]);
			const tokens = yield* exchange.pipe(Effect.provide(GitHubUserAuth.layer(options(recorder.fetch))));
			const call = recorder.calls[0];
			assert.strictEqual(recorder.count(), 1);
			assert.strictEqual(call?.method, "POST");
			assert.strictEqual(call?.url, "https://github.com/login/oauth/access_token");
			assert.strictEqual(call?.headers.accept, "application/json");
			assert.strictEqual(call?.headers["content-type"], "application/x-www-form-urlencoded");
			assert.deepStrictEqual(formOf(call?.body), {
				client_id: CLIENT_ID,
				client_secret: CLIENT_SECRET,
				code: CODE,
				code_verifier: VERIFIER,
				redirect_uri: "https://app.example/callback",
			});
			assert.instanceOf(tokens, ExpiringUserTokens);
			if (tokens.expiry !== "expiring") return assert.fail("expected expiring tokens");
			assert.strictEqual(Redacted.value(tokens.accessToken), ACCESS);
			assert.strictEqual(Redacted.value(tokens.refreshToken), NEW_REFRESH);
			assert.strictEqual(DateTime.toEpochMillis(tokens.expiresAt), NOW + 28_800_000);
			assert.strictEqual(DateTime.toEpochMillis(tokens.refreshTokenExpiresAt), NOW + 15_897_600_000);
			assert.strictEqual(tokens.tokenType, "bearer");
			assert.strictEqual(tokens.scope, "");
			assert.isFalse(tokens.isExpired(NOW));
			assert.isTrue(tokens.isExpired(NOW + 28_800_000));
			assert.isFalse(tokens.isRefreshExpired(NOW + 28_800_000));
		}),
	);

	it.effect("omits code_verifier and redirect_uri when the request has none", () =>
		withReplies([{ status: 200, body: tokenBody }], (recorder) =>
			Effect.gen(function* () {
				const auth = yield* GitHubUserAuth;
				yield* auth.exchange({ code: CODE });
				assert.deepStrictEqual(formOf(recorder.calls[0]?.body), {
					client_id: CLIENT_ID,
					client_secret: CLIENT_SECRET,
					code: CODE,
				});
			}),
		),
	);

	it.effect("answers a non-expiring token when GitHub sends no refresh token and no expiry", () =>
		withReplies([{ status: 200, body: { access_token: ACCESS, token_type: "bearer", scope: "repo" } }], () =>
			Effect.gen(function* () {
				const tokens = yield* exchange;
				assert.instanceOf(tokens, NonExpiringUserTokens);
				assert.strictEqual(tokens.expiry, "non-expiring");
				assert.strictEqual(tokens.scope, "repo");
			}),
		),
	);

	it.effect("reads GitHub's HTTP 200 error body as a final refusal, keeping its code and description", () =>
		withReplies(
			[
				{
					status: 200,
					body: {
						error: "bad_verification_code",
						error_description: "The code passed is incorrect or expired.",
						error_uri: "https://docs.github.com/apps/troubleshooting",
					},
				},
			],
			() =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(exchange);
					assert.instanceOf(error, GitHubUserAuthFinal);
					if (error._tag !== "GitHubUserAuthFinal") return;
					assert.strictEqual(error.operation, "exchange");
					assert.strictEqual(error.code, "bad_verification_code");
					assert.strictEqual(error.remedy, "reconnect");
					assert.strictEqual(error.status, 200);
					assert.strictEqual(error.description, "The code passed is incorrect or expired.");
				}),
		),
	);

	it.effect("an expiring reply missing its refresh expiry is malformed, not a non-expiring token", () =>
		withReplies([{ status: 200, body: { ...tokenBody, refresh_token_expires_in: undefined } }], () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(exchange);
				assert.strictEqual(error._tag, "GitHubUserAuthTemporary");
				if (error._tag === "GitHubUserAuthTemporary") assert.strictEqual(error.kind, "malformed");
			}),
		),
	);

	it.effect("a 200 body that is not JSON, or not a token, is a temporary malformed failure", () =>
		Effect.gen(function* () {
			for (const body of ["<html>oops</html>", {}, { access_token: "" }, { ...tokenBody, expires_in: -1 }]) {
				const fetch: typeof globalThis.fetch = () =>
					Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 }));
				const error = yield* Effect.flip(exchange.pipe(Effect.provide(GitHubUserAuth.layer(options(fetch)))));
				assert.strictEqual(error._tag, "GitHubUserAuthTemporary", JSON.stringify(body));
				if (error._tag === "GitHubUserAuthTemporary") assert.strictEqual(error.kind, "malformed");
			}
		}),
	);

	it.effect("goes to an overridden token URL", () =>
		withReplies(
			[{ status: 200, body: tokenBody }],
			(recorder) =>
				Effect.gen(function* () {
					yield* exchange;
					assert.strictEqual(recorder.calls[0]?.url, "https://github.acme.test/login/oauth/access_token");
				}),
			{ tokenUrl: "https://github.acme.test/login/oauth/access_token" },
		),
	);
});

describe("GitHubUserAuth.refresh", () => {
	it.effect("posts grant_type=refresh_token and answers the rotated pair", () =>
		withReplies([{ status: 200, body: tokenBody }], (recorder) =>
			Effect.gen(function* () {
				const tokens = yield* refresh;
				assert.deepStrictEqual(formOf(recorder.calls[0]?.body), {
					client_id: CLIENT_ID,
					client_secret: CLIENT_SECRET,
					grant_type: "refresh_token",
					refresh_token: REFRESH,
				});
				assert.strictEqual(Redacted.value(tokens.refreshToken), NEW_REFRESH);
			}),
		),
	);

	it.effect("bad_refresh_token is final with remedy reconnect", () =>
		withReplies(
			[
				{
					status: 200,
					body: { error: "bad_refresh_token", error_description: "The refresh token passed is incorrect or expired." },
				},
			],
			() =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(refresh);
					assert.strictEqual(error._tag, "GitHubUserAuthFinal");
					if (error._tag !== "GitHubUserAuthFinal") return;
					assert.strictEqual(error.operation, "refresh");
					assert.strictEqual(error.code, "bad_refresh_token");
					assert.strictEqual(error.remedy, "reconnect");
				}),
		),
	);

	it.effect("incorrect_client_credentials is final with remedy reconfigure, never reconnect", () =>
		// The case a "wipe on Final" handler gets wrong: the app's secret is
		// bad, the user's grant is fine, and signing everyone out fixes nothing.
		withReplies([{ status: 200, body: { error: "incorrect_client_credentials" } }], () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(refresh);
				assert.strictEqual(error._tag, "GitHubUserAuthFinal");
				if (error._tag === "GitHubUserAuthFinal") assert.strictEqual(error.remedy, "reconfigure");
			}),
		),
	);

	it.effect("an unrecognisable error code reads unknown_error, remedy reconfigure", () =>
		withReplies([{ status: 200, body: { error: "Weird Code <script>" } }], () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(refresh);
				assert.strictEqual(error._tag, "GitHubUserAuthFinal");
				if (error._tag !== "GitHubUserAuthFinal") return;
				assert.strictEqual(error.code, "unknown_error");
				assert.strictEqual(error.remedy, "reconfigure");
			}),
		),
	);

	it.effect("503 is temporary, with the status, even when its body looks like a refusal", () =>
		withReplies([{ status: 503, body: { error: "bad_refresh_token" } }], () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(refresh);
				assert.instanceOf(error, GitHubUserAuthTemporary);
				if (error._tag !== "GitHubUserAuthTemporary") return;
				assert.strictEqual(error.kind, "status");
				assert.strictEqual(error.status, 503);
			}),
		),
	);

	it.effect("429 is temporary", () =>
		withReplies([{ status: 429, body: { message: "rate limited" } }], () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(refresh);
				assert.strictEqual(error._tag, "GitHubUserAuthTemporary");
			}),
		),
	);

	it.effect("a 403 whose message names a rate limit is temporary, primary or secondary", () =>
		Effect.gen(function* () {
			for (const message of [PRIMARY_RATE_LIMIT, SECONDARY_RATE_LIMIT]) {
				for (const operation of [refresh, exchange]) {
					const error = yield* withReplies([{ status: 403, body: { message } }], () => Effect.flip(operation));
					assert.instanceOf(error, GitHubUserAuthTemporary, message);
					if (error._tag !== "GitHubUserAuthTemporary") return;
					assert.strictEqual(error.kind, "status");
					assert.strictEqual(error.status, 403);
				}
			}
		}),
	);

	it.effect("a 403 with any other message stays final, remedy reconfigure, code http_403", () =>
		withReplies([{ status: 403, body: { message: "Forbidden" } }], () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(refresh);
				assert.instanceOf(error, GitHubUserAuthFinal);
				if (error._tag !== "GitHubUserAuthFinal") return;
				assert.strictEqual(error.code, "http_403");
				assert.strictEqual(error.remedy, "reconfigure");
			}),
		),
	);

	it.effect("an error body naming a rate limit is still a refusal: the error body wins over the status", () =>
		// The body carries a REST `message` naming a rate limit too, so the
		// rate-limit rule WOULD fire if it ran before the `error` check.
		withReplies(
			[
				{
					status: 403,
					body: {
						error: "incorrect_client_credentials",
						error_description: "rate limit or not",
						message: SECONDARY_RATE_LIMIT,
					},
				},
			],
			() =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(refresh);
					assert.instanceOf(error, GitHubUserAuthFinal);
					if (error._tag !== "GitHubUserAuthFinal") return;
					assert.strictEqual(error.code, "incorrect_client_credentials");
					assert.strictEqual(error.remedy, "reconfigure");
				}),
		),
	);

	it.effect("a 200 with only a rate-limit message and no token is malformed: the rule is for 403 alone", () =>
		withReplies([{ status: 200, body: { message: PRIMARY_RATE_LIMIT } }], () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(refresh);
				assert.instanceOf(error, GitHubUserAuthTemporary);
				if (error._tag === "GitHubUserAuthTemporary") assert.strictEqual(error.kind, "malformed");
			}),
		),
	);

	it.effect("a 404 with no error code is final, remedy reconfigure, code http_404", () =>
		withReplies([{ status: 404, body: { message: "Not Found" } }], () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(refresh);
				assert.strictEqual(error._tag, "GitHubUserAuthFinal");
				if (error._tag !== "GitHubUserAuthFinal") return;
				assert.strictEqual(error.code, "http_404");
				assert.strictEqual(error.remedy, "reconfigure");
			}),
		),
	);

	it.effect("a network throw is temporary, keeping a scrubbed copy as the cause", () =>
		Effect.gen(function* () {
			const original = new TypeError(`fetch failed for client_secret=${CLIENT_SECRET}&refresh_token=${REFRESH}`);
			const fetch: typeof globalThis.fetch = () => Promise.reject(original);
			const error = yield* Effect.flip(refresh.pipe(Effect.provide(GitHubUserAuth.layer(options(fetch)))));
			assert.instanceOf(error, GitHubUserAuthTemporary);
			if (error._tag !== "GitHubUserAuthTemporary") return;
			assert.strictEqual(error.kind, "network");
			assert.isUndefined(error.status);
			const cause = error.cause;
			assert.instanceOf(cause, Error);
			assert.notStrictEqual(cause, original, "the original is never kept");
			assert.strictEqual((cause as Error).name, "TypeError");
			assert.include((cause as Error).message, "fetch failed");
			assert.notInclude((cause as Error).message, CLIENT_SECRET);
			assert.notInclude((cause as Error).message, REFRESH);
		}),
	);

	it.effect("a body that fails mid-read is temporary network, keeping the status that arrived", () =>
		Effect.gen(function* () {
			const fetch: typeof globalThis.fetch = () =>
				Promise.resolve(
					new Response(
						new ReadableStream({
							pull: (controller) => controller.error(new TypeError(`terminated refresh_token=${REFRESH}`)),
						}),
						{ status: 200 },
					),
				);
			const error = yield* Effect.flip(refresh.pipe(Effect.provide(GitHubUserAuth.layer(options(fetch)))));
			assert.instanceOf(error, GitHubUserAuthTemporary);
			if (error._tag !== "GitHubUserAuthTemporary") return;
			assert.strictEqual(error.kind, "network");
			assert.strictEqual(error.status, 200);
			assert.instanceOf(error.cause, Error);
			assert.notInclude((error.cause as Error).message, REFRESH);
		}),
	);

	it.effect("a refresh answered with a non-expiring token is malformed", () =>
		withReplies([{ status: 200, body: { access_token: ACCESS, token_type: "bearer", scope: "" } }], () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(refresh);
				assert.strictEqual(error._tag, "GitHubUserAuthTemporary");
				if (error._tag === "GitHubUserAuthTemporary") assert.strictEqual(error.kind, "malformed");
			}),
		),
	);

	it.effect("a call with no answer inside the timeout is temporary, and its fetch is aborted", () =>
		Effect.gen(function* () {
			const hanging = hangingFetch("request");
			const fiber = yield* refresh.pipe(
				Effect.provide(GitHubUserAuth.layer(options(hanging.fetch, { timeout: "3 seconds" }))),
				Effect.flip,
				Effect.forkChild,
			);
			yield* Deferred.await(hanging.started);
			yield* TestClock.adjust("3 seconds");
			const error = yield* Fiber.join(fiber);
			assert.strictEqual(error._tag, "GitHubUserAuthTemporary");
			if (error._tag === "GitHubUserAuthTemporary") assert.strictEqual(error.kind, "timeout");
			assert.strictEqual(hanging.aborted(), 1);
		}),
	);

	it.effect("a body that stops arriving inside the timeout is temporary, and the same fetch is aborted", () =>
		Effect.gen(function* () {
			const hanging = hangingFetch("body");
			const fiber = yield* refresh.pipe(
				Effect.provide(GitHubUserAuth.layer(options(hanging.fetch, { timeout: "3 seconds" }))),
				Effect.flip,
				Effect.forkChild,
			);
			yield* Deferred.await(hanging.started);
			yield* TestClock.adjust("3 seconds");
			const error = yield* Fiber.join(fiber);
			assert.strictEqual(error._tag, "GitHubUserAuthTemporary");
			if (error._tag === "GitHubUserAuthTemporary") assert.strictEqual(error.kind, "timeout");
			// The signal handed to `fetch` covers the body read too: a timeout while
			// the body streams aborts the request rather than abandoning it open.
			assert.strictEqual(hanging.aborted(), 1);
			assert.strictEqual(hanging.bodyCancelled(), 1);
		}),
	);
});

describe("GitHubUserAuth.revokeGrant", () => {
	it.effect("DELETEs the grant with HTTP Basic client auth and the token in the body; 204 succeeds", () =>
		withReplies([{ status: 204 }], (recorder) =>
			Effect.gen(function* () {
				yield* revoke;
				const call = recorder.calls[0];
				assert.strictEqual(call?.method, "DELETE");
				assert.strictEqual(call?.url, `https://api.github.com/applications/${CLIENT_ID}/grant`);
				assert.strictEqual(call?.headers.authorization, `Basic ${Base64.encode(`${CLIENT_ID}:${CLIENT_SECRET}`)}`);
				assert.strictEqual(call?.headers["x-github-api-version"], "2026-03-10");
				assert.strictEqual(call?.headers.accept, "application/vnd.github+json");
				assert.deepStrictEqual(JSON.parse(call?.body ?? "null"), { access_token: ACCESS });
			}),
		),
	);

	it.effect("goes to an overridden API root and pins an overridden api-version", () =>
		withReplies(
			[{ status: 204 }],
			(recorder) =>
				Effect.gen(function* () {
					yield* revoke;
					assert.strictEqual(recorder.calls[0]?.url, `https://github.acme.test/api/v3/applications/${CLIENT_ID}/grant`);
					assert.strictEqual(recorder.calls[0]?.headers["x-github-api-version"], "2022-11-28");
				}),
			{ apiUrl: "https://github.acme.test/api/v3/", apiVersion: "2022-11-28" },
		),
	);

	it.effect("422 is final with remedy reconnect: the grant is already gone", () =>
		withReplies([{ status: 422, body: { message: "Validation Failed" } }], () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(revoke);
				assert.strictEqual(error._tag, "GitHubUserAuthFinal");
				if (error._tag !== "GitHubUserAuthFinal") return;
				assert.strictEqual(error.remedy, "reconnect");
				assert.strictEqual(error.code, "validation_failed");
				assert.strictEqual(error.description, "Validation Failed");
			}),
		),
	);

	it.effect("401 and 404 are final with remedy reconfigure; 500 is temporary", () =>
		Effect.gen(function* () {
			for (const status of [401, 404]) {
				const error = yield* withReplies([{ status, body: { message: "Not Found" } }], () => Effect.flip(revoke));
				assert.strictEqual(error._tag, "GitHubUserAuthFinal", String(status));
				if (error._tag === "GitHubUserAuthFinal") assert.strictEqual(error.remedy, "reconfigure");
			}
			const error = yield* withReplies([{ status: 500 }], () => Effect.flip(revoke));
			assert.strictEqual(error._tag, "GitHubUserAuthTemporary");
		}),
	);

	it.effect("a 403 whose message names a rate limit is temporary, primary or secondary, any case", () =>
		Effect.gen(function* () {
			for (const message of [PRIMARY_RATE_LIMIT, SECONDARY_RATE_LIMIT, "API RATE LIMIT EXCEEDED", ABUSE_DETECTION]) {
				const error = yield* withReplies([{ status: 403, body: { message } }], () => Effect.flip(revoke));
				assert.instanceOf(error, GitHubUserAuthTemporary, message);
				if (error._tag !== "GitHubUserAuthTemporary") return;
				assert.strictEqual(error.operation, "revokeGrant");
				assert.strictEqual(error.kind, "status");
				assert.strictEqual(error.status, 403);
			}
		}),
	);

	it.effect("a 403 with any other message stays final, remedy reconfigure", () =>
		withReplies([{ status: 403, body: { message: "Must have admin rights to Repository." } }], () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(revoke);
				assert.instanceOf(error, GitHubUserAuthFinal);
				if (error._tag !== "GitHubUserAuthFinal") return;
				assert.strictEqual(error.remedy, "reconfigure");
				assert.strictEqual(error.code, "http_403");
				assert.strictEqual(error.status, 403);
			}),
		),
	);

	it.effect("a rate-limit message on any status but 403 changes nothing: 401 reconfigure, 422 reconnect", () =>
		Effect.gen(function* () {
			for (const status of [401, 404]) {
				const error = yield* withReplies([{ status, body: { message: PRIMARY_RATE_LIMIT } }], () =>
					Effect.flip(revoke),
				);
				assert.instanceOf(error, GitHubUserAuthFinal, String(status));
				if (error._tag !== "GitHubUserAuthFinal") return;
				assert.strictEqual(error.code, `http_${status}`);
				assert.strictEqual(error.remedy, "reconfigure");
			}
			const error = yield* withReplies([{ status: 422, body: { message: SECONDARY_RATE_LIMIT } }], () =>
				Effect.flip(revoke),
			);
			assert.instanceOf(error, GitHubUserAuthFinal);
			if (error._tag !== "GitHubUserAuthFinal") return;
			assert.strictEqual(error.code, "validation_failed");
			assert.strictEqual(error.remedy, "reconnect");
		}),
	);

	it.effect("a 403 with no JSON message stays final, remedy reconfigure", () =>
		withReplies([{ status: 403, body: "rate limit, but not a REST body" }], () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(revoke);
				assert.instanceOf(error, GitHubUserAuthFinal);
				if (error._tag === "GitHubUserAuthFinal") assert.strictEqual(error.remedy, "reconfigure");
			}),
		),
	);

	it.effect("429 is temporary, whatever its message", () =>
		withReplies([{ status: 429, body: { message: "Too Many Requests" } }], () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(revoke);
				assert.instanceOf(error, GitHubUserAuthTemporary);
				if (error._tag !== "GitHubUserAuthTemporary") return;
				assert.strictEqual(error.kind, "status");
				assert.strictEqual(error.status, 429);
			}),
		),
	);
});

describe("no credential reaches an error", () => {
	/** Every rendering a logger, a serializer or a failure report could produce. */
	const renderings = (error: GitHubUserAuthError): ReadonlyArray<string> => [
		error.message,
		String(error),
		JSON.stringify(error),
		Cause.pretty(Cause.fail(error)),
		error._tag === "GitHubUserAuthTemporary" && error.cause instanceof Error
			? `${error.cause.message}\n${error.cause.stack ?? ""}\n${JSON.stringify(error.cause)}`
			: "",
	];

	/**
	 * What must never show: every credential the call itself carried, and every
	 * GitHub-prefixed token, which is scrubbed whoever sent it. A refresh cannot
	 * leak an authorization code it never held, so the code is not checked there.
	 */
	const forbidden: Record<GitHubUserAuthError["operation"], ReadonlyArray<string>> = {
		exchange: [CLIENT_SECRET, CODE, VERIFIER, ACCESS, REFRESH, NEW_REFRESH],
		refresh: [CLIENT_SECRET, ACCESS, REFRESH, NEW_REFRESH],
		revokeGrant: [CLIENT_SECRET, ACCESS, REFRESH, NEW_REFRESH],
	};

	const leaks = (error: GitHubUserAuthError): ReadonlyArray<string> =>
		forbidden[error.operation].filter((secret) => renderings(error).some((text) => text.includes(secret)));

	it("control: the renderings do expose a secret placed in a field they read", () => {
		// Proves the check can fail: a description that carried a secret
		// unscrubbed would be found.
		const unscrubbed = new GitHubUserAuthFinal({
			operation: "refresh",
			remedy: "reconnect",
			code: "bad_refresh_token",
			status: 200,
			description: `echo ${REFRESH}`,
		});
		assert.deepStrictEqual(leaks(unscrubbed), [REFRESH]);
	});

	it.effect("across every failure path, including echoing descriptions and a fetch that throws the request", () =>
		Effect.gen(function* () {
			const echo = `bad: ${[CLIENT_SECRET, CODE, VERIFIER, REFRESH, ACCESS, NEW_REFRESH].join(" ")} Basic ${Base64.encode(`${CLIENT_ID}:${CLIENT_SECRET}`)}`;
			const thrower: typeof globalThis.fetch = (_input, init) => {
				const error = new Error(`could not send ${String(init?.body)} with ${JSON.stringify(init?.headers)}`);
				Object.assign(error, { detail: String(init?.body) });
				(error as { cause?: unknown }).cause = new Error(String(init?.body));
				return Promise.reject(error);
			};
			const bodyReader: typeof globalThis.fetch = () =>
				Promise.resolve(
					Object.assign(new Response(null, { status: 200 }), {
						text: () => Promise.reject(new Error(`stream broke near ${CLIENT_SECRET}`)),
					}),
				);
			const scripted = (reply: Reply) => scriptedFetch([reply]).fetch;
			const fetches: ReadonlyArray<typeof globalThis.fetch> = [
				scripted({ status: 200, body: { error: "bad_refresh_token", error_description: echo } }),
				scripted({ status: 200, body: { error: "incorrect_client_credentials", error_description: echo } }),
				scripted({ status: 422, body: { message: echo } }),
				scripted({ status: 404, body: { message: echo } }),
				scripted({ status: 503, body: { error: echo } }),
				scripted({ status: 200, body: { access_token: ACCESS, refresh_token: NEW_REFRESH } }),
				thrower,
				bodyReader,
			];
			let checked = 0;
			for (const fetch of fetches) {
				const layer = GitHubUserAuth.layer(options(fetch));
				for (const operation of [exchange, refresh, revoke] as const) {
					const exit = yield* Effect.exit(
						Effect.provide(operation as Effect.Effect<unknown, GitHubUserAuthError, GitHubUserAuth>, layer),
					);
					if (Exit.isSuccess(exit)) continue;
					const error = Cause.findErrorOption(exit.cause);
					if (error._tag === "None") return assert.fail(`a defect, not a typed failure: ${Cause.pretty(exit.cause)}`);
					assert.deepStrictEqual(leaks(error.value), [], `${error.value._tag}: ${error.value.message}`);
					checked += 1;
				}
			}
			// Every fetch above fails every operation but the 422/404 revoke-only
			// replies, which fail the token calls too; a silently-empty loop would
			// prove nothing.
			assert.isAtLeast(checked, 20);
		}),
	);
});

describe("wiring and doubles", () => {
	const dies = (extra: Partial<GitHubUserAuthOptions>, needle: string) =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Effect.provide(GitHubUserAuth, GitHubUserAuth.layer(options(scriptedFetch([]).fetch, extra))),
			);
			assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause), `expected a defect for ${needle}`);
			if (Exit.isFailure(exit)) assert.include(Cause.pretty(exit.cause), needle);
		});

	it.effect("bad options die at layer construction, naming the option", () =>
		Effect.gen(function* () {
			yield* dies({ clientId: "" }, "clientId");
			yield* dies({ tokenUrl: "not a url" }, "tokenUrl");
			yield* dies({ apiUrl: "ftp://example.test" }, "apiUrl");
			yield* dies({ apiVersion: "latest" }, "apiVersion");
			yield* dies({ timeout: 0 }, "timeout");
			yield* dies({ timeout: Number.POSITIVE_INFINITY }, "timeout");
		}),
	);

	it.effect("an unstubbed makeTest member dies naming itself", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(refresh.pipe(Effect.provide(GitHubUserAuth.layerTest())));
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) assert.include(Cause.pretty(exit.cause), "refresh()");
		}),
	);

	it.effect("a stubbed makeTest member answers", () =>
		Effect.gen(function* () {
			const stub = NonExpiringUserTokens.make({ accessToken: Redacted.make(ACCESS), tokenType: "bearer", scope: "" });
			const tokens = yield* exchange.pipe(
				Effect.provide(
					Layer.succeed(GitHubUserAuth, GitHubUserAuth.makeTest({ exchange: () => Effect.succeed(stub) })),
				),
			);
			assert.strictEqual(tokens, stub);
		}),
	);

	it.effect("an expiring pair round-trips through the union schema as plain strings and ISO instants", () =>
		Effect.gen(function* () {
			const tokens = ExpiringUserTokens.make({
				accessToken: Redacted.make(ACCESS),
				tokenType: "bearer",
				scope: "",
				expiresAt: DateTime.makeUnsafe(NOW),
				refreshToken: Redacted.make(REFRESH),
				refreshTokenExpiresAt: DateTime.makeUnsafe(NOW + 1000),
			});
			const encoded = yield* Schema.encodeUnknownEffect(GitHubUserTokens)(tokens);
			assert.deepStrictEqual<unknown>(encoded, {
				expiry: "expiring",
				accessToken: ACCESS,
				tokenType: "bearer",
				scope: "",
				expiresAt: new Date(NOW).toISOString(),
				refreshToken: REFRESH,
				refreshTokenExpiresAt: new Date(NOW + 1000).toISOString(),
			});
			const decoded = yield* Schema.decodeUnknownEffect(GitHubUserTokens)(encoded);
			assert.instanceOf(decoded, ExpiringUserTokens);
		}),
	);
});
