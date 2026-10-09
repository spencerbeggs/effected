import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Data, Effect, Layer, Option, Path, Schema } from "effect";
import type { ImageBackendSetParams, ImageBackendShape } from "../src/cache.js";
import { ImageBackend, ImageBackendError, ImageCache, ImageCacheKey, ImageGenerateError } from "../src/cache.js";
import type { ImageFormat } from "../src/index.js";
import { counting, fixture } from "./helpers.js";

/** True only when `A` and `B` are the same type, so a narrowing and its absence are both pinned. */
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

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

/** "The cache is off": the no-store backend, which needs nothing provided. */
const cacheOff: Layer.Layer<ImageBackend> = ImageBackend.layerNone;

/** The cache over a hand-written backend double. */
const over = (backend: ImageBackendShape) =>
	ImageCache.layer.pipe(Layer.provide(Layer.succeed(ImageBackend)(backend)), Layer.merge(NodeCrypto.layer));

describe("ImageCache.getOrGenerate", () => {
	it.effect("accept narrows facts.format to the listed formats; without accept it stays the full union", () =>
		Effect.gen(function* () {
			const cache = yield* ImageCache;
			const narrowed = yield* cache.getOrGenerate(yield* keyFor("narrow"), () => Effect.succeed(PNG), {
				accept: ["png", "jpeg", "webp"],
			});
			// Compiles only when the result's format is narrowed by accept: a table with no gif or avif key is indexable.
			const extensions: Record<"png" | "jpeg" | "webp", string> = { png: "png", jpeg: "jpg", webp: "webp" };
			assert.strictEqual(extensions[narrowed.facts.format], "png");
			const narrowedExactly: Equals<typeof narrowed.facts.format, "png" | "jpeg" | "webp"> = true;
			const wide = yield* cache.getOrGenerate(yield* keyFor("wide"), () => Effect.succeed(GIF));
			const wideExactly: Equals<typeof wide.facts.format, ImageFormat> = true;
			assert.isTrue(narrowedExactly && wideExactly);
			assert.strictEqual(wide.facts.format, "gif");
		}).pipe(Effect.provide(live())),
	);

	it.effect("the consumer shapes: an as-const accept constant narrows, a plain ImageFormat[] variable stays wide", () =>
		Effect.gen(function* () {
			const cache = yield* ImageCache;
			const ACCEPT = ["png", "jpeg", "webp"] as const satisfies ReadonlyArray<ImageFormat>;
			const constant = yield* cache.getOrGenerate(yield* keyFor("const-accept"), () => Effect.succeed(PNG), {
				accept: ACCEPT,
			});
			const constantExactly: Equals<typeof constant.facts.format, "png" | "jpeg" | "webp"> = true;
			const formats: Array<ImageFormat> = ["png", "gif"];
			const variable = yield* cache.getOrGenerate(yield* keyFor("var-accept"), () => Effect.succeed(GIF), {
				accept: formats,
			});
			const variableExactly: Equals<typeof variable.facts.format, ImageFormat> = true;
			assert.isTrue(constantExactly && variableExactly);
			assert.strictEqual(constant.facts.format, "png");
			assert.strictEqual(variable.facts.format, "gif");
		}).pipe(Effect.provide(live())),
	);

	it.effect("an explicit format type argument without accept cannot narrow the result", () =>
		Effect.gen(function* () {
			const cache = yield* ImageCache;
			// Without accept the cache admits every format, so a caller-chosen F would be a lie: a gif typed "png".
			// @ts-expect-error: no overload takes a format type argument without an accept list.
			const forced = yield* cache.getOrGenerate<never, never, "png">(yield* keyFor("forced"), () =>
				Effect.succeed(GIF),
			);
			assert.strictEqual(forced.facts.format, "gif");
		}).pipe(Effect.provide(live())),
	);

	it.effect("over ImageBackend.layerNone the generator runs every time and nothing is ever a hit", () =>
		Effect.gen(function* () {
			const cache = yield* ImageCache;
			const key = yield* keyFor("off");
			const gen = counting(PNG);
			const first = yield* cache.getOrGenerate(key, gen.generate);
			const second = yield* cache.getOrGenerate(key, gen.generate);
			assert.isFalse(first.hit);
			assert.isFalse(second.hit);
			assert.strictEqual(gen.calls(), 2);
			assert.deepStrictEqual(second.bytes, PNG);
			assert.isTrue(Option.isNone(yield* (yield* ImageBackend).get(key.digest)));
		}).pipe(Effect.provide(ImageCache.layer.pipe(Layer.provideMerge(cacheOff), Layer.merge(NodeCrypto.layer)))),
	);

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
		const recording = over({
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
		}).pipe(Effect.provide(recording));
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
				over({
					get: () => Effect.succeedNone,
					set: (params) =>
						Effect.fail(new ImageBackendError({ operation: "set", key: params.key, cause: new Error("full") })),
				}),
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
				over({
					get: (key) => Effect.fail(new ImageBackendError({ operation: "get", key, cause: new Error("down") })),
					set: () => Effect.void,
				}),
			),
		),
	);
});
