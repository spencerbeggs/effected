import { generateKeyPairSync } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import { GitHubApp } from "../src/GitHubApp.js";
import { GitHubClient } from "../src/GitHubClient.js";
import { GitHubError } from "../src/GitHubError.js";
import { RetryPolicy } from "../src/Resilience.js";
import type { Reply } from "./fixtures.js";
import { scriptedFetch } from "./fixtures.js";

const { privateKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs1", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});

const CREDENTIALS = { appId: "Iv1.appclient", privateKey: Redacted.make(privateKey) };

/** A realistic wall clock; TestClock otherwise starts at the epoch. */
const NOW_MILLIS = 1_800_000_000_000;

/** No sleeping between retries, so retry counts are testable without a clock. */
const INSTANT_RETRY = RetryPolicy.make({
	maxRetries: 2,
	baseDelay: Duration.zero,
	maxDelay: Duration.zero,
	respectRetryAfter: false,
	maxServerAdvisedDelay: Duration.zero,
});

const DELIVERIES: Reply = { status: 200, body: [] };

const withAppClient = <A, E>(
	replies: ReadonlyArray<Reply>,
	use: (client: GitHubClient["Service"], script: ReturnType<typeof scriptedFetch>) => Effect.Effect<A, E>,
	options: { retry?: RetryPolicy | "off"; privateKey?: Redacted.Redacted<string> } = {},
) =>
	Effect.gen(function* () {
		yield* TestClock.setTime(NOW_MILLIS);
		const script = scriptedFetch(replies);
		return yield* Effect.provide(
			Effect.flatMap(GitHubClient, (client) => use(client, script)),
			GitHubApp.appClientLayer(
				{ ...CREDENTIALS, ...(options.privateKey !== undefined ? { privateKey: options.privateKey } : {}) },
				{ fetch: script.fetch, retry: options.retry ?? "off" },
			),
		);
	});

/** The bearer JWT a recorded call carried. */
const bearerOf = (script: ReturnType<typeof scriptedFetch>, index: number): string => {
	const authorization = script.calls[index]?.headers.authorization ?? "";
	assert.isTrue(authorization.startsWith("bearer "), authorization);
	const jwt = authorization.slice("bearer ".length);
	assert.lengthOf(jwt.split("."), 3, "a three-segment JWT");
	return jwt;
};

const claimsOf = (jwt: string): { iss: string; iat: number; exp: number } =>
	JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"));

describe("GitHubApp.appClientLayer", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.effect("authenticates an app-level route with a bearer JWT issued by the app", () =>
		withAppClient([DELIVERIES], (client, script) =>
			Effect.gen(function* () {
				yield* client.request("GET /app/hook/deliveries", {});
				assert.strictEqual(script.count(), 1, "a JWT is signed locally; no mint call precedes the request");
				assert.strictEqual(script.calls[0]?.path, "/app/hook/deliveries");
				const claims = claimsOf(bearerOf(script, 0));
				assert.strictEqual(claims.iss, "Iv1.appclient");
				assert.strictEqual(claims.iat, NOW_MILLIS / 1000 - 60);
			}),
		),
	);

	it.effect("reuses the JWT while it is fresh and re-signs once it is within a minute of expiry", () =>
		withAppClient([DELIVERIES], (client, script) =>
			Effect.gen(function* () {
				yield* client.request("GET /app/hook/deliveries", {});
				yield* TestClock.adjust(Duration.minutes(7));
				yield* client.request("GET /app/hook/deliveries", {});
				// +7 min is before the rotation point (exp 9 min, minus 60 s skew).
				assert.strictEqual(bearerOf(script, 1), bearerOf(script, 0), "no re-sign on every call");
				yield* TestClock.adjust(Duration.minutes(2));
				yield* client.request("GET /app/hook/deliveries", {});
				const rotated = bearerOf(script, 2);
				assert.notStrictEqual(rotated, bearerOf(script, 0), "a spent JWT is replaced");
				assert.strictEqual(claimsOf(rotated).iat, NOW_MILLIS / 1000 + 9 * 60 - 60);
			}),
		),
	);

	it.effect("fails construction with a jwt GitHubAppError on a malformed key", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				withAppClient([DELIVERIES], () => Effect.void, { privateKey: Redacted.make("not a key") }),
			);
			assert.strictEqual(error._tag, "GitHubAppError");
			if (error._tag === "GitHubAppError") assert.strictEqual(error.kind, "jwt");
		}),
	);

	it.effect("applies the retry policy: a 502 then a 200 succeeds", () =>
		withAppClient(
			[{ status: 502, body: { message: "bad gateway" } }, DELIVERIES],
			(client, script) =>
				Effect.gen(function* () {
					yield* client.request("GET /app/hook/deliveries", {});
					assert.strictEqual(script.count(), 2);
				}),
			{ retry: INSTANT_RETRY },
		),
	);

	it.effect("makes no revoke call on release, because a JWT cannot be revoked", () =>
		Effect.gen(function* () {
			const script = scriptedFetch([DELIVERIES]);
			yield* TestClock.setTime(NOW_MILLIS);
			yield* Effect.provide(
				Effect.flatMap(GitHubClient, (client) => client.request("GET /app/hook/deliveries", {})),
				GitHubApp.appClientLayer(CREDENTIALS, { fetch: script.fetch, retry: "off" }),
			);
			assert.strictEqual(script.count(), 1, "only the request itself; nothing on release");
		}),
	);

	it.effect("concurrent requests on a spent JWT all carry the same replacement", () =>
		withAppClient([DELIVERIES], (client, script) =>
			Effect.gen(function* () {
				yield* client.request("GET /app/hook/deliveries", {});
				yield* TestClock.adjust(Duration.minutes(9));
				yield* Effect.all(
					Array.from({ length: 3 }, () => client.request("GET /app/hook/deliveries", {})),
					{ concurrency: "unbounded" },
				);
				const first = bearerOf(script, 0);
				const rotated = [1, 2, 3].map((index) => bearerOf(script, index));
				for (const jwt of rotated) assert.notStrictEqual(jwt, first);
				// Consistency only: RS256 is deterministic and every waiter signs the same
				// claims at the same TestClock instant, so one re-sign and three put
				// identical bytes on the wire. Single rotation is pinned on the
				// installation path, which shares the rotation code.
				assert.strictEqual(new Set(rotated).size, 1, "every concurrent request carries the same JWT");
			}),
		),
	);

	it.effect("reports a signing failure after construction as an unauthorized GitHubError naming the layer", () =>
		withAppClient([DELIVERIES], (client) =>
			Effect.gen(function* () {
				yield* client.request("GET /app/hook/deliveries", {});
				yield* TestClock.adjust(Duration.minutes(9));
				// Re-signing now needs WebCrypto, which this runtime no longer has.
				vi.stubGlobal("crypto", undefined);
				const error = yield* Effect.flip(client.request("GET /app/hook/deliveries", {}));
				vi.unstubAllGlobals();
				assert.instanceOf(error, GitHubError);
				assert.strictEqual(error.kind, "unauthorized");
				assert.strictEqual(error.operation, "GitHubApp.appClientLayer");
				const cause = error.cause as { _tag?: string; kind?: string } | undefined;
				assert.strictEqual(cause?._tag, "GitHubAppError");
				assert.strictEqual(cause?.kind, "jwt");
			}),
		),
	);
});
