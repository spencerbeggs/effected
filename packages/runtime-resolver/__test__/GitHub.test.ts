import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Fiber, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";
import {
	AuthenticationError,
	GitHubAuth,
	GitHubClient,
	NetworkError,
	RateLimitError,
	ResponseParseError,
} from "../src/index.js";

/** A release body GitHub would actually return. */
const release = (tag: string, extra: Record<string, unknown> = {}) => ({
	tag_name: tag,
	draft: false,
	prerelease: false,
	published_at: "2024-03-01T00:00:00Z",
	...extra,
});

const json = (body: unknown, init: ResponseInit = {}): Response =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});

/**
 * The test seam. `FetchHttpClient.Fetch` is a `Context.Reference<typeof fetch>`,
 * so a fake `fetch` drives the real client — request construction, status
 * mapping and schema decoding all execute. The v3 `OctokitInstance` stub
 * bypassed every one of those.
 */
const withFetch = (fake: typeof globalThis.fetch) =>
	GitHubClient.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				GitHubAuth.anonymous,
				FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fake))),
			),
		),
	);

describe("GitHubClient", () => {
	it.effect("pages until a short page arrives", () =>
		Effect.gen(function* () {
			const seen: string[] = [];
			const fake: typeof globalThis.fetch = async (input) => {
				const url = String(input);
				seen.push(url);
				// Page 1 is full (2 of 2), page 2 is short, so paging must stop there.
				if (url.includes("page=1")) return json([release("v1.0.0"), release("v0.9.0")]);
				return json([release("v0.8.0")]);
			};

			const releases = yield* Effect.gen(function* () {
				const client = yield* GitHubClient;
				return yield* client.listReleases("oven-sh", "bun", { perPage: 2 });
			}).pipe(Effect.provide(withFetch(fake)));

			assert.lengthOf(seen, 2, "stops at the first short page rather than walking to the cap");
			assert.deepStrictEqual(
				releases.map((r) => r.tag_name),
				["v1.0.0", "v0.9.0", "v0.8.0"],
			);
		}),
	);

	it.effect("stops at the caller's page limit even when every page is full", () =>
		Effect.gen(function* () {
			let calls = 0;
			const fake: typeof globalThis.fetch = async () => {
				calls++;
				return json([release("v1.0.0")]);
			};

			yield* Effect.gen(function* () {
				const client = yield* GitHubClient;
				return yield* client.listReleases("oven-sh", "bun", { perPage: 1, pages: 3 });
			}).pipe(Effect.provide(withFetch(fake)));

			assert.strictEqual(calls, 3, "a remote server cannot drive an unbounded page loop");
		}),
	);

	it.effect("maps 401 to AuthenticationError", () =>
		Effect.gen(function* () {
			const fake: typeof globalThis.fetch = async () => json({}, { status: 401 });
			const error = yield* Effect.flip(
				Effect.gen(function* () {
					const client = yield* GitHubClient;
					return yield* client.listTags("oven-sh", "bun");
				}).pipe(Effect.provide(withFetch(fake))),
			);
			assert.instanceOf(error, AuthenticationError);
		}),
	);

	it.effect("maps 403 to RateLimitError and carries the retry hint", () =>
		Effect.gen(function* () {
			const fake: typeof globalThis.fetch = async () =>
				json(
					{},
					{
						status: 403,
						headers: {
							"content-type": "application/json",
							"retry-after": "42",
							"x-ratelimit-limit": "60",
							"x-ratelimit-remaining": "0",
						},
					},
				);

			// A rate limit is retried with exponential backoff, and `it.effect` runs on
			// a virtual clock that does not advance by itself — so the retries must be
			// driven, or the test hangs to the vitest timeout rather than failing.
			const fiber = yield* Effect.forkChild(
				Effect.flip(
					Effect.gen(function* () {
						const client = yield* GitHubClient;
						return yield* client.listReleases("oven-sh", "bun", { pages: 1 });
					}).pipe(Effect.provide(withFetch(fake))),
				),
			);
			yield* TestClock.adjust("1 minute");
			const error = yield* Fiber.join(fiber);

			assert.instanceOf(error, RateLimitError);
			assert.strictEqual(error.retryAfter, 42, "retryAfter is what a caller needs to back off correctly");
			assert.strictEqual(error.limit, 60);
			assert.strictEqual(error.remaining, 0);
		}),
	);

	it.effect("maps an unusable status to NetworkError carrying it", () =>
		Effect.gen(function* () {
			const fake: typeof globalThis.fetch = async () => json({}, { status: 500 });
			const error = yield* Effect.flip(
				Effect.gen(function* () {
					const client = yield* GitHubClient;
					return yield* client.listTags("oven-sh", "bun");
				}).pipe(Effect.provide(withFetch(fake))),
			);
			assert.instanceOf(error, NetworkError);
			assert.strictEqual(error.status, 500);
		}),
	);

	it.effect("a body of the wrong shape fails typed, not as a defect", () =>
		Effect.gen(function* () {
			const fake: typeof globalThis.fetch = async () => json([{ nonsense: true }]);
			const error = yield* Effect.flip(
				Effect.gen(function* () {
					const client = yield* GitHubClient;
					return yield* client.listReleases("oven-sh", "bun");
				}).pipe(Effect.provide(withFetch(fake))),
			);
			assert.instanceOf(error, ResponseParseError);
			assert.include(error.source, "api.github.com");
		}),
	);

	it.effect("retries a rate limit and succeeds when it clears", () =>
		Effect.gen(function* () {
			let attempt = 0;
			const fake: typeof globalThis.fetch = async () => {
				attempt++;
				if (attempt === 1) {
					return json(
						{},
						{
							status: 429,
							headers: { "content-type": "application/json", "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0" },
						},
					);
				}
				return json([release("v1.0.0")]);
			};

			const fiber = yield* Effect.forkChild(
				Effect.gen(function* () {
					const client = yield* GitHubClient;
					return yield* client.listReleases("oven-sh", "bun", { pages: 1 });
				}).pipe(Effect.provide(withFetch(fake))),
			);
			yield* TestClock.adjust("1 minute");
			const releases = yield* Fiber.join(fiber);

			assert.strictEqual(attempt, 2, "the rate limit is retried rather than surfaced immediately");
			assert.lengthOf(releases, 1);
		}),
	);
});

describe("GitHubAuth", () => {
	const headersUnder = (env: Record<string, string>) =>
		Effect.gen(function* () {
			const auth = yield* GitHubAuth;
			return yield* auth.headers;
		}).pipe(Effect.provide(GitHubAuth.layer), Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))));

	it.effect("prefers an explicit PAT over GITHUB_TOKEN", () =>
		Effect.gen(function* () {
			const headers = yield* headersUnder({
				GITHUB_PERSONAL_ACCESS_TOKEN: "pat-wins",
				GITHUB_TOKEN: "ambient-loses",
			});
			assert.strictEqual(headers.authorization, "Bearer pat-wins");
		}),
	);

	it.effect("falls back to GITHUB_TOKEN", () =>
		Effect.gen(function* () {
			const headers = yield* headersUnder({ GITHUB_TOKEN: "ambient" });
			assert.strictEqual(headers.authorization, "Bearer ambient");
		}),
	);

	it.effect("sends nothing when no credential is present", () =>
		Effect.gen(function* () {
			const headers = yield* headersUnder({});
			assert.deepStrictEqual(headers, {});
		}),
	);

	it.effect("an explicit token layer beats the environment entirely", () =>
		Effect.gen(function* () {
			const headers = yield* Effect.gen(function* () {
				const auth = yield* GitHubAuth;
				return yield* auth.headers;
			}).pipe(Effect.provide(GitHubAuth.token(Redacted.make("explicit"))));
			assert.strictEqual(headers.authorization, "Bearer explicit");
		}),
	);

	it.effect("anonymous sends no headers", () =>
		Effect.gen(function* () {
			const headers = yield* Effect.gen(function* () {
				const auth = yield* GitHubAuth;
				return yield* auth.headers;
			}).pipe(Effect.provide(GitHubAuth.anonymous));
			assert.deepStrictEqual(headers, {});
		}),
	);
});
