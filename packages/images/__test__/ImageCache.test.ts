import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Data, Effect, Layer, Option, Path, Schema } from "effect";
import type { ImageBackendSetParams } from "../src/cache.js";
import { ImageBackend, ImageBackendError, ImageCache, ImageCacheKey, ImageGenerateError } from "../src/cache.js";
import { fixture } from "./helpers.js";

class RenderError extends Data.TaggedError("RenderError")<{ readonly why: string }> {}

const PNG = fixture("png.png");
const GIF = fixture("gif.gif");
const Params = Schema.Struct({ name: Schema.String });

const keyFor = (name: string) => ImageCacheKey.fromParams(Params, { name }, { salt: "og-v1", namespace: "og" });

const live = () =>
	ImageCache.layer.pipe(
		Layer.provideMerge(ImageBackend.layerDirectory({ directory: "/cache" })),
		Layer.provideMerge(Layer.mergeAll(MemoryFileSystem.layerWith({}), Path.layer, NodeCrypto.layer)),
	);

/** A generator that counts its calls. */
const counting = (bytes: Uint8Array) => {
	let calls = 0;
	return {
		generate: () =>
			Effect.sync(() => {
				calls++;
				return bytes;
			}),
		calls: () => calls,
	};
};

describe("ImageCache.getOrGenerate", () => {
	it.effect("misses, generates, stores; then hits without generating", () =>
		Effect.gen(function* () {
			const cache = yield* ImageCache;
			const key = yield* keyFor("pkg");
			const gen = counting(PNG);
			const first = yield* cache.getOrGenerate(key, gen.generate);
			assert.isFalse(first.hit);
			assert.strictEqual(first.facts.format, "png");
			const second = yield* cache.getOrGenerate(key, gen.generate);
			assert.isTrue(second.hit);
			assert.deepStrictEqual(second.bytes, PNG);
			assert.strictEqual(gen.calls(), 1);
		}).pipe(Effect.provide(live())),
	);

	it.effect("stores a png under the digest as image/png", () =>
		Effect.gen(function* () {
			const cache = yield* ImageCache;
			const key = yield* keyFor("tagged");
			yield* cache.getOrGenerate(key, () => Effect.succeed(PNG));
			const stored = yield* (yield* ImageBackend).get(key.digest);
			assert.isTrue(Option.isSome(stored) && stored.value.contentType === "image/png");
		}).pipe(Effect.provide(live())),
	);

	it.effect("hands the backend the digest, the facts' content type and the namespace tag", () => {
		const captured: Array<ImageBackendSetParams> = [];
		const recording = Layer.succeed(ImageBackend)({
			get: () => Effect.succeedNone,
			set: (params) =>
				Effect.sync(() => {
					captured.push(params);
				}),
		});
		return Effect.gen(function* () {
			const cache = yield* ImageCache;
			const key = yield* keyFor("recorded");
			yield* cache.getOrGenerate(key, () => Effect.succeed(GIF));
			assert.strictEqual(captured.length, 1);
			assert.strictEqual(captured[0]?.key, key.digest);
			assert.strictEqual(captured[0]?.contentType, "image/gif");
			assert.deepStrictEqual(captured[0]?.tags, [key.namespace]);
		}).pipe(Effect.provide(ImageCache.layer.pipe(Layer.provide(recording), Layer.merge(NodeCrypto.layer))));
	});

	it.effect("a backend set failure is surfaced, not swallowed", () =>
		Effect.gen(function* () {
			const cache = yield* ImageCache;
			const key = yield* keyFor("set-fails");
			const gen = counting(PNG);
			const error = yield* Effect.flip(cache.getOrGenerate(key, gen.generate));
			assert.instanceOf(error, ImageBackendError);
			if (error instanceof ImageBackendError) assert.strictEqual(error.operation, "set");
			assert.strictEqual(gen.calls(), 1);
		}).pipe(
			Effect.provide(
				ImageCache.layer.pipe(
					Layer.provide(
						Layer.succeed(ImageBackend)({
							get: () => Effect.succeedNone,
							set: (params) =>
								Effect.fail(new ImageBackendError({ operation: "set", key: params.key, cause: new Error("full") })),
						}),
					),
					Layer.merge(NodeCrypto.layer),
				),
			),
		),
	);

	it.effect("corrupt stored bytes are a miss and are overwritten", () =>
		Effect.gen(function* () {
			const cache = yield* ImageCache;
			const backend = yield* ImageBackend;
			const key = yield* keyFor("corrupt");
			yield* backend.set({ key: key.digest, value: PNG.subarray(0, 10), contentType: "image/png" });
			const gen = counting(PNG);
			const result = yield* cache.getOrGenerate(key, gen.generate);
			assert.isFalse(result.hit);
			assert.strictEqual(gen.calls(), 1);
			const stored = yield* backend.get(key.digest);
			assert.isTrue(Option.isSome(stored) && stored.value.value.length === PNG.length);
		}).pipe(Effect.provide(live())),
	);

	it.effect("a stored format outside accept is a miss", () =>
		Effect.gen(function* () {
			const cache = yield* ImageCache;
			const key = yield* keyFor("accept-miss");
			yield* cache.getOrGenerate(key, () => Effect.succeed(GIF));
			const gen = counting(PNG);
			const result = yield* cache.getOrGenerate(key, gen.generate, { accept: ["png", "jpeg", "webp"] });
			assert.isFalse(result.hit);
			assert.strictEqual(result.facts.format, "png");
		}).pipe(Effect.provide(live())),
	);

	it.effect("a generated format outside accept fails and stores nothing", () =>
		Effect.gen(function* () {
			const cache = yield* ImageCache;
			const key = yield* keyFor("rejected");
			const error = yield* Effect.flip(
				cache.getOrGenerate(key, () => Effect.succeed(GIF), { accept: ["png", "jpeg", "webp"] }),
			);
			assert.instanceOf(error, ImageGenerateError);
			if (error instanceof ImageGenerateError) {
				assert.strictEqual(error.reason, "rejected-format");
				assert.strictEqual(error.format, "gif");
			}
			assert.isTrue(Option.isNone(yield* (yield* ImageBackend).get(key.digest)));
		}).pipe(Effect.provide(live())),
	);

	it.effect("empty and unparseable generator output fail and store nothing", () =>
		Effect.gen(function* () {
			const cache = yield* ImageCache;
			const key = yield* keyFor("bad-output");
			const empty = yield* Effect.flip(cache.getOrGenerate(key, () => Effect.succeed(new Uint8Array(0))));
			assert.isTrue(empty instanceof ImageGenerateError && empty.reason === "empty");
			const junk = yield* Effect.flip(cache.getOrGenerate(key, () => Effect.succeed(new Uint8Array([1, 2, 3, 4]))));
			assert.isTrue(junk instanceof ImageGenerateError && junk.reason === "unparseable");
			assert.isTrue(Option.isNone(yield* (yield* ImageBackend).get(key.digest)));
		}).pipe(Effect.provide(live())),
	);

	it.effect("the generator's own error passes through, typed", () =>
		Effect.gen(function* () {
			const cache = yield* ImageCache;
			const key = yield* keyFor("render-fails");
			const error = yield* Effect.flip(
				cache.getOrGenerate(key, () => Effect.fail(new RenderError({ why: "font missing" }))),
			);
			assert.instanceOf(error, RenderError);
		}).pipe(Effect.provide(live())),
	);

	it.effect("a backend failure is surfaced, never swallowed into a regeneration", () =>
		Effect.gen(function* () {
			const cache = yield* ImageCache;
			const key = yield* keyFor("broken");
			const gen = counting(PNG);
			const error = yield* Effect.flip(cache.getOrGenerate(key, gen.generate));
			assert.instanceOf(error, ImageBackendError);
			assert.strictEqual(gen.calls(), 0);
		}).pipe(
			Effect.provide(
				ImageCache.layer.pipe(
					Layer.provide(
						Layer.succeed(ImageBackend)({
							get: (key) => Effect.fail(new ImageBackendError({ operation: "get", key, cause: new Error("down") })),
							set: () => Effect.void,
						}),
					),
					Layer.merge(NodeCrypto.layer),
				),
			),
		),
	);
});
