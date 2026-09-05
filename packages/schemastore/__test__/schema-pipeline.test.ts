import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem, Layer, Path, Result, Schema } from "effect";
import type { SchemaVersion } from "../src/index.js";
import {
	SchemaContractChangeError,
	SchemaFile,
	SchemaGateError,
	SchemaPipeline,
	SchemaTarget,
	SchemaValidator,
	SchemaVersioning,
	StoreDocument,
	ValidationFinding,
} from "../src/index.js";

const Config = Schema.Struct({ name: Schema.String });

const target = SchemaTarget.make({
	schema: Config,
	$id: "https://example.com/config.schema.json",
	path: "schemas/config.schema.json",
});

// A target whose root description carries no docs URL, firing the lint's
// DescriptionWithoutUrl advisory — which must NOT block under the default
// policy.
const advisoryTarget = SchemaTarget.make({
	schema: Config.annotate({ description: "Build configuration" }),
	$id: "https://example.com/advisory.schema.json",
	path: "schemas/advisory.schema.json",
});

const layers = (
	fs: Layer.Layer<FileSystem.FileSystem>,
	validator: Layer.Layer<SchemaValidator> = SchemaValidator.layer,
) => Layer.mergeAll(SchemaFile.layer.pipe(Layer.provide(Layer.mergeAll(fs, Path.layer))), validator);

// ── Contract-gate fixtures (#556) ─────────────────────────────────────────
//
// A pinned versioned target is a PUBLISHED document: consumers pin its URL,
// so `run` refuses to rewrite it in place when its validation contract
// moves. These fixtures pair a target with the predecessor text already on
// the memfs volume, so the classification is a real comparison rather than
// a stubbed answer.

const version = (label: string): SchemaVersion => Result.getOrThrow(SchemaVersioning.parseResult(label));

// Sync all the way down — `fromSchemaResult` and `serializeResult` are the
// package's own Result primitives, so no fixture pre-runs an Effect.
const emitted = (schema: Schema.Constraint, $id: string): string =>
	Result.getOrThrow(Result.getOrThrow(StoreDocument.fromSchemaResult(schema, { $id })).serializeResult());

// The predecessor's `required` carries an extra member, so the successor
// generated from `Config` reads as a CONTRACT change.
const Wider = Schema.Struct({ name: Schema.String, extra: Schema.String });

const PINNED_ID = "https://example.com/schemas/pinned-5.0.0.json";
const PINNED_PATH = "/schemas/5.0.0/pinned-5.0.0.json";
const pinnedTarget = SchemaTarget.make({
	schema: Config,
	$id: PINNED_ID,
	name: "pinned",
	path: PINNED_PATH,
	version: version("5.0.0"),
});

const SECOND_ID = "https://example.com/schemas/second-1.2.3.json";
const SECOND_PATH = "/schemas/1.2.3/second-1.2.3.json";
const secondPinnedTarget = SchemaTarget.make({
	schema: Config,
	$id: SECOND_ID,
	name: "second",
	path: SECOND_PATH,
	version: version("1.2.3"),
});

const CLEAN_ID = "https://example.com/schemas/clean-2.0.0.json";
const CLEAN_PATH = "/schemas/2.0.0/clean-2.0.0.json";
const cleanPinnedTarget = SchemaTarget.make({
	schema: Config,
	$id: CLEAN_ID,
	name: "clean",
	path: CLEAN_PATH,
	version: version("2.0.0"),
});

const PRERELEASE_ID = "https://example.com/schemas/beta-2.0.0-beta.1.json";
const PRERELEASE_PATH = "/schemas/2.0.0-beta.1/beta-2.0.0-beta.1.json";
const prereleaseTarget = SchemaTarget.make({
	schema: Config,
	$id: PRERELEASE_ID,
	name: "beta",
	path: PRERELEASE_PATH,
	version: version("2.0.0-beta.1"),
});

const UNVERSIONED_ID = "https://example.com/schemas/plain.json";
const UNVERSIONED_PATH = "/schemas/plain.json";
const unversionedTarget = SchemaTarget.make({
	schema: Config,
	$id: UNVERSIONED_ID,
	path: UNVERSIONED_PATH,
});

// Same contract, different prose — classifies as "annotations", which is
// transparently replaceable and must be rewritten in place even on a pinned
// document.
const ANNOTATED_ID = "https://example.com/schemas/annotated-3.0.0.json";
const ANNOTATED_PATH = "/schemas/3.0.0/annotated-3.0.0.json";
const annotatedTarget = SchemaTarget.make({
	schema: Config.annotate({ description: "After\nhttps://example.com/docs" }),
	$id: ANNOTATED_ID,
	name: "annotated",
	path: ANNOTATED_PATH,
	version: version("3.0.0"),
});

// One memory volume behind BOTH the `SchemaFile` layer and the inspection
// view: `memory` is bound once and merged by reference, so layer
// memoization gives the reads and the writes the same volume.
//
// `layerInspectableWith` RE-SEEDS on every build, so a `MemoryFileSystem.Volume`
// resolved under a SECOND `Effect.provide` of the same layer value is a fresh
// volume holding the seed — which makes "nothing was written" pass vacuously.
// Every test below therefore resolves the volume INSIDE the one program it
// provides. (Caught by the corrupted-file repair case, whose read-back is the
// only assertion here that a fresh volume cannot satisfy.)
const memLayers = (seed: MemoryFileSystemSeed, validator: Layer.Layer<SchemaValidator> = SchemaValidator.layer) => {
	const memory = MemoryFileSystem.layerInspectableWith(seed);
	const base = Layer.mergeAll(memory, Path.layer);
	return Layer.mergeAll(SchemaFile.layer.pipe(Layer.provide(base)), base, validator);
};

const writable = (written: Array<string> = []) =>
	FileSystem.layerNoop({
		makeDirectory: () => Effect.void,
		writeFileString: (path) =>
			Effect.suspend(() => {
				written.push(path);
				return Effect.void;
			}),
	});

describe("SchemaPipeline", () => {
	describe("run", () => {
		it.effect("generates, gates and writes each target, answering results as values", () =>
			Effect.gen(function* () {
				const written: Array<string> = [];
				const results = yield* Effect.provide(SchemaPipeline.run([target]), layers(writable(written)));
				assert.strictEqual(results.length, 1);
				assert.strictEqual(results[0]?.$id, "https://example.com/config.schema.json");
				assert.strictEqual(results[0]?.outcome, "written");
				assert.strictEqual(results[0]?.change, "created");
				assert.deepStrictEqual(written, ["schemas/config.schema.json"]);
			}),
		);

		// The policy default, and the reason it is a default rather than a
		// hardcode: an advisory is reported, not enforced.
		it.effect("advisory findings are returned but do not block", () =>
			Effect.gen(function* () {
				const results = yield* Effect.provide(SchemaPipeline.run([advisoryTarget]), layers(writable()));
				const advisories = results[0]?.findings.filter((finding) => finding.severity === "advisory") ?? [];
				assert.isAtLeast(advisories.length, 1, "the description-without-url advisory should be reported");
				assert.strictEqual(results[0]?.outcome, "written", "an advisory must not stop the write");
			}),
		);

		it.effect("a blocking finding fails with SchemaGateError and the file is never written", () =>
			Effect.gen(function* () {
				const fs = FileSystem.layerNoop({
					makeDirectory: () => Effect.die(new Error("must not write a document that failed its gate")),
					writeFileString: () => Effect.die(new Error("must not write a document that failed its gate")),
				});
				// A validator that rejects, standing in for a real engine finding.
				const rejecting = SchemaValidator.layerTest({
					validate: () =>
						Effect.succeed([ValidationFinding.make({ path: "/type", message: "rejected", keyword: "type" })]),
				});
				const error = yield* Effect.flip(Effect.provide(SchemaPipeline.run([target]), layers(fs, rejecting)));
				assert.instanceOf(error, SchemaGateError);
				assert.strictEqual(error.$id, "https://example.com/config.schema.json");
				assert.strictEqual(error.findings.length, 1);
				assert.strictEqual(error.findings[0]?.source, "validator");
				assert.strictEqual(error.findings[0]?.check, "type", "the engine keyword carries into the finding");
			}),
		);

		// The overridable half of the policy: a consumer who disagrees
		// replaces the predicate rather than re-implementing the loop.
		it.effect("a custom blocking predicate can block on an advisory, or tolerate a warning", () =>
			Effect.gen(function* () {
				const strict = yield* Effect.flip(
					Effect.provide(SchemaPipeline.run([advisoryTarget], { blocking: () => true }), layers(writable())),
				);
				assert.instanceOf(strict, SchemaGateError);

				const permissive = yield* Effect.provide(
					SchemaPipeline.run([target], { blocking: () => false }),
					layers(
						writable(),
						SchemaValidator.layerTest({
							validate: () => Effect.succeed([ValidationFinding.make({ path: "", message: "ignored" })]),
						}),
					),
				);
				assert.strictEqual(permissive[0]?.outcome, "written", "a tolerated warning still writes");
				assert.strictEqual(permissive[0]?.findings.length, 1, "and is still reported as a value");
			}),
		);

		// `run` is now all-or-nothing rather than merely fail-fast: the gate
		// still stops the walk at the first blocked target, and no target
		// before it has been written either, because writes are a second
		// phase. "Later targets untouched" is only the weaker half of that,
		// which is why the name below states the whole guarantee.
		it.effect("writes nothing when a target fails its gate, before or after it", () =>
			Effect.gen(function* () {
				const written: Array<string> = [];
				// Rejects only the FIRST target, so the second would pass on
				// its own — it must still never be reached.
				const selective = SchemaValidator.layerTest({
					validate: (document) =>
						Effect.succeed(
							document.$id === "https://example.com/config.schema.json"
								? [ValidationFinding.make({ path: "", message: "boom" })]
								: [],
						),
				});
				const error = yield* Effect.flip(
					Effect.provide(SchemaPipeline.run([target, advisoryTarget]), layers(writable(written), selective)),
				);
				assert.instanceOf(error, SchemaGateError);
				assert.strictEqual(error.$id, "https://example.com/config.schema.json");
				assert.deepStrictEqual(written, [], "nothing is written when the first target fails");
			}),
		);

		it.effect("runOne answers a single result without indexing", () =>
			Effect.gen(function* () {
				const result = yield* Effect.provide(SchemaPipeline.runOne(target), layers(writable()));
				assert.strictEqual(result.outcome, "written");
				assert.strictEqual(result.$id, "https://example.com/config.schema.json");
			}),
		);
	});

	// Reported by the first pipeline adopter and confirmed by probe: the
	// Draft-07 lowering drops every keyword outside its copy-list, so a
	// document built from a Schema cannot carry an undeclared one by the
	// time DocumentLint sees it. UnknownKeyword is therefore unreachable
	// through the pipeline's only entry point, and the docs say so rather
	// than implying the lint gate is what stops a bad document here.
	describe("what the lint gate can actually see", () => {
		it.effect("a schema-derived document carries no undeclared keyword, so UnknownKeyword cannot fire", () =>
			Effect.gen(function* () {
				const annotated = SchemaTarget.make({
					schema: Schema.Struct({
						name: Schema.String.annotate({ "x-not-declared": { a: 1 } }),
					}).annotate({ "x-bogus-root": true, markdownDescription: "declared, survives" }),
					$id: "https://example.com/annotated.schema.json",
					path: "schemas/annotated.schema.json",
				});
				const results = yield* Effect.provide(SchemaPipeline.check([annotated]), layers(FileSystem.layerNoop({})));
				const findings = results[0]?.findings ?? [];
				assert.isEmpty(
					findings.filter((f) => f.check === "UnknownKeyword"),
					"the lowering dropped the undeclared keys before the lint ran",
				);
				assert.isFalse(results[0]?.blocked);

				// Prove the MECHANISM, not just the absence: an isEmpty
				// assertion would pass vacuously if the document never carried
				// the keys for some other reason. The declared family survives
				// the lowering via the carriers; the undeclared ones do not.
				const emitted = (yield* StoreDocument.fromSchema(annotated.schema, { $id: annotated.$id })).toJson();
				assert.property(emitted, "markdownDescription");
				assert.notProperty(emitted, "x-bogus-root");
				const name = (emitted.properties as Record<string, Record<string, unknown>>).name;
				assert.notProperty(name, "x-not-declared");
			}),
		);
	});

	describe("PipelineFinding", () => {
		it.effect("label falls back to the gate when the finding names no check", () =>
			Effect.gen(function* () {
				const unnamed = SchemaValidator.layerTest({
					validate: () => Effect.succeed([ValidationFinding.make({ path: "", message: "no keyword" })]),
				});
				const results = yield* Effect.provide(
					SchemaPipeline.check([target]),
					layers(FileSystem.layerNoop({}), unnamed),
				);
				const finding = results[0]?.findings.find((f) => f.source === "validator");
				assert.strictEqual(finding?.label, "validator", "an engine finding with no keyword labels as its gate");
			}),
		);

		it.effect("label uses the check name when the gate named one", () =>
			Effect.gen(function* () {
				const keyworded = SchemaValidator.layerTest({
					validate: () => Effect.succeed([ValidationFinding.make({ path: "/type", message: "bad", keyword: "type" })]),
				});
				const results = yield* Effect.provide(
					SchemaPipeline.check([target]),
					layers(FileSystem.layerNoop({}), keyworded),
				);
				const finding = results[0]?.findings.find((f) => f.source === "validator");
				assert.strictEqual(finding?.label, "type");
			}),
		);
	});

	// #556 — a published document's URL is pinned by consumers, so `run`
	// refuses to change its validation contract in place. The policy reads
	// the SAME `SchemaVersioning.isPinned` the version bump reads, so the
	// gate and the remedy can never disagree.
	describe("the contract-change gate", () => {
		it.effect("refuses a pinned versioned target whose contract changed, writing nothing", () =>
			Effect.gen(function* () {
				const predecessor = emitted(Wider, PINNED_ID);
				const { error, text } = yield* Effect.provide(
					Effect.gen(function* () {
						const failure = yield* Effect.flip(SchemaPipeline.run([pinnedTarget]));
						const volume = yield* MemoryFileSystem.Volume;
						return { error: failure, text: volume.text(PINNED_PATH) };
					}),
					memLayers({ [PINNED_PATH]: predecessor }),
				);
				assert.instanceOf(error, SchemaContractChangeError);
				assert.strictEqual(error.targets.length, 1);
				assert.strictEqual(error.targets[0]?.$id, PINNED_ID);
				assert.strictEqual(error.targets[0]?.path, PINNED_PATH);
				assert.strictEqual(error.targets[0]?.version, "5.0.0");
				assert.strictEqual(error.targets[0]?.nextVersion, "6.0.0");
				assert.include(error.message, "5.0.0 → 6.0.0");
				assert.strictEqual(text, predecessor, "the published document is untouched");
			}),
		);

		// Total over the targets, not first-wins: two broken documents are
		// reported in one run so a repo fixes them in one pass.
		it.effect("reports EVERY blocked target in one error", () =>
			Effect.gen(function* () {
				const layers = memLayers({
					[PINNED_PATH]: emitted(Wider, PINNED_ID),
					[SECOND_PATH]: emitted(Wider, SECOND_ID),
				});
				const error = yield* Effect.flip(
					Effect.provide(SchemaPipeline.run([pinnedTarget, secondPinnedTarget]), layers),
				);
				assert.instanceOf(error, SchemaContractChangeError);
				assert.deepStrictEqual(
					error.targets.map((entry) => [entry.version, entry.nextVersion]),
					[
						["5.0.0", "6.0.0"],
						["1.2.3", "2.0.0"],
					],
				);
			}),
		);

		// All-or-nothing: the clean target would have been written under the
		// old one-pass loop, because it precedes the blocked one.
		it.effect("writes NOTHING when a later target is blocked", () =>
			Effect.gen(function* () {
				const { error, wroteClean } = yield* Effect.provide(
					Effect.gen(function* () {
						const failure = yield* Effect.flip(SchemaPipeline.run([cleanPinnedTarget, pinnedTarget]));
						const volume = yield* MemoryFileSystem.Volume;
						return { error: failure, wroteClean: volume.has(CLEAN_PATH) };
					}),
					memLayers({ [PINNED_PATH]: emitted(Wider, PINNED_ID) }),
				);
				assert.instanceOf(error, SchemaContractChangeError);
				assert.isFalse(wroteClean, "the clean target that precedes the blocked one is not written");
			}),
		);

		// The shape every consumer of this package had before the gate:
		// no version, so the document replaces its predecessor in place.
		it.effect("an unversioned target is rewritten in place", () =>
			Effect.gen(function* () {
				const layers = memLayers({ [UNVERSIONED_PATH]: emitted(Wider, UNVERSIONED_ID) });
				const results = yield* Effect.provide(SchemaPipeline.run([unversionedTarget]), layers);
				assert.strictEqual(results[0]?.outcome, "written");
				assert.strictEqual(results[0]?.change, "contract");
			}),
		);

		// SemVer §9: a prerelease declares its own instability, so nobody's
		// pin is broken by changing it.
		it.effect("a PRERELEASE versioned target is rewritten in place", () =>
			Effect.gen(function* () {
				const layers = memLayers({ [PRERELEASE_PATH]: emitted(Wider, PRERELEASE_ID) });
				const results = yield* Effect.provide(SchemaPipeline.run([prereleaseTarget]), layers);
				assert.strictEqual(results[0]?.outcome, "written");
				assert.strictEqual(results[0]?.change, "contract");
			}),
		);

		it.effect('contractChanges: "allow" writes the pinned contract change', () =>
			Effect.gen(function* () {
				const layers = memLayers({ [PINNED_PATH]: emitted(Wider, PINNED_ID) });
				const results = yield* Effect.provide(SchemaPipeline.run([pinnedTarget], { contractChanges: "allow" }), layers);
				assert.strictEqual(results[0]?.outcome, "written");
				assert.strictEqual(results[0]?.change, "contract");
			}),
		);

		// `SchemaFile` classifies unparseable text as "contract" so a
		// corrupted generated file stays regenerable — which the default
		// policy then refuses. `"allow"` is the sanctioned repair path.
		it.effect('a corrupted published file is refused by default and repaired under "allow"', () =>
			Effect.gen(function* () {
				const corrupt = "{ this is not json";
				const refused = yield* Effect.provide(
					Effect.gen(function* () {
						const failure = yield* Effect.flip(SchemaPipeline.run([pinnedTarget]));
						const volume = yield* MemoryFileSystem.Volume;
						return { error: failure, text: volume.text(PINNED_PATH) };
					}),
					memLayers({ [PINNED_PATH]: corrupt }),
				);
				assert.instanceOf(refused.error, SchemaContractChangeError);
				assert.strictEqual(refused.text, corrupt, "the corrupted file is left as it was");

				const repaired = yield* Effect.provide(
					Effect.gen(function* () {
						const results = yield* SchemaPipeline.run([pinnedTarget], { contractChanges: "allow" });
						const volume = yield* MemoryFileSystem.Volume;
						return { results, text: volume.text(PINNED_PATH) };
					}),
					memLayers({ [PINNED_PATH]: corrupt }),
				);
				assert.strictEqual(repaired.results[0]?.outcome, "written");
				assert.strictEqual(repaired.results[0]?.change, "contract");
				assert.strictEqual(repaired.text, emitted(Config, PINNED_ID), "the file is regenerated, not left broken");
			}),
		);

		// Gate precedence: a document the engine rejects would never be
		// written under any contract policy, so its classification is noise.
		it.effect("a gate failure takes precedence over a contract change", () =>
			Effect.gen(function* () {
				const rejecting = SchemaValidator.layerTest({
					validate: () => Effect.succeed([ValidationFinding.make({ path: "", message: "rejected" })]),
				});
				const layers = memLayers({ [PINNED_PATH]: emitted(Wider, PINNED_ID) }, rejecting);
				const error = yield* Effect.flip(Effect.provide(SchemaPipeline.run([pinnedTarget]), layers));
				assert.instanceOf(error, SchemaGateError);
			}),
		);

		// Fails on the one-pass loop: the first target was written before the
		// second one's gate ran.
		it.effect("a gate failure on the SECOND target leaves the first unwritten", () =>
			Effect.gen(function* () {
				const selective = SchemaValidator.layerTest({
					validate: (document) =>
						Effect.succeed(document.$id === PINNED_ID ? [ValidationFinding.make({ path: "", message: "boom" })] : []),
				});
				const { error, wroteClean } = yield* Effect.provide(
					Effect.gen(function* () {
						const failure = yield* Effect.flip(SchemaPipeline.run([cleanPinnedTarget, pinnedTarget]));
						const volume = yield* MemoryFileSystem.Volume;
						return { error: failure, wroteClean: volume.has(CLEAN_PATH) };
					}),
					memLayers({}, selective),
				);
				assert.instanceOf(error, SchemaGateError);
				assert.strictEqual(error.$id, PINNED_ID);
				assert.isFalse(wroteClean, "the earlier target must not have been written");
			}),
		);

		it.effect("an annotation-only change on a pinned target is written in place", () =>
			Effect.gen(function* () {
				const before = emitted(Config.annotate({ description: "Before\nhttps://example.com/docs" }), ANNOTATED_ID);
				const layers = memLayers({ [ANNOTATED_PATH]: before });
				const results = yield* Effect.provide(SchemaPipeline.run([annotatedTarget]), layers);
				assert.strictEqual(results[0]?.change, "annotations");
				assert.strictEqual(results[0]?.outcome, "written");
			}),
		);

		it.effect("runOne fails the contract error on a pinned target", () =>
			Effect.gen(function* () {
				const layers = memLayers({ [PINNED_PATH]: emitted(Wider, PINNED_ID) });
				const error = yield* Effect.flip(Effect.provide(SchemaPipeline.runOne(pinnedTarget), layers));
				assert.instanceOf(error, SchemaContractChangeError);
				assert.strictEqual(error.targets[0]?.nextVersion, "6.0.0");
			}),
		);

		// The two policies are independent axes: an advisory finding does not
		// block under `blocking`, and the contract gate refuses anyway.
		it.effect("blocking and contractChanges are independent", () =>
			Effect.gen(function* () {
				const advisoryPinned = SchemaTarget.make({
					schema: Config.annotate({ description: "no docs url here" }),
					$id: PINNED_ID,
					name: "pinned",
					path: PINNED_PATH,
					version: version("5.0.0"),
				});
				const layers = memLayers({ [PINNED_PATH]: emitted(Wider, PINNED_ID) });
				const error = yield* Effect.flip(Effect.provide(SchemaPipeline.run([advisoryPinned]), layers));
				assert.instanceOf(error, SchemaContractChangeError, "the advisory does not block, but the contract does");
			}),
		);

		// The two phases must not re-run generation or the gates: a
		// build-once pin, wrapped in `Effect.suspend` so the recorder runs
		// per execution rather than per construction.
		it.effect("each target is validated exactly once across both phases", () =>
			Effect.gen(function* () {
				const seen: Array<string> = [];
				const counting = SchemaValidator.layerTest({
					validate: (document) =>
						Effect.suspend(() => {
							seen.push(String(document.$id));
							return Effect.succeed([]);
						}),
				});
				const layers = memLayers({}, counting);
				const results = yield* Effect.provide(SchemaPipeline.run([pinnedTarget, cleanPinnedTarget]), layers);
				assert.strictEqual(results.length, 2);
				assert.deepStrictEqual(seen, [PINNED_ID, CLEAN_ID], "one validate call per target, not one per phase");
			}),
		);

		describe("check reports the policy instead of enforcing it", () => {
			it.effect("contractBlocked is true only for a pinned versioned contract change", () =>
				Effect.gen(function* () {
					const layers = memLayers({
						[PINNED_PATH]: emitted(Wider, PINNED_ID),
						[UNVERSIONED_PATH]: emitted(Wider, UNVERSIONED_ID),
						[PRERELEASE_PATH]: emitted(Wider, PRERELEASE_ID),
					});
					const results = yield* Effect.provide(
						SchemaPipeline.check([pinnedTarget, unversionedTarget, prereleaseTarget]),
						layers,
					);
					assert.strictEqual(results.length, 3, "check reports every target and never fails on policy");
					assert.deepStrictEqual(
						results.map((result) => result.contractBlocked),
						[true, false, false],
					);
					assert.deepStrictEqual(
						results.map((result) => result.change),
						["contract", "contract", "contract"],
					);
					assert.deepStrictEqual(
						results.map((result) => result.blocked),
						[false, false, false],
						"the contract policy does not move `blocked`, which answers the findings question",
					);
				}),
			);

			it.effect('contractBlocked is false under contractChanges: "allow"', () =>
				Effect.gen(function* () {
					const layers = memLayers({ [PINNED_PATH]: emitted(Wider, PINNED_ID) });
					const results = yield* Effect.provide(
						SchemaPipeline.check([pinnedTarget], { contractChanges: "allow" }),
						layers,
					);
					assert.isFalse(results[0]?.contractBlocked);
					assert.strictEqual(results[0]?.change, "contract", "the classification is unchanged by the policy");
				}),
			);

			it.effect("checkOne carries contractBlocked", () =>
				Effect.gen(function* () {
					const layers = memLayers({ [PINNED_PATH]: emitted(Wider, PINNED_ID) });
					const result = yield* Effect.provide(SchemaPipeline.checkOne(pinnedTarget), layers);
					assert.isTrue(result.contractBlocked);
				}),
			);
		});
	});

	describe("check", () => {
		it.effect("reports drift without writing anything", () =>
			Effect.gen(function* () {
				const fs = FileSystem.layerNoop({
					makeDirectory: () => Effect.die(new Error("check must never write")),
					writeFileString: () => Effect.die(new Error("check must never write")),
				});
				const results = yield* Effect.provide(SchemaPipeline.check([target]), layers(fs));
				assert.strictEqual(results.length, 1);
				assert.isTrue(results[0]?.wouldWrite, "a missing file would be written");
				assert.strictEqual(results[0]?.change, "created");
				assert.isFalse(results[0]?.blocked);
			}),
		);

		// check REPORTS rather than enforcing: a blocked target is not
		// mistaken for clean drift, but it also does not stop the walk.
		it.effect("marks a gate-failing target blocked instead of failing", () =>
			Effect.gen(function* () {
				const rejecting = SchemaValidator.layerTest({
					validate: () => Effect.succeed([ValidationFinding.make({ path: "", message: "rejected" })]),
				});
				const results = yield* Effect.provide(
					SchemaPipeline.check([target]),
					layers(FileSystem.layerNoop({}), rejecting),
				);
				assert.strictEqual(results.length, 1);
				assert.isTrue(results[0]?.blocked, "a blocked target must not read as clean drift");
			}),
		);

		// The reason check is total where run is fail-fast: a repo with
		// several broken documents learns all of them in one run.
		it.effect("reports EVERY target even when an earlier one is blocked", () =>
			Effect.gen(function* () {
				const selective = SchemaValidator.layerTest({
					validate: (document) =>
						Effect.succeed(
							document.$id === "https://example.com/config.schema.json"
								? [ValidationFinding.make({ path: "", message: "boom" })]
								: [],
						),
				});
				const results = yield* Effect.provide(
					SchemaPipeline.check([target, advisoryTarget]),
					layers(FileSystem.layerNoop({}), selective),
				);
				assert.strictEqual(results.length, 2, "the walk continues past a blocked target");
				assert.isTrue(results[0]?.blocked);
				assert.isFalse(results[1]?.blocked);
			}),
		);

		it.effect("checkOne answers a single result without indexing", () =>
			Effect.gen(function* () {
				const result = yield* Effect.provide(SchemaPipeline.checkOne(target), layers(FileSystem.layerNoop({})));
				assert.strictEqual(result.$id, "https://example.com/config.schema.json");
				assert.isTrue(result.wouldWrite);
				assert.isFalse(result.blocked);
			}),
		);
	});
});
