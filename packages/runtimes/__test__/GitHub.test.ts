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

	it.effect("maps 401 to AuthenticationError naming the auth mode actually used", () =>
		Effect.gen(function* () {
			const fake: typeof globalThis.fetch = async () => json({}, { status: 401 });
			const listTags = Effect.gen(function* () {
				const client = yield* GitHubClient;
				return yield* client.listTags("oven-sh", "bun");
			});

			// `withFetch` wires GitHubAuth.anonymous, so no credential is sent. Reporting
			// `method: "token"` here — as the hardcoded version did — makes the
			// "anonymous" arm of the error unreachable and tells the operator to go check
			// a token they never supplied.
			const anonymous = yield* Effect.flip(listTags.pipe(Effect.provide(withFetch(fake))));
			assert.instanceOf(anonymous, AuthenticationError);
			assert.strictEqual(anonymous.method, "anonymous");

			const authed = yield* Effect.flip(
				listTags.pipe(
					Effect.provide(
						GitHubClient.layer.pipe(
							Layer.provide(
								Layer.mergeAll(
									GitHubAuth.token(Redacted.make("a-token")),
									FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fake))),
								),
							),
						),
					),
				),
			);
			assert.instanceOf(authed, AuthenticationError);
			assert.strictEqual(authed.method, "token");
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

			// A rate limit is retried, and `it.effect` runs on a virtual clock that does
			// not advance by itself — so the retries must be driven, or the test hangs to
			// the vitest timeout rather than failing.
			//
			// The budget is three retries at the server's own 42s, not the 1s/2s/4s
			// exponential: honoring `retry-after` is what makes the total 126s.
			const fiber = yield* Effect.forkChild(
				Effect.flip(
					Effect.gen(function* () {
						const client = yield* GitHubClient;
						return yield* client.listReleases("oven-sh", "bun", { pages: 1 });
					}).pipe(Effect.provide(withFetch(fake))),
				),
			);
			yield* TestClock.adjust("5 minutes");
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

	describe("403 is classified, not assumed to be a rate limit", () => {
		/** GitHub's shape for a permission failure: 403, quota intact, no retry hint. */
		const forbidden = (): Response =>
			json(
				{ message: "Resource not accessible by personal access token" },
				{
					status: 403,
					headers: {
						"content-type": "application/json",
						"x-ratelimit-limit": "5000",
						"x-ratelimit-remaining": "4998",
					},
				},
			);

		it.effect("a 403 with quota remaining is a NetworkError, not a RateLimitError", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					Effect.gen(function* () {
						const client = yield* GitHubClient;
						return yield* client.listTags("oven-sh", "bun");
					}).pipe(Effect.provide(withFetch(async () => forbidden()))),
				);

				// A permission failure reported as a rate limit sends the caller off to
				// wait for a quota window that was never the problem.
				assert.notInstanceOf(error, RateLimitError);
				assert.instanceOf(error, NetworkError);
				assert.strictEqual(error.status, 403);
			}),
		);

		it.effect("a 403 with quota remaining is not retried", () =>
			Effect.gen(function* () {
				let calls = 0;
				const fake: typeof globalThis.fetch = async () => {
					calls++;
					return forbidden();
				};

				const fiber = yield* Effect.forkChild(
					Effect.flip(
						Effect.gen(function* () {
							const client = yield* GitHubClient;
							return yield* client.listTags("oven-sh", "bun");
						}).pipe(Effect.provide(withFetch(fake))),
					),
				);
				yield* TestClock.adjust("1 minute");
				yield* Fiber.join(fiber);

				assert.strictEqual(calls, 1, "retrying a permission failure just burns the caller's quota");
			}),
		);

		it.effect("a 403 with the quota exhausted is still a rate limit", () =>
			Effect.gen(function* () {
				// The primary-rate-limit signal GitHub documents.
				const fake: typeof globalThis.fetch = async () =>
					json(
						{},
						{
							status: 403,
							headers: {
								"content-type": "application/json",
								"x-ratelimit-limit": "60",
								"x-ratelimit-remaining": "0",
							},
						},
					);

				const fiber = yield* Effect.forkChild(
					Effect.flip(
						Effect.gen(function* () {
							const client = yield* GitHubClient;
							return yield* client.listTags("oven-sh", "bun");
						}).pipe(Effect.provide(withFetch(fake))),
					),
				);
				yield* TestClock.adjust("1 minute");
				const error = yield* Fiber.join(fiber);

				assert.instanceOf(error, RateLimitError);
				assert.strictEqual(error.remaining, 0);
			}),
		);

		it.effect("a 403 carrying only a retry-after is a secondary rate limit", () =>
			Effect.gen(function* () {
				// The secondary-limit signal: quota intact, but GitHub asked us to wait.
				const fake: typeof globalThis.fetch = async () =>
					json(
						{ message: "You have exceeded a secondary rate limit" },
						{
							status: 403,
							headers: {
								"content-type": "application/json",
								"retry-after": "7",
								"x-ratelimit-limit": "5000",
								"x-ratelimit-remaining": "4998",
							},
						},
					);

				const fiber = yield* Effect.forkChild(
					Effect.flip(
						Effect.gen(function* () {
							const client = yield* GitHubClient;
							return yield* client.listTags("oven-sh", "bun");
						}).pipe(Effect.provide(withFetch(fake))),
					),
				);
				yield* TestClock.adjust("5 minutes");
				const error = yield* Fiber.join(fiber);

				assert.instanceOf(error, RateLimitError);
				assert.strictEqual(error.retryAfter, 7);
			}),
		);
	});

	describe("the server's retry-after is honored", () => {
		/** Fails once with a `retry-after`, then succeeds. */
		const retryAfterOnce = (seconds: string) => {
			let attempt = 0;
			const fake: typeof globalThis.fetch = async () => {
				attempt++;
				if (attempt === 1) {
					return json(
						{},
						{
							status: 429,
							headers: {
								"content-type": "application/json",
								"retry-after": seconds,
								"x-ratelimit-limit": "60",
								"x-ratelimit-remaining": "0",
							},
						},
					);
				}
				return json([release("v1.0.0")]);
			};
			return { fake, attempts: () => attempt };
		};

		const listWith = (fake: typeof globalThis.fetch) =>
			Effect.gen(function* () {
				const client = yield* GitHubClient;
				return yield* client.listReleases("oven-sh", "bun", { pages: 1 });
			}).pipe(Effect.provide(withFetch(fake)));

		it.effect("waits the full retry-after before retrying, not the 1s exponential base", () =>
			Effect.gen(function* () {
				const { fake, attempts } = retryAfterOnce("30");
				const fiber = yield* Effect.forkChild(listWith(fake));

				// The exponential schedule's first delay is 1s. If retry-after were being
				// ignored, the retry would already have fired by now.
				yield* TestClock.adjust("29 seconds");
				assert.strictEqual(attempts(), 1, "must still be waiting out the server's 30s");

				yield* TestClock.adjust("1 second");
				yield* Fiber.join(fiber);
				assert.strictEqual(attempts(), 2, "retries once the server's window has elapsed");
			}),
		);

		it.effect("caps an absurd retry-after rather than parking the fiber for a day", () =>
			Effect.gen(function* () {
				// A number chosen by a remote server must not become an unbounded sleep.
				const { fake, attempts } = retryAfterOnce("86400");
				const fiber = yield* Effect.forkChild(listWith(fake));

				yield* TestClock.adjust("60 seconds");
				const releases = yield* Fiber.join(fiber);

				assert.strictEqual(attempts(), 2, "the wait is bounded at the 60s cap, not the 24h the server asked for");
				assert.lengthOf(releases, 1);
			}),
		);

		it.effect("ignores a negative retry-after instead of collapsing the backoff to nothing", () =>
			Effect.gen(function* () {
				const { fake, attempts } = retryAfterOnce("-5");
				const fiber = yield* Effect.forkChild(listWith(fake));

				// The discriminating assertion. Asserting only that it eventually retries
				// passes in BOTH worlds and proves nothing: a negative delay retries too —
				// instantly. The guard's observable effect is that the exponential base
				// (1s) is used instead, so at 500ms the retry must NOT have fired yet.
				yield* TestClock.adjust("500 millis");
				assert.strictEqual(attempts(), 1, "a negative retry-after must not become a zero-delay hot retry");

				yield* TestClock.adjust("1 second");
				yield* Fiber.join(fiber);
				assert.strictEqual(attempts(), 2, "and it falls back to the exponential schedule");
			}),
		);
	});
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
