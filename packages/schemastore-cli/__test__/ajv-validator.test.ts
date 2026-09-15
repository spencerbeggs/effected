import { assert, describe, it } from "@effect/vitest";
import { SchemaValidator, StoreDocument } from "@effected/schemastore";
import { Effect, Schema } from "effect";
import { AjvValidator } from "../src/AjvValidator.js";

// The real engine lives here, not in the library: the library owns the
// SchemaValidator contract and its doubles, the CLI owns the one shipped
// implementation and the ajv dependency behind it.

describe("AjvValidator.layer — the shipped ajv engine", () => {
	const validate = (document: Record<string, unknown>, options?: { strict?: boolean }) =>
		Effect.runSync(
			Effect.provide(
				Effect.gen(function* () {
					const validator = yield* SchemaValidator;
					return yield* validator.validate(document, options);
				}),
				AjvValidator.layer,
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

	// The #657 regression: the standard ajv-formats vocabulary is
	// registered, so a published document can say "this string is an
	// ISO-8601 instant" with `format` instead of falling back to a
	// `pattern` plus a runtime filter that loses the annotation.
	it("accepts standard formats (date-time, uri, email, uuid) under strict mode", () => {
		assert.deepStrictEqual(
			validate({
				$schema: "http://json-schema.org/draft-07/schema#",
				$id: "https://example.com/formats.schema.json",
				type: "object",
				properties: {
					generatedAt: { type: "string", format: "date-time" },
					homepage: { type: "string", format: "uri" },
					contact: { type: "string", format: "email" },
					id: { type: "string", format: "uuid" },
				},
			}),
			[],
		);
	});

	// The control for the above: registering the standard vocabulary must
	// not silently accept arbitrary format strings — an UNKNOWN format is
	// still a strict-mode rejection (a root-pathed finding, like every
	// other compile throw).
	it("reports an unknown format string as a strict-mode finding", () => {
		const findings = validate({
			$schema: "http://json-schema.org/draft-07/schema#",
			$id: "https://example.com/bad-format.schema.json",
			type: "object",
			properties: {
				when: { type: "string", format: "nonsense-format" },
			},
		});
		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0]?.path, "");
		assert.include(findings[0]?.message ?? "", "nonsense-format");
	});

	// The plugin's default also registers the `formatMaximum` /
	// `formatMinimum` (and exclusive) keywords; DocumentLint answers those
	// as unknown keywords, so the engine gate must keep rejecting them —
	// one predicate governs both verdicts.
	it("still rejects the ajv-formats limit keywords (formatMaximum & co.)", () => {
		for (const keyword of ["formatMaximum", "formatMinimum", "formatExclusiveMaximum", "formatExclusiveMinimum"]) {
			const findings = validate({
				$schema: "http://json-schema.org/draft-07/schema#",
				$id: `https://example.com/${keyword}.schema.json`,
				type: "object",
				properties: {
					when: { type: "string", format: "date", [keyword]: "2026-01-01" },
				},
			});
			assert.strictEqual(findings.length, 1, `${keyword} should be rejected`);
			assert.strictEqual(findings[0]?.path, "");
			assert.include(findings[0]?.message ?? "", keyword);
		}
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

// End to end through StoreDocument.fromSchema — the x-ai- family reaches the
// emitted document like any other declared family, and the real engine
// accepts it under strict mode (the library's machine-annotations suite
// covers the emit and lint halves without an engine).
describe("the x-ai- machine-annotation family against the real engine", () => {
	const $id = "https://example.com/x-ai.schema.json";
	const Annotated = Schema.Struct({
		name: Schema.String.annotate({ "x-ai-hint": "the display name" }),
	}).annotate({ "x-ai": true });

	it.effect("the real ajv validator reports no findings for the adopted family", () =>
		Effect.gen(function* () {
			const document = yield* StoreDocument.fromSchema(Annotated, { $id });
			const findings = yield* Effect.provide(
				Effect.gen(function* () {
					const validator = yield* SchemaValidator;
					return yield* validator.validate(document.toJson());
				}),
				AjvValidator.layer,
			);
			assert.deepStrictEqual(findings, []);
		}),
	);
});
