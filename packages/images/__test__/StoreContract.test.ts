import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { CacheShape } from "@effected/store";
import { Cache, CacheError } from "@effected/store";
import { Duration, Effect, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { ImageBackend, ImageBackendError, ImageCache, ImageCacheKey } from "../src/cache.js";
import { counting, fixture } from "./helpers.js";

const KEY = "b".repeat(64);
const PNG = fixture("png.png");

// The compile-time contract: this line compiles only while store's CacheShape satisfies ImageBackendSource.
export const storeBacked = ImageBackend.layerFrom(Cache).pipe(Layer.provide(Cache.layerTest()));

const getFailure = new CacheError({ operation: "get", cause: new Error("disk gone") });
const setFailure = new CacheError({ operation: "set", cause: new Error("disk full") });
const failing = ImageBackend.layerFrom(Cache).pipe(
	Layer.provide(
		Layer.succeed(Cache, {
			get: () => Effect.fail(getFailure),
			set: () => Effect.fail(setFailure),
		} as unknown as CacheShape),
	),
);

describe("ImageBackend.layerFrom(Cache) - the store contract", () => {
	it.effect("round-trips through a real store Cache, recording the tag", () =>
		Effect.gen(function* () {
			const images = yield* ImageBackend;
			yield* images.set({ key: KEY, value: PNG, contentType: "image/png", tags: ["og"] });
			const stored = yield* images.get(KEY);
			assert.isTrue(Option.isSome(stored));
			if (Option.isSome(stored)) {
				assert.deepStrictEqual(stored.value, { value: PNG, contentType: "image/png" });
			}
			const cache = yield* Cache;
			const entry = yield* cache.get(KEY);
			assert.isTrue(Option.isSome(entry) && entry.value.tags.includes("og"));
		}).pipe(Effect.provide(Layer.provideMerge(ImageBackend.layerFrom(Cache), Cache.layerTest()))),
	);

	it.effect("wraps a get failure as ImageBackendError, preserving the cause instance and key", () =>
		Effect.gen(function* () {
			const images = yield* ImageBackend;
			const error = yield* Effect.flip(images.get(KEY));
			assert.instanceOf(error, ImageBackendError);
			assert.strictEqual(error.operation, "get");
			assert.strictEqual(error.key, KEY);
			assert.strictEqual(error.cause, getFailure);
		}).pipe(Effect.provide(failing)),
	);

	it.effect("wraps a set failure as ImageBackendError, preserving the cause instance and key", () =>
		Effect.gen(function* () {
			const images = yield* ImageBackend;
			const error = yield* Effect.flip(images.set({ key: KEY, value: PNG, contentType: "image/png" }));
			assert.instanceOf(error, ImageBackendError);
			assert.strictEqual(error.operation, "set");
			assert.strictEqual(error.key, KEY);
			assert.strictEqual(error.cause, setFailure);
		}).pipe(Effect.provide(failing)),
	);
});

describe("ImageCache over store's Cache", () => {
	const layer = ImageCache.layer.pipe(
		Layer.provide(ImageBackend.layerFrom(Cache)),
		Layer.provide(Cache.layerTest({ defaultTtl: Duration.minutes(5) })),
		Layer.merge(NodeCrypto.layer),
	);

	it.effect("hits within the TTL and regenerates after it expires", () =>
		Effect.gen(function* () {
			const cache = yield* ImageCache;
			const key = yield* ImageCacheKey.fromParams(
				Schema.Struct({ name: Schema.String }),
				{ name: "pkg" },
				{ salt: "og-v1", namespace: "og" },
			);
			const gen = counting(PNG);
			assert.isFalse((yield* cache.getOrGenerate(key, gen.generate)).hit);
			assert.isTrue((yield* cache.getOrGenerate(key, gen.generate)).hit);
			yield* TestClock.adjust(Duration.minutes(6));
			assert.isFalse((yield* cache.getOrGenerate(key, gen.generate)).hit);
			assert.strictEqual(gen.calls(), 2);
		}).pipe(Effect.provide(layer)),
	);
});
