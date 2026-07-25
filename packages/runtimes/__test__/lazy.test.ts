import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
	BunResolver,
	DenoResolver,
	FreshnessError,
	GitHubClient,
	GitHubRelease,
	NetworkError,
	NodeResolver,
} from "../src/index.js";

const release = (tag: string, date = "2024-03-01T00:00:00Z") =>
	GitHubRelease.make({ tag_name: tag, draft: false, prerelease: false, published_at: date });

/** A GitHub client that counts every release-list call it serves. */
const makeCountingClient = (releases: ReadonlyArray<GitHubRelease>) => {
	let calls = 0;
	const layer = Layer.succeed(GitHubClient)({
		listReleases: () =>
			Effect.sync(() => {
				calls += 1;
			}).pipe(
				// A real fetch suspends the fiber. The yield point makes concurrent
				// first resolves genuinely race the gate — without it, the winner
				// completes synchronously and the race never happens.
				Effect.andThen(Effect.yieldNow),
				Effect.as(releases),
			),
		listTags: () => Effect.succeed([]),
	});
	return { layer, calls: () => calls };
};

/** A `fetch` that counts invocations and then fails, for the Node feeds. */
const makeCountingDeadFetch = () => {
	let calls = 0;
	const layer = Layer.provide(
		FetchHttpClient.layer,
		Layer.succeed(FetchHttpClient.Fetch)(async () => {
			calls += 1;
			throw new Error("network is down");
		}),
	);
	return { layer, calls: () => calls };
};

describe("lazy layer acquisition", () => {
	it.effect("acquiring all three resolvers together fetches no feed at all", () =>
		Effect.gen(function* () {
			const http = makeCountingDeadFetch();
			const client = makeCountingClient([release("v1.0.0")]);
			const merged = Layer.mergeAll(NodeResolver.layer, BunResolver.layer, DenoResolver.layer).pipe(
				Layer.provide(http.layer),
				Layer.provide(client.layer),
			);

			// Force acquisition of every service without resolving anything.
			yield* Effect.gen(function* () {
				yield* NodeResolver;
				yield* BunResolver;
				yield* DenoResolver;
			}).pipe(Effect.provide(merged));

			assert.strictEqual(http.calls(), 0, "acquisition must not touch the Node feeds");
			assert.strictEqual(client.calls(), 0, "acquisition must not touch the GitHub feeds");
		}),
	);

	it.effect("resolving one runtime fetches that runtime's feed and nobody else's", () =>
		Effect.gen(function* () {
			// The issue's motivating case: merge all three, resolve one.
			const http = makeCountingDeadFetch();
			const client = makeCountingClient([release("bun-v1.2.0")]);
			const merged = Layer.mergeAll(NodeResolver.layer, BunResolver.layer, DenoResolver.layer).pipe(
				Layer.provide(http.layer),
				Layer.provide(client.layer),
			);

			const result = yield* Effect.gen(function* () {
				const resolver = yield* BunResolver;
				return yield* resolver.resolve({ range: "^1.0.0" });
			}).pipe(Effect.provide(merged));

			assert.strictEqual(result.source, "api");
			assert.strictEqual(client.calls(), 1, "one resolve is one fetch");
			assert.strictEqual(http.calls(), 0, "the un-resolved Node feeds stay untouched");
		}),
	);

	it.effect("sequential resolves share the first fetch", () =>
		Effect.gen(function* () {
			const client = makeCountingClient([release("bun-v1.2.0"), release("bun-v1.1.0")]);

			yield* Effect.gen(function* () {
				const resolver = yield* BunResolver;
				const first = yield* resolver.resolve({ range: "^1.0.0" });
				const second = yield* resolver.resolve({ range: "^1.1.0" });
				assert.strictEqual(first.source, "api");
				assert.strictEqual(second.source, "api");
			}).pipe(Effect.provide(BunResolver.layer.pipe(Layer.provide(client.layer))));

			assert.strictEqual(client.calls(), 1, "a successful population is memoized");
		}),
	);

	it.effect("concurrent first resolves share one fetch", () =>
		Effect.gen(function* () {
			const client = makeCountingClient([release("bun-v1.2.0")]);

			yield* Effect.gen(function* () {
				const resolver = yield* BunResolver;
				const results = yield* Effect.all(
					[resolver.resolve({ range: "^1.0.0" }), resolver.resolve({ range: "*" }), resolver.resolve()],
					{ concurrency: "unbounded" },
				);
				for (const result of results) assert.strictEqual(result.source, "api");
			}).pipe(Effect.provide(BunResolver.layer.pipe(Layer.provide(client.layer))));

			assert.strictEqual(client.calls(), 1, "the losers of the race must wait, not refetch");
		}),
	);

	it.effect("a failed fresh fetch is retried by the next resolve, not memoized", () =>
		Effect.gen(function* () {
			// The deliberate half of the memoization contract: only success flips
			// the gate, so a transient network failure cannot poison the layer.
			let calls = 0;
			const flaky = Layer.succeed(GitHubClient)({
				listReleases: () =>
					Effect.suspend(() => {
						calls += 1;
						return calls === 1
							? Effect.fail(new NetworkError({ url: "https://api.github.com", cause: "down" }))
							: Effect.succeed([release("bun-v1.2.0")]);
					}),
				listTags: () => Effect.succeed([]),
			});

			yield* Effect.gen(function* () {
				const resolver = yield* BunResolver;
				const failure = yield* Effect.flip(resolver.resolve({ range: "^1.0.0" }));
				assert.instanceOf(failure, FreshnessError, "the fresh strategy's typed failure reaches resolve");
				const recovered = yield* resolver.resolve({ range: "^1.0.0" });
				assert.strictEqual(recovered.source, "api");
			}).pipe(Effect.provide(BunResolver.layerFresh.pipe(Layer.provide(flaky))));

			assert.strictEqual(calls, 2, "one failed attempt, one successful retry");
		}),
	);

	it.effect("the auto fallback is memoized — a dead feed is not retried on later resolves", () =>
		Effect.gen(function* () {
			// The other half: falling back to the snapshot IS a successful
			// population, so the dead feed is not hammered on every resolve.
			const http = makeCountingDeadFetch();
			// Inside the bundled snapshot's coverage; under `it.effect` the wall
			// clock is the TestClock at epoch, where no release is current.
			const NOW = DateTime.makeUnsafe("2026-01-15");

			yield* Effect.gen(function* () {
				const resolver = yield* NodeResolver;

				const first = yield* resolver.resolve({ range: ">=20", date: NOW });
				assert.strictEqual(first.source, "cache", "the fallback answer says so");
				const attempts = http.calls();
				assert.isAbove(attempts, 0, "the first resolve does attempt the live feed");

				const second = yield* resolver.resolve({ range: ">=20", date: NOW });
				assert.strictEqual(second.source, "cache");
				assert.strictEqual(http.calls(), attempts, "a memoized fallback must not refetch");
			}).pipe(Effect.provide(NodeResolver.layer.pipe(Layer.provide(http.layer))));
		}),
	);
});
