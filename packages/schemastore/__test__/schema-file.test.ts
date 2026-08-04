import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, PlatformError, Result } from "effect";
import {
	DocumentDiff,
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

// The other member of PlatformError's `reason` union: a BadArgument-reasoned
// wrapper (reason._tag is "BadArgument", not a SystemErrorTag).
const badArgument = (method: string) =>
	PlatformError.badArgument({ module: "FileSystem", method, description: "hostile path" });

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
				assert.deepStrictEqual(outcome, { outcome: "written", change: "created" });
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
				assert.deepStrictEqual(outcome, { outcome: "unchanged", change: "none" });
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
				assert.deepStrictEqual(outcome, { outcome: "written", change: "contract" });
				assert.isTrue(wrote);
			}),
		);

		// The reported failure (spencerbeggs/effected#262): a repo whose
		// pre-commit hook formats JSON reflows the emitted file, so the bytes
		// stop matching CanonicalJson's while the content never changed. A
		// byte comparison rewrites forever and "unchanged" becomes
		// unreachable.
		it.effect("answers unchanged without writing when a formatter reflowed the file but the content is equal", () =>
			Effect.gen(function* () {
				// What Biome would leave behind: same document, collapsed
				// arrays and spaces instead of tabs.
				const reflowed = JSON.stringify(JSON.parse(canonicalText), null, 2);
				assert.notStrictEqual(reflowed, canonicalText, "the reflowed text must differ byte-wise");
				const fs = FileSystem.layerNoop({
					readFileString: () => Effect.succeed(reflowed),
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
				assert.deepStrictEqual(outcome, { outcome: "unchanged", change: "none" });
			}),
		);

		it.effect('compare: "bytes" opts back in to the byte comparison, and still classifies the content', () =>
			Effect.gen(function* () {
				const reflowed = JSON.stringify(JSON.parse(canonicalText), null, 2);
				let wrote = false;
				const fs = FileSystem.layerNoop({
					readFileString: () => Effect.succeed(reflowed),
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
						return yield* files.write("schemas/x.schema.json", document, { compare: "bytes" });
					}),
					fs,
				);
				// It wrote (the bytes differed) but nothing about the content
				// moved — the two fields are independent by design.
				assert.deepStrictEqual(outcome, { outcome: "written", change: "none" });
				assert.isTrue(wrote);
			}),
		);

		it.effect('reports change "annotations" when only prose moved — the signal that no new version is needed', () =>
			Effect.gen(function* () {
				const previous = StoreDocument.make({
					$schema: "http://json-schema.org/draft-07/schema#",
					$id: "https://example.com/x.schema.json",
					root: { type: "object", description: "Prior wording" },
					defs: {},
				});
				const fs = FileSystem.layerNoop({
					readFileString: () => Effect.succeed(Result.getOrThrow(previous.serializeResult())),
					makeDirectory: () => Effect.void,
					writeFileString: () => Effect.void,
				});
				const described = StoreDocument.make({
					$schema: "http://json-schema.org/draft-07/schema#",
					$id: "https://example.com/x.schema.json",
					root: { type: "object", description: "Reworded, same contract" },
					defs: {},
				});
				const outcome = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* files.write("schemas/x.schema.json", described);
					}),
					fs,
				);
				assert.strictEqual(outcome.outcome, "written");
				assert.strictEqual(outcome.change, "annotations");
			}),
		);

		it.effect("an existing file that does not parse is repaired, classified conservatively as a contract change", () =>
			Effect.gen(function* () {
				let wrote = false;
				const fs = FileSystem.layerNoop({
					readFileString: () => Effect.succeed("{ not json"),
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
				assert.deepStrictEqual(outcome, { outcome: "written", change: "contract" });
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

		it.effect(
			"a BadArgument-reasoned comparison read failure fails typed with SchemaFileReadError — never a defect, never a write",
			() =>
				Effect.gen(function* () {
					const fs = FileSystem.layerNoop({
						readFileString: () => Effect.fail(badArgument("readFileString")),
						makeDirectory: () => Effect.void,
						writeFileString: () => Effect.die(new Error("must not write when the comparison read failed")),
					});
					// Effect.flip only surfaces a TYPED failure: were the mapper to
					// throw on the BadArgument reason, this would die, not flip.
					const error = yield* run(
						Effect.gen(function* () {
							const files = yield* SchemaFile;
							return yield* Effect.flip(files.write("schemas/x.schema.json", document));
						}),
						fs,
					);
					assert.instanceOf(error, SchemaFileReadError);
					assert.strictEqual(error.path, "schemas/x.schema.json");
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

	describe("check", () => {
		it.effect("classifies without touching the filesystem — the drift-check half of the pair", () =>
			Effect.gen(function* () {
				const reflowed = JSON.stringify(JSON.parse(canonicalText), null, 2);
				const fs = FileSystem.layerNoop({
					readFileString: () => Effect.succeed(reflowed),
					makeDirectory: () => Effect.die(new Error("check must never write")),
					writeFileString: () => Effect.die(new Error("check must never write")),
				});
				const change = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* files.check("schemas/x.schema.json", document);
					}),
					fs,
				);
				// Content is clean AND the writer would do nothing — the two
				// answers agree under the default compare mode.
				assert.deepStrictEqual(change, { wouldWrite: false, change: "none" });
				assert.isTrue(DocumentDiff.isClean(change.change));
			}),
		);

		// The asymmetry the adopter hit: under bytes mode `change` and
		// "would the writer act" are different questions, and check must
		// answer both or the pair disagrees.
		it.effect('under compare: "bytes", wouldWrite tracks the writer while change tracks content', () =>
			Effect.gen(function* () {
				const reflowed = JSON.stringify(JSON.parse(canonicalText), null, 2);
				const result = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* files.check("schemas/x.schema.json", document, { compare: "bytes" });
					}),
					FileSystem.layerNoop({ readFileString: () => Effect.succeed(reflowed) }),
				);
				assert.deepStrictEqual(result, { wouldWrite: true, change: "none" });
			}),
		);

		it.effect('answers "created" for a missing file, and "contract" for drifted content', () =>
			Effect.gen(function* () {
				const missing = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* files.check("schemas/x.schema.json", document);
					}),
					// layerNoop's readFileString fails NotFound by default.
					FileSystem.layerNoop({}),
				);
				assert.deepStrictEqual(missing, { wouldWrite: true, change: "created" });
				assert.isFalse(DocumentDiff.isClean(missing.change), "a file that did not exist is not clean");

				const drifted = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* files.check("schemas/x.schema.json", document);
					}),
					FileSystem.layerNoop({
						readFileString: () => Effect.succeed(JSON.stringify({ type: "array" })),
					}),
				);
				assert.deepStrictEqual(drifted, { wouldWrite: true, change: "contract" });
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

		it.effect("a BadArgument-reasoned failure fails typed with SchemaFileReadError, not a defect", () =>
			Effect.gen(function* () {
				const fs = FileSystem.layerNoop({
					readFileString: () => Effect.fail(badArgument("readFileString")),
				});
				// Effect.flip only surfaces a TYPED failure: were the mapper to
				// throw on the BadArgument reason, this would die, not flip.
				const error = yield* run(
					Effect.gen(function* () {
						const files = yield* SchemaFile;
						return yield* Effect.flip(files.read("schemas/x.schema.json"));
					}),
					fs,
				);
				assert.instanceOf(error, SchemaFileReadError);
				assert.strictEqual(error.path, "schemas/x.schema.json");
			}),
		);
	});
});
