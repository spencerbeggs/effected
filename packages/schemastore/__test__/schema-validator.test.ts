import { assert, describe, it, layer } from "@effect/vitest";
import { Cause, Effect, Exit, Layer } from "effect";
import { SchemaValidator, SchemaValidatorError, ValidationFinding } from "../src/index.js";

// A stub implementation proving the contract is implementable — the pattern a
// real consumer follows when closing the seam with ajv at the edge: a strict
// "compile failure" answers findings as values; a broken engine fails typed.
const stubEngine = Layer.succeed(SchemaValidator, {
	validate: (document, options) => {
		if (document.boom === true) {
			return Effect.fail(SchemaValidatorError.make({ cause: new Error("engine exploded") }));
		}
		if ((options?.strict ?? true) && typeof document.unknownKeyword !== "undefined") {
			return Effect.succeed([
				ValidationFinding.make({
					path: "/unknownKeyword",
					message: 'strict mode: unknown keyword: "unknownKeyword"',
					keyword: "unknownKeyword",
				}),
			]);
		}
		return Effect.succeed([]);
	},
});

describe("SchemaValidator", () => {
	// The shipped ajv layer — the seam is closed by default now, so these
	// pin the ENGINE's behavior, not an adapter's.
	describe("the shipped ajv layer", () => {
		const validate = (document: Record<string, unknown>, options?: { strict?: boolean }) =>
			Effect.runSync(
				Effect.provide(
					Effect.gen(function* () {
						const validator = yield* SchemaValidator;
						return yield* validator.validate(document, options);
					}),
					SchemaValidator.layer,
				),
			);

		it("answers a clean pass for a valid Draft-07 document", () => {
			assert.deepStrictEqual(
				validate({
					$schema: "http://json-schema.org/draft-07/schema#",
					$id: "https://example.com/x.schema.json",
					type: "object",
					properties: { name: { type: "string" } },
				}),
				[],
			);
		});

		// The wasted-structure complaint from the adoption: a real
		// implementation maps ajv's errors rather than collapsing them.
		it("keeps ajv's structured path and keyword on a meta-schema failure", () => {
			const findings = validate({ type: "nope" });
			assert.isAtLeast(findings.length, 1);
			// `allErrors: true` makes ajv report several failures for this
			// document (the `enum` and `anyOf` branches both at `/type`), and
			// their order is ajv's internal business — select the finding
			// rather than indexing position 0, so an ajv patch that reorders
			// them does not fail this test.
			const enumFinding = findings.find((finding) => finding.keyword === "enum");
			assert.isDefined(enumFinding, "ajv's structured keyword should survive into a finding");
			assert.strictEqual(enumFinding?.path, "/type");
			assert.isString(enumFinding?.message);
			// The point of the test: the structure is preserved rather than
			// collapsed into one root-pathed finding.
			assert.isTrue(findings.every((finding) => finding.path.length > 0));
		});

		it("reports a strict-mode rejection as a finding, not an error", () => {
			const findings = validate({ type: "object", nonsenseKeyword: true });
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0]?.path, "");
			assert.include(findings[0]?.message ?? "", "nonsenseKeyword");
		});

		it("strict: false accepts what strict mode rejects", () => {
			assert.deepStrictEqual(validate({ type: "object", nonsenseKeyword: true }, { strict: false }), []);
		});

		// The consistency invariant: ajv must not reject what DocumentLint
		// deliberately allows. One KeywordFamilies predicate governs both.
		it("accepts the declared language-server families under strict mode", () => {
			assert.deepStrictEqual(
				validate({
					$schema: "http://json-schema.org/draft-07/schema#",
					type: "object",
					markdownDescription: "**docs**",
					"x-taplo": { hidden: true },
					properties: {
						name: { type: "string", "x-intellij-html-description": "<b>name</b>", enumDescriptions: ["a"] },
					},
				}),
				[],
			);
		});

		it("validates documents sharing an $id across calls without collision", () => {
			const document = { $id: "https://example.com/same.schema.json", type: "object" };
			assert.deepStrictEqual(validate(document), []);
			assert.deepStrictEqual(validate(document), []);
		});

		// The ajv `$id` hazard: an `x-ai-hint` payload that happens to carry an
		// `$id` key is not a schema node, but ajv's reference collection walks
		// UNKNOWN keywords looking for `$id` anyway. A colliding `$id` fails the
		// compile — the effect still succeeds, and the collision surfaces as a
		// blocking, root-pathed finding rather than an engine error.
		it("reports a colliding $id nested inside an x-ai-hint payload as a finding, not an error", () => {
			const rootId = "https://example.com/x.schema.json";
			const findings = validate({
				$schema: "http://json-schema.org/draft-07/schema#",
				$id: rootId,
				type: "object",
				properties: {
					name: { type: "string", "x-ai-hint": { $id: rootId } },
				},
			});
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0]?.path, "");
			assert.include(findings[0]?.message ?? "", "already exists");
		});

		// The other ajv-registration hazard, and the one that used to escape:
		// ajv holds keyword names to `/^[a-z_$][a-z0-9_$:-]*$/i`, so a declared
		// `x-ai-*` key carrying a dot, a space, an `@` or any other character
		// outside that set makes `addKeyword` THROW. That throw is the engine
		// rejecting the DOCUMENT, not the engine failing as a mechanism, so it
		// belongs on the finding list beside every other strict-mode rejection
		// — an error would abort `SchemaPipeline.check`'s totality.
		it("reports a declared keyword ajv's name grammar rejects as a finding, not an error", () => {
			const findings = validate({
				$schema: "http://json-schema.org/draft-07/schema#",
				$id: "https://example.com/x.schema.json",
				type: "object",
				properties: {
					name: { type: "string", "x-ai-model.name": "gpt" },
				},
			});
			assert.strictEqual(findings.length, 1);
			assert.strictEqual(findings[0]?.path, "");
			assert.include(findings[0]?.message ?? "", "invalid name");
		});

		// The control: a colon IS in ajv's keyword grammar, so a namespaced
		// `x-ai-*` key is registered and the document passes clean. Without
		// it the test above would also pass against an engine that rejected
		// every `x-ai-*` key.
		it("accepts a declared keyword whose name ajv's grammar allows", () => {
			assert.deepStrictEqual(
				validate({
					$schema: "http://json-schema.org/draft-07/schema#",
					$id: "https://example.com/y.schema.json",
					type: "object",
					properties: {
						name: { type: "string", "x-ai-hint:v2": "a machine-readable hint" },
					},
				}),
				[],
			);
		});
	});

	layer(SchemaValidator.noop)((it) => {
		it.effect("the noop layer validates nothing and answers a clean pass", () =>
			Effect.gen(function* () {
				const validator = yield* SchemaValidator;
				const findings = yield* validator.validate({ definitely: "not a schema" });
				assert.deepStrictEqual(findings, []);
			}),
		);
	});

	layer(stubEngine)((it) => {
		it.effect("a stub implementation answers findings as values for a rejected document", () =>
			Effect.gen(function* () {
				const validator = yield* SchemaValidator;
				const findings = yield* validator.validate({ type: "object", unknownKeyword: 1 });
				assert.strictEqual(findings.length, 1);
				assert.strictEqual(findings[0]?.path, "/unknownKeyword");
				assert.strictEqual(findings[0]?.keyword, "unknownKeyword");
			}),
		);

		it.effect("an omitted strictness means strict; strict: false relaxes the stub's gate", () =>
			Effect.gen(function* () {
				const validator = yield* SchemaValidator;
				const relaxed = yield* validator.validate({ unknownKeyword: 1 }, { strict: false });
				assert.deepStrictEqual(relaxed, []);
				const clean = yield* validator.validate({ type: "object" });
				assert.deepStrictEqual(clean, []);
			}),
		);

		it.effect("a mechanism failure fails typed with SchemaValidatorError", () =>
			Effect.gen(function* () {
				const validator = yield* SchemaValidator;
				const error = yield* Effect.flip(validator.validate({ boom: true }));
				assert.instanceOf(error, SchemaValidatorError);
				assert.strictEqual(error._tag, "SchemaValidatorError");
				assert.strictEqual(error.message, "Schema validation engine failed");
			}),
		);
	});

	layer(SchemaValidator.layerTest())((it) => {
		it.effect("an unstubbed layerTest member dies naming the member", () =>
			Effect.gen(function* () {
				const validator = yield* SchemaValidator;
				const exit = yield* Effect.exit(validator.validate({}));
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					const defect = Cause.squash(exit.cause);
					assert.instanceOf(defect, Error);
					assert.include((defect as Error).message, "validate() was called but not stubbed");
				}
			}),
		);
	});

	layer(SchemaValidator.layerTest({ validate: () => Effect.succeed([]) }))((it) => {
		it.effect("a stubbed layerTest member answers instead of dying", () =>
			Effect.gen(function* () {
				const validator = yield* SchemaValidator;
				assert.deepStrictEqual(yield* validator.validate({}), []);
			}),
		);
	});
});
