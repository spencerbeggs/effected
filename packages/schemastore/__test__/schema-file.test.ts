import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, PlatformError, Result } from "effect";
import {
	NonJsonValueError,
	SchemaFile,
	SchemaFileNotFoundError,
	SchemaFileReadError,
	SchemaFileWriteError,
	StoreDocument,
} from "../src/index.js";

const document = StoreDocument.make({
	$schema: "http://json-schema.org/draft-07/schema#",
	$id: "https://example.com/x.schema.json",
	root: { type: "object" },
	defs: {},
});

const canonicalText = Result.getOrThrow(document.serializeResult());

const permissionDenied = (method: string) =>
	PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method });

// SchemaFile over a stubbed core FileSystem (layerNoop members fail NotFound
// unless overridden) — no platform package anywhere in this suite.
const withFs = (fs: Layer.Layer<FileSystem.FileSystem>) =>
	SchemaFile.layer.pipe(Layer.provide(Layer.mergeAll(fs, Path.layer)));

const run = <A, E>(program: Effect.Effect<A, E, SchemaFile>, fs: Layer.Layer<FileSystem.FileSystem>) =>
	Effect.provide(program, withFs(fs));

describe("SchemaFile", () => {
	describe("write", () => {
		it.effect('writes a missing file and answers "written"', () =>
			Effect.gen(function* () {
				const written: Array<{ path: string; text: string }> = [];
				const fs = FileSystem.layerNoop({
					makeDirectory: () => Effect.void,
					writeFileString: (path, text) =>
						Effect.suspend(() => {
							written.push({ path, text });
							return Effect.void;
						}),
				});
				const outcome = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* files.write("schemas/x.schema.json", document);
					}),
					fs,
				);
				assert.strictEqual(outcome, "written");
				assert.strictEqual(written.length, 1);
				assert.strictEqual(written[0]?.path, "schemas/x.schema.json");
				assert.strictEqual(written[0]?.text, canonicalText);
			}),
		);

		it.effect('answers "unchanged" without writing when the on-disk bytes already match', () =>
			Effect.gen(function* () {
				const fs = FileSystem.layerNoop({
					readFileString: () => Effect.succeed(canonicalText),
					// Any write attempt dies loudly: "unchanged" must mean untouched.
					makeDirectory: () => Effect.die(new Error("makeDirectory must not run for an unchanged file")),
					writeFileString: () => Effect.die(new Error("writeFileString must not run for an unchanged file")),
				});
				const outcome = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* files.write("schemas/x.schema.json", document);
					}),
					fs,
				);
				assert.strictEqual(outcome, "unchanged");
			}),
		);

		it.effect("rewrites when the on-disk content differs", () =>
			Effect.gen(function* () {
				let wrote = false;
				const fs = FileSystem.layerNoop({
					readFileString: () => Effect.succeed(`${canonicalText}stale`),
					makeDirectory: () => Effect.void,
					writeFileString: () =>
						Effect.suspend(() => {
							wrote = true;
							return Effect.void;
						}),
				});
				const outcome = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* files.write("schemas/x.schema.json", document);
					}),
					fs,
				);
				assert.strictEqual(outcome, "written");
				assert.isTrue(wrote);
			}),
		);

		it.effect("a comparison read failure other than not-found fails typed — never a silent overwrite", () =>
			Effect.gen(function* () {
				const fs = FileSystem.layerNoop({
					readFileString: () => Effect.fail(permissionDenied("readFileString")),
					makeDirectory: () => Effect.void,
					writeFileString: () => Effect.die(new Error("must not write when the comparison read failed")),
				});
				const error = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* Effect.flip(files.write("schemas/x.schema.json", document));
					}),
					fs,
				);
				assert.instanceOf(error, SchemaFileReadError);
			}),
		);

		it.effect("a filesystem write failure fails typed with SchemaFileWriteError", () =>
			Effect.gen(function* () {
				const fs = FileSystem.layerNoop({
					makeDirectory: () => Effect.void,
					writeFileString: () => Effect.fail(permissionDenied("writeFileString")),
				});
				const error = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* Effect.flip(files.write("schemas/x.schema.json", document));
					}),
					fs,
				);
				assert.instanceOf(error, SchemaFileWriteError);
				assert.strictEqual(error.path, "schemas/x.schema.json");
			}),
		);

		it.effect("a parent-directory creation failure fails typed with SchemaFileWriteError", () =>
			Effect.gen(function* () {
				const fs = FileSystem.layerNoop({
					makeDirectory: () => Effect.fail(permissionDenied("makeDirectory")),
					writeFileString: () => Effect.die(new Error("must not write when the directory could not be created")),
				});
				const error = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* Effect.flip(files.write("schemas/x.schema.json", document));
					}),
					fs,
				);
				assert.instanceOf(error, SchemaFileWriteError);
			}),
		);

		it.effect("a document that does not serialize propagates the CanonicalJson error untouched", () =>
			Effect.gen(function* () {
				const hostile = StoreDocument.make({
					$schema: "http://json-schema.org/draft-07/schema#",
					$id: "https://example.com/x.schema.json",
					root: { bad: undefined },
					defs: {},
				});
				const fs = FileSystem.layerNoop({
					writeFileString: () => Effect.die(new Error("must not write an unserializable document")),
				});
				const error = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* Effect.flip(files.write("schemas/x.schema.json", hostile));
					}),
					fs,
				);
				assert.instanceOf(error, NonJsonValueError);
			}),
		);
	});

	describe("read", () => {
		it.effect("returns the file's exact text", () =>
			Effect.gen(function* () {
				const fs = FileSystem.layerNoop({
					readFileString: () => Effect.succeed(canonicalText),
				});
				const text = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* files.read("schemas/x.schema.json");
					}),
					fs,
				);
				assert.strictEqual(text, canonicalText);
			}),
		);

		it.effect("a missing file fails with SchemaFileNotFoundError, its own tag", () =>
			Effect.gen(function* () {
				// layerNoop's default readFileString fails NotFound.
				const error = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* Effect.flip(files.read("schemas/missing.schema.json"));
					}),
					FileSystem.layerNoop({}),
				);
				assert.instanceOf(error, SchemaFileNotFoundError);
				assert.strictEqual(error._tag, "SchemaFileNotFoundError");
				assert.strictEqual(error.path, "schemas/missing.schema.json");
			}),
		);

		it.effect("any other filesystem failure fails with SchemaFileReadError", () =>
			Effect.gen(function* () {
				const fs = FileSystem.layerNoop({
					readFileString: () => Effect.fail(permissionDenied("readFileString")),
				});
				const error = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* Effect.flip(files.read("schemas/x.schema.json"));
					}),
					fs,
				);
				assert.instanceOf(error, SchemaFileReadError);
			}),
		);
	});
});
