import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import {
	SchemaFile,
	SchemaGateError,
	SchemaPipeline,
	SchemaTarget,
	SchemaValidator,
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

		it.effect("stops at the first failing target, leaving later targets untouched", () =>
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
