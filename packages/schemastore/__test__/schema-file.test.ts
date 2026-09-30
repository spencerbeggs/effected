import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemFaults, MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path, PlatformError, Result } from "effect";
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

// What Biome would leave behind: same document, collapsed arrays and spaces
// instead of tabs.
const reflowed = JSON.stringify(JSON.parse(canonicalText), null, 2);

const TARGET = "/repo/schemas/x.schema.json";

const permissionDenied = (method: string, path: string) =>
	PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method, pathOrDescriptor: path });

// The other member of PlatformError's `reason` union: a BadArgument-reasoned
// wrapper (reason._tag is "BadArgument", not a SystemErrorTag).
const badArgument = (method: string) =>
	PlatformError.badArgument({ module: "FileSystem", method, description: "hostile path" });

// Any write attempt dies loudly — a defect `Effect.catch` cannot absorb, so an
// "untouched" proof cannot pass by the writer recovering from a typed failure.
const noWrites = (reason: string): MemoryFileSystemFaults => ({
	makeDirectory: MemoryFileSystem.die(new Error(`makeDirectory must not run: ${reason}`)),
	writeFile: MemoryFileSystem.die(new Error(`writeFile must not run: ${reason}`)),
	writeFileString: MemoryFileSystem.die(new Error(`writeFileString must not run: ${reason}`)),
});

// SchemaFile over an in-memory volume. `provideMerge` keeps the memfs
// `Volume` in the program's context, so every assertion on what landed runs
// under the SAME provide (and therefore the same volume) as the code.
const env = (seed: MemoryFileSystemSeed, faults?: MemoryFileSystemFaults) =>
	SchemaFile.layer.pipe(Layer.provideMerge(Layer.mergeAll(MemoryFileSystem.layerWith(seed, { faults }), Path.layer)));

describe("SchemaFile", () => {
	describe("write", () => {
		it.effect('writes a missing file and answers "written"', () =>
			Effect.gen(function* () {
				const files = yield* SchemaFile;
				const outcome = yield* files.write(TARGET, document);
				assert.deepStrictEqual(outcome, { outcome: "written", change: "created" });
				const volume = yield* MemoryFileSystem.Volume;
				assert.deepStrictEqual(volume.paths(), [TARGET]);
				assert.strictEqual(volume.text(TARGET), canonicalText);
			}).pipe(Effect.provide(env({}))),
		);

		it.effect('answers "unchanged" without writing when the on-disk bytes already match', () =>
			Effect.gen(function* () {
				const files = yield* SchemaFile;
				const outcome = yield* files.write(TARGET, document);
				assert.deepStrictEqual(outcome, { outcome: "unchanged", change: "none" });
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.text(TARGET), canonicalText);
			}).pipe(Effect.provide(env({ [TARGET]: canonicalText }, noWrites("the file is unchanged")))),
		);

		it.effect("rewrites when the on-disk content differs", () =>
			Effect.gen(function* () {
				const files = yield* SchemaFile;
				const outcome = yield* files.write(TARGET, document);
				assert.deepStrictEqual(outcome, { outcome: "written", change: "contract" });
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.text(TARGET), canonicalText);
			}).pipe(Effect.provide(env({ [TARGET]: `${canonicalText}stale` }))),
		);

		// The reported failure (spencerbeggs/effected#262): a repo whose
		// pre-commit hook formats JSON reflows the emitted file, so the bytes
		// stop matching CanonicalJson's while the content never changed. A
		// byte comparison rewrites forever and "unchanged" becomes
		// unreachable.
		it.effect("answers unchanged without writing when a formatter reflowed the file but the content is equal", () =>
			Effect.gen(function* () {
				assert.notStrictEqual(reflowed, canonicalText, "the reflowed text must differ byte-wise");
				const files = yield* SchemaFile;
				const outcome = yield* files.write(TARGET, document);
				assert.deepStrictEqual(outcome, { outcome: "unchanged", change: "none" });
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.text(TARGET), reflowed, "the formatter's bytes stay on disk");
			}).pipe(Effect.provide(env({ [TARGET]: reflowed }, noWrites("the content is unchanged")))),
		);

		it.effect('compare: "bytes" opts back in to the byte comparison, and still classifies the content', () =>
			Effect.gen(function* () {
				const files = yield* SchemaFile;
				const outcome = yield* files.write(TARGET, document, { compare: "bytes" });
				// It wrote (the bytes differed) but nothing about the content
				// moved — the two fields are independent by design.
				assert.deepStrictEqual(outcome, { outcome: "written", change: "none" });
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.text(TARGET), canonicalText);
			}).pipe(Effect.provide(env({ [TARGET]: reflowed }))),
		);

		it.effect('reports change "annotations" when only prose moved — the signal that no new version is needed', () => {
			const previous = StoreDocument.make({
				$schema: "http://json-schema.org/draft-07/schema#",
				$id: "https://example.com/x.schema.json",
				root: { type: "object", description: "Prior wording" },
				defs: {},
			});
			const described = StoreDocument.make({
				$schema: "http://json-schema.org/draft-07/schema#",
				$id: "https://example.com/x.schema.json",
				root: { type: "object", description: "Reworded, same contract" },
				defs: {},
			});
			return Effect.gen(function* () {
				const files = yield* SchemaFile;
				const outcome = yield* files.write(TARGET, described);
				assert.strictEqual(outcome.outcome, "written");
				assert.strictEqual(outcome.change, "annotations");
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.text(TARGET), Result.getOrThrow(described.serializeResult()));
			}).pipe(Effect.provide(env({ [TARGET]: Result.getOrThrow(previous.serializeResult()) })));
		});

		it.effect("an existing file that does not parse is repaired, classified conservatively as a contract change", () =>
			Effect.gen(function* () {
				const files = yield* SchemaFile;
				const outcome = yield* files.write(TARGET, document);
				assert.deepStrictEqual(outcome, { outcome: "written", change: "contract" });
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.text(TARGET), canonicalText);
			}).pipe(Effect.provide(env({ [TARGET]: "{ not json" }))),
		);

		it.effect("a comparison read failure other than not-found fails typed — never a silent overwrite", () =>
			Effect.gen(function* () {
				const files = yield* SchemaFile;
				const error = yield* Effect.flip(files.write(TARGET, document));
				assert.instanceOf(error, SchemaFileReadError);
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.text(TARGET), `${canonicalText}stale`);
			}).pipe(
				Effect.provide(
					env(
						{ [TARGET]: `${canonicalText}stale` },
						{
							...noWrites("the comparison read failed"),
							readFileString: (path) =>
								path === TARGET ? Effect.fail(permissionDenied("readFileString", path)) : undefined,
						},
					),
				),
			),
		);

		it.effect("a filesystem write failure fails typed with SchemaFileWriteError", () =>
			Effect.gen(function* () {
				const files = yield* SchemaFile;
				const error = yield* Effect.flip(files.write(TARGET, document));
				assert.instanceOf(error, SchemaFileWriteError);
				assert.strictEqual(error.path, TARGET);
				const volume = yield* MemoryFileSystem.Volume;
				assert.isFalse(volume.has(TARGET));
			}).pipe(
				Effect.provide(
					env(
						{},
						{
							writeFileString: (path) =>
								path === TARGET ? Effect.fail(permissionDenied("writeFileString", path)) : undefined,
						},
					),
				),
			),
		);

		it.effect("a parent-directory creation failure fails typed with SchemaFileWriteError", () =>
			Effect.gen(function* () {
				const files = yield* SchemaFile;
				const error = yield* Effect.flip(files.write(TARGET, document));
				assert.instanceOf(error, SchemaFileWriteError);
				const volume = yield* MemoryFileSystem.Volume;
				assert.deepStrictEqual(volume.paths(), []);
			}).pipe(
				Effect.provide(
					env(
						{},
						{
							makeDirectory: (path) => Effect.fail(permissionDenied("makeDirectory", path)),
							writeFile: MemoryFileSystem.die(new Error("must not write when the directory could not be created")),
							writeFileString: MemoryFileSystem.die(
								new Error("must not write when the directory could not be created"),
							),
						},
					),
				),
			),
		);

		it.effect(
			"a BadArgument-reasoned comparison read failure fails typed with SchemaFileReadError — never a defect, never a write",
			() =>
				Effect.gen(function* () {
					// Effect.flip only surfaces a TYPED failure: were the mapper to
					// throw on the BadArgument reason, this would die, not flip.
					const files = yield* SchemaFile;
					const error = yield* Effect.flip(files.write(TARGET, document));
					assert.instanceOf(error, SchemaFileReadError);
					assert.strictEqual(error.path, TARGET);
				}).pipe(
					Effect.provide(
						env(
							{ [TARGET]: `${canonicalText}stale` },
							{
								...noWrites("the comparison read failed"),
								readFileString: (path) => (path === TARGET ? Effect.fail(badArgument("readFileString")) : undefined),
							},
						),
					),
				),
		);

		it.effect("a document that does not serialize propagates the CanonicalJson error untouched", () => {
			const hostile = StoreDocument.make({
				$schema: "http://json-schema.org/draft-07/schema#",
				$id: "https://example.com/x.schema.json",
				root: { bad: undefined },
				defs: {},
			});
			return Effect.gen(function* () {
				const files = yield* SchemaFile;
				const error = yield* Effect.flip(files.write(TARGET, hostile));
				assert.instanceOf(error, NonJsonValueError);
			}).pipe(Effect.provide(env({}, noWrites("the document does not serialize"))));
		});
	});

	describe("check", () => {
		it.effect("classifies without touching the filesystem — the drift-check half of the pair", () =>
			Effect.gen(function* () {
				const files = yield* SchemaFile;
				const change = yield* files.check(TARGET, document);
				// Content is clean AND the writer would do nothing — the two
				// answers agree under the default compare mode.
				assert.deepStrictEqual(change, { wouldWrite: false, change: "none" });
				assert.isTrue(DocumentDiff.isClean(change.change));
			}).pipe(Effect.provide(env({ [TARGET]: reflowed }, noWrites("check must never write")))),
		);

		// The asymmetry the adopter hit: under bytes mode `change` and
		// "would the writer act" are different questions, and check must
		// answer both or the pair disagrees.
		it.effect('under compare: "bytes", wouldWrite tracks the writer while change tracks content', () =>
			Effect.gen(function* () {
				const files = yield* SchemaFile;
				const result = yield* files.check(TARGET, document, { compare: "bytes" });
				assert.deepStrictEqual(result, { wouldWrite: true, change: "none" });
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.text(TARGET), reflowed, "check never writes, even when it would");
			}).pipe(Effect.provide(env({ [TARGET]: reflowed }, noWrites("check must never write")))),
		);

		it.effect('answers "created" for a missing file, and "contract" for drifted content', () =>
			Effect.gen(function* () {
				const checkTarget = Effect.gen(function* () {
					const files = yield* SchemaFile;
					return yield* files.check(TARGET, document);
				});
				// A sibling exists, so the absence is the path's own.
				const missing = yield* checkTarget.pipe(
					Effect.provide(env({ "/repo/schemas/other.schema.json": canonicalText }, noWrites("check"))),
				);
				assert.deepStrictEqual(missing, { wouldWrite: true, change: "created" });
				assert.isFalse(DocumentDiff.isClean(missing.change), "a file that did not exist is not clean");

				const drifted = yield* checkTarget.pipe(
					Effect.provide(env({ [TARGET]: JSON.stringify({ type: "array" }) }, noWrites("check"))),
				);
				assert.deepStrictEqual(drifted, { wouldWrite: true, change: "contract" });
			}),
		);
	});

	describe("read", () => {
		it.effect("returns the file's exact text", () =>
			Effect.gen(function* () {
				const files = yield* SchemaFile;
				const text = yield* files.read(TARGET);
				assert.strictEqual(text, canonicalText);
			}).pipe(Effect.provide(env({ [TARGET]: canonicalText }))),
		);

		it.effect("a missing file fails with SchemaFileNotFoundError, its own tag", () =>
			Effect.gen(function* () {
				// A sibling exists, so the absence is the path's own, not an
				// empty volume's.
				const files = yield* SchemaFile;
				const error = yield* Effect.flip(files.read("/repo/schemas/missing.schema.json"));
				assert.instanceOf(error, SchemaFileNotFoundError);
				assert.strictEqual(error._tag, "SchemaFileNotFoundError");
				assert.strictEqual(error.path, "/repo/schemas/missing.schema.json");
			}).pipe(Effect.provide(env({ [TARGET]: canonicalText }))),
		);

		it.effect("any other filesystem failure fails with SchemaFileReadError", () =>
			Effect.gen(function* () {
				const files = yield* SchemaFile;
				const error = yield* Effect.flip(files.read(TARGET));
				assert.instanceOf(error, SchemaFileReadError);
			}).pipe(
				Effect.provide(
					env(
						{ [TARGET]: canonicalText },
						{
							readFileString: (path) =>
								path === TARGET ? Effect.fail(permissionDenied("readFileString", path)) : undefined,
						},
					),
				),
			),
		);

		it.effect("a BadArgument-reasoned failure fails typed with SchemaFileReadError, not a defect", () =>
			Effect.gen(function* () {
				// Effect.flip only surfaces a TYPED failure: were the mapper to
				// throw on the BadArgument reason, this would die, not flip.
				const files = yield* SchemaFile;
				const error = yield* Effect.flip(files.read(TARGET));
				assert.instanceOf(error, SchemaFileReadError);
				assert.strictEqual(error.path, TARGET);
			}).pipe(
				Effect.provide(
					env(
						{ [TARGET]: canonicalText },
						{ readFileString: (path) => (path === TARGET ? Effect.fail(badArgument("readFileString")) : undefined) },
					),
				),
			),
		);
	});
});
