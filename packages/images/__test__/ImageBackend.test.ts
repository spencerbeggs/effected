import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Cause, Effect, Exit, FileSystem, Layer, Option, Path, PlatformError } from "effect";
import { ImageBackend, ImageBackendError } from "../src/cache.js";
import { fixture } from "./helpers.js";

const DIR = "/cache/og";
const KEY = "a".repeat(64);
const PNG = fixture("png.png");
const JPEG = fixture("baseline.jpg");

const backend = (faults?: Parameters<typeof MemoryFileSystem.layerWith>[1]) =>
	ImageBackend.layerDirectory({ directory: DIR }).pipe(
		Layer.provideMerge(Layer.mergeAll(MemoryFileSystem.layerWith({}, faults ?? {}), Path.layer)),
	);

describe("ImageBackend.layerDirectory", () => {
	it.effect("round-trips bytes and content type, creating the directory", () =>
		Effect.gen(function* () {
			const images = yield* ImageBackend;
			assert.isTrue(Option.isNone(yield* images.get(KEY)));
			yield* images.set({ key: KEY, value: PNG, contentType: "image/png", tags: ["og"] });
			const stored = yield* images.get(KEY);
			assert.isTrue(Option.isSome(stored));
			if (Option.isSome(stored)) {
				assert.deepStrictEqual(stored.value.value, PNG);
				assert.strictEqual(stored.value.contentType, "image/png");
			}
			const fs = yield* FileSystem.FileSystem;
			assert.deepStrictEqual(yield* fs.readDirectory(DIR), [`${KEY}.png`]);
		}).pipe(Effect.provide(backend())),
	);

	it.effect("a rewrite under a different format replaces the old file", () =>
		Effect.gen(function* () {
			const images = yield* ImageBackend;
			yield* images.set({ key: KEY, value: PNG, contentType: "image/png" });
			yield* images.set({ key: KEY, value: JPEG, contentType: "image/jpeg" });
			const stored = yield* images.get(KEY);
			assert.isTrue(Option.isSome(stored) && stored.value.contentType === "image/jpeg");
			const fs = yield* FileSystem.FileSystem;
			assert.deepStrictEqual(yield* fs.readDirectory(DIR), [`${KEY}.jpg`]);
		}).pipe(Effect.provide(backend())),
	);

	it.effect("a rename failing mid-write leaves no hit and no temp file", () =>
		Effect.gen(function* () {
			const images = yield* ImageBackend;
			const error = yield* Effect.flip(images.set({ key: KEY, value: PNG, contentType: "image/png" }));
			assert.instanceOf(error, ImageBackendError);
			assert.strictEqual(error.operation, "set");
			assert.isTrue(Option.isNone(yield* images.get(KEY)));
			const fs = yield* FileSystem.FileSystem;
			assert.deepStrictEqual(yield* fs.readDirectory(DIR), []);
		}).pipe(
			Effect.provide(
				backend({
					faults: {
						rename: () =>
							Effect.fail(
								PlatformError.systemError({
									_tag: "PermissionDenied",
									module: "FileSystem",
									method: "rename",
									pathOrDescriptor: DIR,
								}),
							),
					},
				}),
			),
		),
	);

	it.effect("an unsupported content type is a typed set failure", () =>
		Effect.gen(function* () {
			const images = yield* ImageBackend;
			const error = yield* Effect.flip(images.set({ key: KEY, value: PNG, contentType: "image/svg+xml" }));
			assert.strictEqual(error.operation, "set");
		}).pipe(Effect.provide(backend())),
	);

	it.effect("a key that is not a digest dies — it can never become a path", () =>
		Effect.gen(function* () {
			const images = yield* ImageBackend;
			for (const bad of ["../escape", "A".repeat(64), "a".repeat(63)]) {
				const exit = yield* Effect.exit(images.get(bad));
				assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause), bad);
				const written = yield* Effect.exit(images.set({ key: bad, value: PNG, contentType: "image/png" }));
				assert.isTrue(Exit.isFailure(written) && Cause.hasDies(written.cause), `set ${bad}`);
			}
			// A rejected key must die BEFORE any write: nothing was created, not the directory and not an escaped file.
			const fs = yield* FileSystem.FileSystem;
			assert.isFalse(yield* fs.exists(DIR));
			assert.isFalse(yield* fs.exists("/cache/escape.png"));
		}).pipe(Effect.provide(backend())),
	);

	it.effect("inherited object keys are not content types", () =>
		Effect.gen(function* () {
			const images = yield* ImageBackend;
			const fs = yield* FileSystem.FileSystem;
			for (const contentType of ["constructor", "toString", "__proto__"]) {
				const error = yield* Effect.flip(images.set({ key: KEY, value: PNG, contentType }));
				assert.strictEqual(error.operation, "set", contentType);
			}
			const listing = yield* Effect.result(fs.readDirectory(DIR));
			assert.isTrue(listing._tag === "Failure" || listing.success.length === 0);
		}).pipe(Effect.provide(backend())),
	);

	it.effect("a read error other than NotFound surfaces as a typed get failure", () =>
		Effect.gen(function* () {
			const images = yield* ImageBackend;
			const error = yield* Effect.flip(images.get(KEY));
			assert.strictEqual(error.operation, "get");
		}).pipe(
			Effect.provide(
				backend({
					faults: {
						readFile: (path) =>
							Effect.fail(
								PlatformError.systemError({
									_tag: "PermissionDenied",
									module: "FileSystem",
									method: "readFile",
									pathOrDescriptor: path,
								}),
							),
					},
				}),
			),
		),
	);
});

// memfs is synchronous, so two writers would otherwise run strictly in sequence. Yielding before every write-path
// operation forces the writers into lockstep, which is the schedule where a remove-after-rename order loses both files.
const interleavedBackend = backend({
	faults: (base) => ({
		writeFile: (path, data, options) => Effect.andThen(Effect.yieldNow, base.writeFile(path, data, options)),
		remove: (path, options) => Effect.andThen(Effect.yieldNow, base.remove(path, options)),
		rename: (from, to) => Effect.andThen(Effect.yieldNow, base.rename(from, to)),
	}),
});

describe("ImageBackend directory concurrency (review focus 4)", () => {
	it.effect("two concurrent writers for one key leave one writer's complete bytes", () =>
		Effect.gen(function* () {
			const images = yield* ImageBackend;
			yield* Effect.all(
				[
					images.set({ key: KEY, value: PNG, contentType: "image/png" }),
					images.set({ key: KEY, value: JPEG, contentType: "image/jpeg" }),
				],
				{ concurrency: 2 },
			);
			const stored = yield* images.get(KEY);
			assert.isTrue(Option.isSome(stored));
			if (Option.isSome(stored)) {
				const bytes = stored.value.value;
				assert.isTrue(
					(stored.value.contentType === "image/png" && bytes.length === PNG.length) ||
						(stored.value.contentType === "image/jpeg" && bytes.length === JPEG.length),
				);
			}
			const fs = yield* FileSystem.FileSystem;
			assert.isFalse((yield* fs.readDirectory(DIR)).some((name) => name.endsWith(".tmp")));
		}).pipe(Effect.provide(interleavedBackend)),
	);
});
