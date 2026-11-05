import { assert, describe, it } from "@effect/vitest";
import { InstanceValidator, InstanceValidatorError } from "@effected/schemastore";
import { Effect } from "effect";
import { AjvInstanceValidator } from "../../src/schema/AjvInstanceValidator.js";

// The real engine lives here, not in the library: the library owns the
// InstanceValidator contract and its doubles, the CLI owns the one shipped
// implementation and the ajv dependency behind it.

describe("AjvInstanceValidator.layer — the shipped ajv instance engine", () => {
	const validate = (document: Record<string, unknown>, instance: unknown, options?: { strict?: boolean }) =>
		Effect.runSync(
			Effect.provide(
				Effect.gen(function* () {
					const validator = yield* InstanceValidator;
					return yield* validator.validate(document, instance, options);
				}),
				AjvInstanceValidator.layer,
			),
		);

	const document = {
		$schema: "http://json-schema.org/draft-07/schema#",
		$id: "https://example.com/output.schema.json",
		type: "object",
		properties: {
			name: { type: "string" },
			nested: {
				type: "object",
				properties: { count: { type: "integer" } },
				required: ["count"],
			},
		},
		required: ["name"],
		additionalProperties: false,
	} satisfies Record<string, unknown>;

	it("answers a clean pass for a conforming instance", () => {
		assert.deepStrictEqual(validate(document, { name: "x", nested: { count: 1 } }), []);
	});

	// The adoption's point: a real implementation maps ajv's errors rather
	// than collapsing them — the pointer addresses the INSTANCE, and every
	// problem is reported, not just the first (`allErrors`).
	it("keeps ajv's structured instancePath and keyword on a non-conforming instance", () => {
		const findings = validate(document, { nested: { count: "many" }, extra: true });
		// `allErrors: true`: missing `name`, wrong `count` type, excess `extra` —
		// select by pointer rather than position, so an ajv patch that
		// reorders them does not fail this test.
		const name = findings.find((finding) => finding.path === "" && finding.keyword === "required");
		assert.isDefined(name, "the missing required property should surface as a root finding");
		const count = findings.find((finding) => finding.path === "/nested/count");
		assert.isDefined(count, "ajv's instancePath should survive into the finding");
		assert.strictEqual(count?.keyword, "type");
		const extra = findings.find((finding) => finding.path === "" && finding.keyword === "additionalProperties");
		assert.isDefined(extra, "additionalProperties: false must be enforced against the instance");
		assert.strictEqual(findings.length, 3);
	});

	it("points at the instance root with an empty path for a wrong top-level type", () => {
		const findings = validate(document, "not an object");
		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0]?.path, "");
		assert.strictEqual(findings[0]?.keyword, "type");
	});

	// The consistency invariant with the document gate: a published document
	// carrying declared language-server families passes `check`, so the
	// instance engine must compile it too — one shared makeAjv governs both.
	it("validates against a document carrying declared keywords and formats", () => {
		assert.deepStrictEqual(
			validate(
				{
					$schema: "http://json-schema.org/draft-07/schema#",
					$id: "https://example.com/annotated.schema.json",
					type: "object",
					markdownDescription: "**docs**",
					properties: {
						generatedAt: { type: "string", format: "date-time" },
						name: { type: "string", "x-ai-hint": "the display name" },
					},
					required: ["generatedAt", "name"],
				},
				{ generatedAt: "2026-10-01T00:00:00Z", name: "x" },
			),
			[],
		);
	});

	it("enforces the format vocabulary against the instance", () => {
		const findings = validate(
			{
				$schema: "http://json-schema.org/draft-07/schema#",
				type: "object",
				properties: { generatedAt: { type: "string", format: "date-time" } },
				required: ["generatedAt"],
			},
			{ generatedAt: "yesterday" },
		);
		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0]?.path, "/generatedAt");
		assert.strictEqual(findings[0]?.keyword, "format");
	});

	// The subject split with AjvValidator: THERE a document the engine
	// refuses is a finding (the document is the subject); HERE it is a
	// mechanism failure — no verdict about the instance was produced.
	it("fails typed with InstanceValidatorError for a document the engine cannot compile", () => {
		const error = Effect.runSync(
			Effect.flip(
				Effect.provide(
					Effect.gen(function* () {
						const validator = yield* InstanceValidator;
						return yield* validator.validate({ type: "object", nonsenseKeyword: true }, {});
					}),
					AjvInstanceValidator.layer,
				),
			),
		);
		assert.instanceOf(
			error,
			InstanceValidatorError,
			"a strict-mode compile failure is an engine mechanism failure here",
		);
		assert.include(String(error.cause), "nonsenseKeyword");
	});

	it("strict: false accepts a document strict mode refuses", () => {
		assert.deepStrictEqual(validate({ type: "object", nonsenseKeyword: true }, {}, { strict: false }), []);
	});

	it("validates instances against documents sharing an $id across calls without collision", () => {
		const shared = { $id: "https://example.com/same.schema.json", type: "object" };
		assert.deepStrictEqual(validate(shared, {}), []);
		assert.deepStrictEqual(validate(shared, {}), []);
	});
});
