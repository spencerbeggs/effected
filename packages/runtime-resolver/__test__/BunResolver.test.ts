import { assert, describe, it } from "@effect/vitest";
import { InvalidRangeError } from "@effected/semver";
import { Effect, Layer } from "effect";
import {
	BunResolver,
	DenoResolver,
	GitHubClient,
	GitHubRelease,
	NetworkError,
	NoMatchingVersionError,
} from "../src/index.js";

const release = (tag: string, date = "2024-03-01T00:00:00Z") =>
	GitHubRelease.make({ tag_name: tag, draft: false, prerelease: false, published_at: date });

/** A client that serves a canned release list, whatever repository it is asked for. */
const clientServing = (releases: ReadonlyArray<GitHubRelease>) =>
	Layer.succeed(GitHubClient)({
		listReleases: () => Effect.succeed(releases),
		listTags: () => Effect.succeed([]),
	});

/** A client whose every call fails, to drive the auto strategy onto its fallback. */
const deadClient = Layer.succeed(GitHubClient)({
	listReleases: () => Effect.fail(new NetworkError({ url: "https://api.github.com", cause: "down" })),
	listTags: () => Effect.fail(new NetworkError({ url: "https://api.github.com", cause: "down" })),
});

describe("BunResolver", () => {
	it.effect("resolves live releases and marks them as api", () =>
		Effect.gen(function* () {
			const result = yield* Effect.gen(function* () {
				const resolver = yield* BunResolver;
				return yield* resolver.resolve({ range: "^1.0.0", increments: "patch" });
			}).pipe(
				Effect.provide(
					BunResolver.layer.pipe(
						Layer.provide(clientServing([release("bun-v1.2.0"), release("bun-v1.1.0"), release("bun-v0.9.0")])),
					),
				),
			);

			assert.strictEqual(result.source, "api", "a live answer must say so");
			assert.deepStrictEqual(result.versions, ["1.2.0", "1.1.0"], "the bun- prefix is stripped and ^1 excludes 0.9");
			assert.strictEqual(result.latest, "1.2.0");
			assert.isUndefined(result.lts, "bun has no LTS notion");
		}),
	);

	it.effect("the auto strategy falls back to the snapshot and marks it as cache", () =>
		Effect.gen(function* () {
			const result = yield* Effect.gen(function* () {
				const resolver = yield* BunResolver;
				return yield* resolver.resolve({ range: "^1.0.0" });
			}).pipe(Effect.provide(BunResolver.layer.pipe(Layer.provide(deadClient))));

			assert.strictEqual(result.source, "cache");
			assert.isAbove(result.versions.length, 0);
		}),
	);

	it.effect("the fresh strategy fails rather than serving a snapshot", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Effect.gen(function* () {
					const resolver = yield* BunResolver;
					return yield* resolver.resolve({ range: "^1.0.0" });
				}).pipe(Effect.provide(BunResolver.layerFresh.pipe(Layer.provide(deadClient)))),
			);
			assert.isTrue(exit._tag === "Failure");
		}),
	);

	it.effect("drops drafts, prereleases and undated releases", () =>
		Effect.gen(function* () {
			const result = yield* Effect.gen(function* () {
				const resolver = yield* BunResolver;
				return yield* resolver.resolve({ range: "*", increments: "patch" });
			}).pipe(
				Effect.provide(
					BunResolver.layer.pipe(
						Layer.provide(
							clientServing([
								release("bun-v1.2.0"),
								GitHubRelease.make({
									tag_name: "bun-v1.3.0",
									draft: true,
									prerelease: false,
									published_at: "2024-04-01T00:00:00Z",
								}),
								GitHubRelease.make({
									tag_name: "bun-v1.4.0",
									draft: false,
									prerelease: true,
									published_at: "2024-05-01T00:00:00Z",
								}),
								// v3 invented `new Date()` for an undated release, which made
								// every historical one look like it shipped today.
								GitHubRelease.make({
									tag_name: "bun-v1.5.0",
									draft: false,
									prerelease: false,
									published_at: null,
								}),
								GitHubRelease.make({
									tag_name: "not-a-version",
									draft: false,
									prerelease: false,
									published_at: "2024-06-01T00:00:00Z",
								}),
							]),
						),
					),
				),
			);

			assert.deepStrictEqual(result.versions, ["1.2.0"]);
		}),
	);

	it.effect("an invalid range is a range error", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				Effect.gen(function* () {
					const resolver = yield* BunResolver;
					return yield* resolver.resolve({ range: "%%%" });
				}).pipe(Effect.provide(BunResolver.layerOffline)),
			);
			assert.instanceOf(error, InvalidRangeError);
		}),
	);

	it.effect("a range matching nothing is a not-found naming bun", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				Effect.gen(function* () {
					const resolver = yield* BunResolver;
					return yield* resolver.resolve({ range: ">=900" });
				}).pipe(Effect.provide(BunResolver.layerOffline)),
			);
			assert.instanceOf(error, NoMatchingVersionError);
			assert.strictEqual(error.runtime, "bun");
			assert.isUndefined(error.phases, "phases are a Node concept and must not appear here");
		}),
	);
});

describe("DenoResolver", () => {
	it.effect("strips a leading v and reports live provenance", () =>
		Effect.gen(function* () {
			const result = yield* Effect.gen(function* () {
				const resolver = yield* DenoResolver;
				return yield* resolver.resolve({ range: "^2.0.0", increments: "patch" });
			}).pipe(
				Effect.provide(DenoResolver.layer.pipe(Layer.provide(clientServing([release("v2.1.0"), release("v2.0.0")])))),
			);

			assert.strictEqual(result.source, "api");
			assert.deepStrictEqual(result.versions, ["2.1.0", "2.0.0"]);
		}),
	);

	it.effect("resolves from the bundled snapshot offline", () =>
		Effect.gen(function* () {
			const result = yield* Effect.gen(function* () {
				const resolver = yield* DenoResolver;
				return yield* resolver.resolve({ range: "^2.0.0" });
			}).pipe(Effect.provide(DenoResolver.layerOffline));

			assert.strictEqual(result.source, "cache");
			assert.isAbove(result.versions.length, 0);
		}),
	);

	it.effect("a not-found names deno, not bun", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				Effect.gen(function* () {
					const resolver = yield* DenoResolver;
					return yield* resolver.resolve({ range: ">=900" });
				}).pipe(Effect.provide(DenoResolver.layerOffline)),
			);
			assert.instanceOf(error, NoMatchingVersionError);
			assert.strictEqual(error.runtime, "deno");
		}),
	);
});
