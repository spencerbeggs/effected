import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { GitHubAuth, GitHubClient, NetworkError, ResponseParseError } from "../src/index.js";

const withFetch = (fake: typeof globalThis.fetch) =>
	GitHubClient.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				GitHubAuth.anonymous,
				FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fake))),
			),
		),
	);

const listWith = (fake: typeof globalThis.fetch, options?: { perPage?: number; pages?: number }) =>
	Effect.gen(function* () {
		const client = yield* GitHubClient;
		return yield* client.listReleases("oven-sh", "bun", options);
	}).pipe(Effect.provide(withFetch(fake)));

const ok = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/json" } });

describe("hostile input", () => {
	describe("malformed responses fail typed, never as a defect", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			["a body that is not JSON at all", "<html>502 Bad Gateway</html>"],
			["a JSON scalar where a list belongs", "42"],
			["a JSON object where a list belongs", '{"message":"Not Found"}'],
			["a list of the wrong shape", '[{"unexpected":true}]'],
			["a null in the list", "[null]"],
			["truncated JSON", '[{"tag_name":"v1.0.0"'],
			// A __proto__ key must arrive as ordinary data, not reach the prototype.
			["a prototype-pollution payload", '[{"tag_name":"v1.0.0","__proto__":{"polluted":true}}]'],
		];

		for (const [name, body] of cases) {
			it.effect(name, () =>
				Effect.gen(function* () {
					const exit = yield* Effect.exit(listWith(async () => ok(body)));
					if (Exit.isSuccess(exit)) return assert.fail(`${name} must fail`);

					// The discriminating assertion: a typed Fail, and NOT a Die. Without
					// the no-Die line, an implementation that let a RangeError or a
					// TypeError escape as a defect would still pass.
					assert.isTrue(Cause.hasFails(exit.cause), `${name} must fail typed`);
					assert.isFalse(Cause.hasDies(exit.cause), `${name} must not defect`);
				}),
			);
		}

		it.effect("the prototype is not polluted by a __proto__ key in a response", () =>
			Effect.gen(function* () {
				yield* Effect.exit(listWith(async () => ok('[{"tag_name":"v1.0.0","__proto__":{"polluted":true}}]')));
				assert.isUndefined(
					({} as Record<string, unknown>).polluted,
					"a __proto__ key in a feed must never reach Object.prototype",
				);
			}),
		);
	});

	it.effect("a transport throw becomes a typed NetworkError", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				listWith(async () => {
					throw new TypeError("fetch failed");
				}),
			);
			assert.instanceOf(error, NetworkError);
		}),
	);

	it.effect("an empty body is a parse failure, not an empty success", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(listWith(async () => ok("")));
			assert.instanceOf(error, ResponseParseError);
		}),
	);

	describe("numeric bound guards reject NaN and fractions as defects", () => {
		// `if (n < 1)` is the obvious guard and it admits both: every relational
		// comparison against NaN is false, and 2.5 is simply greater than 1. Both
		// are developer wiring errors, so they must die rather than fail typed —
		// a caller cannot recover from having passed nonsense.
		const bad: ReadonlyArray<readonly [string, { perPage?: number; pages?: number }]> = [
			["perPage NaN", { perPage: Number.NaN }],
			["perPage fractional", { perPage: 2.5 }],
			["perPage zero", { perPage: 0 }],
			["perPage negative", { perPage: -1 }],
			["pages NaN", { pages: Number.NaN }],
			["pages fractional", { pages: 1.5 }],
			["pages zero", { pages: 0 }],
			["pages Infinity", { pages: Number.POSITIVE_INFINITY }],
		];

		for (const [name, options] of bad) {
			it.effect(name, () =>
				Effect.gen(function* () {
					const exit = yield* Effect.exit(listWith(async () => ok("[]"), options));
					if (Exit.isSuccess(exit)) return assert.fail(`${name} must not be accepted`);
					assert.isTrue(Cause.hasDies(exit.cause), `${name} is a wiring bug and must be a defect`);
					assert.isFalse(Cause.hasFails(exit.cause), `${name} must not enter the typed channel`);
				}),
			);
		}

		it.effect("a valid integer bound is accepted", () =>
			Effect.gen(function* () {
				const releases = yield* listWith(async () => ok("[]"), { perPage: 10, pages: 2 });
				assert.deepStrictEqual(releases, []);
			}),
		);
	});

	it.effect("pagination cannot be driven past the ceiling by a server that never sends a short page", () =>
		Effect.gen(function* () {
			let calls = 0;
			const fake: typeof globalThis.fetch = async () => {
				calls++;
				// Always a full page, so only the cap can stop the loop.
				return ok(JSON.stringify([{ tag_name: "v1.0.0", draft: false, prerelease: false, published_at: null }]));
			};

			yield* listWith(fake, { perPage: 1 });
			assert.isBelow(calls, 100, "the default page cap bounds the loop");
			assert.strictEqual(calls, 5, "the default is five pages");
		}),
	);
});
