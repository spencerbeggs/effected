import { assert, describe, it } from "@effect/vitest";
import type { CacheShape } from "@effected/store";
import { Cache, CacheError } from "@effected/store";
import { Effect, Layer, Option } from "effect";
import { ImageBackend, ImageBackendError } from "../src/cache.js";
import { fixture } from "./helpers.js";

const KEY = "b".repeat(64);
const PNG = fixture("png.png");

// The type-level contract: this line compiles only while store's CacheShape satisfies ImageBackendSource.
const storeBacked = ImageBackend.layerFrom(Cache).pipe(Layer.provide(Cache.layerTest()));

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

	it.effect("wraps a source failure as ImageBackendError, preserving the cause", () =>
		Effect.gen(function* () {
			const images = yield* ImageBackend;
			const error = yield* Effect.flip(images.get(KEY));
			assert.instanceOf(error, ImageBackendError);
			assert.strictEqual(error.operation, "get");
			assert.instanceOf(error.cause, CacheError);
		}).pipe(
			Effect.provide(
				ImageBackend.layerFrom(Cache).pipe(
					Layer.provide(
						Layer.succeed(Cache, {
							get: () => Effect.fail(new CacheError({ operation: "get", cause: new Error("disk gone") })),
						} as unknown as CacheShape),
					),
				),
			),
		),
	);

	it("the store-backed layer value is constructible", () => {
		assert.isDefined(storeBacked);
	});
});
