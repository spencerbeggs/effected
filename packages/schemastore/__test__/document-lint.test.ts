import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import type { DocumentLintFinding } from "../src/index.js";
import { DocumentLint, StoreDocument } from "../src/index.js";

const document = (root: Record<string, unknown>, defs: Record<string, unknown> = {}): StoreDocument =>
	StoreDocument.make({
		$schema: "http://json-schema.org/draft-07/schema#",
		$id: "https://example.com/x.schema.json",
		root,
		defs,
	});

const checks = (findings: ReadonlyArray<DocumentLintFinding>): ReadonlyArray<string> =>
	findings.map((finding) => finding.check);

describe("DocumentLint", () => {
	describe("UnresolvedRef", () => {
		it("fires when a $ref names a missing definition", () => {
			const findings = DocumentLint.lint(
				document({ type: "object", properties: { a: { $ref: "#/$defs/Missing" } } }, { Present: { type: "string" } }),
			);
			assert.deepStrictEqual(checks(findings), ["UnresolvedRef"]);
			assert.strictEqual(findings[0]?.path, "/properties/a/$ref");
		});

		it("fires on a surviving #/definitions pointer", () => {
			const findings = DocumentLint.lint(
				document({ properties: { a: { $ref: "#/definitions/Thing" } } }, { Thing: { type: "string" } }),
			);
			assert.deepStrictEqual(checks(findings), ["UnresolvedRef"]);
		});

		it("passes clean on resolvable refs, subpath refs and # self-refs", () => {
			const findings = DocumentLint.lint(
				document(
					{
						properties: {
							a: { $ref: "#/$defs/Thing" },
							b: { $ref: "#/$defs/Thing/properties/inner" },
							self: { $ref: "#" },
						},
					},
					{ Thing: { type: "object", properties: { inner: { type: "string" } } } },
				),
			);
			assert.deepStrictEqual(findings, []);
		});

		it("checks refs inside the $defs pool too", () => {
			const findings = DocumentLint.lint(document({ type: "object" }, { A: { $ref: "#/$defs/Nope" } }));
			assert.deepStrictEqual(checks(findings), ["UnresolvedRef"]);
			assert.strictEqual(findings[0]?.path, "/$defs/A/$ref");
		});
	});

	describe("UnknownKeyword", () => {
		it("fires on a keyword outside Draft-07 and the declared families", () => {
			const findings = DocumentLint.lint(document({ type: "object", unevaluatedProperties: false }));
			assert.deepStrictEqual(checks(findings), ["UnknownKeyword"]);
			assert.strictEqual(findings[0]?.path, "/unevaluatedProperties");
		});

		it("does NOT fire on a property NAMED like a keyword-lookalike (keyword-position awareness)", () => {
			const findings = DocumentLint.lint(
				document({
					type: "object",
					properties: { unevaluatedProperties: { type: "string" }, "x-custom-thing": { type: "number" } },
				}),
			);
			assert.deepStrictEqual(findings, []);
		});

		it("does not descend into data positions (enum, const, default, examples)", () => {
			const findings = DocumentLint.lint(
				document({
					type: "string",
					enum: [{ bogusKeyword: 1 }],
					const: { anotherBogus: 2 },
					default: { yetMore: 3 },
					examples: [{ andMore: 4 }],
				}),
			);
			assert.deepStrictEqual(findings, []);
		});

		it("allows every declared non-standard family", () => {
			const findings = DocumentLint.lint(
				document({
					type: "object",
					markdownDescription: "**doc**",
					allowTrailingCommas: true,
					defaultSnippets: [],
					enumDescriptions: [],
					markdownEnumDescriptions: [],
					"x-taplo": { hidden: true },
					"x-taplo-info": {},
					"x-tombi-toml-version": "1.0.0",
					"x-tombi-table-keys-order": "ascending",
					"x-intellij-language-injection": "SQL",
				}),
			);
			assert.deepStrictEqual(findings, []);
		});

		it("fires inside nested schema positions (items, oneOf, dependencies)", () => {
			const findings = DocumentLint.lint(
				document({
					type: "object",
					dependencies: { a: { bogus: 1 }, b: ["c"] },
					properties: { list: { type: "array", items: [{ oneOf: [{ nope: true }] }] } },
				}),
			);
			assert.deepStrictEqual([...checks(findings)].sort(), ["UnknownKeyword", "UnknownKeyword"]);
		});
	});

	describe("DescriptionWithoutUrl", () => {
		it("advises when the root description lacks a trailing docs URL", () => {
			const findings = DocumentLint.lint(document({ type: "object", description: "A config file" }));
			assert.deepStrictEqual(checks(findings), ["DescriptionWithoutUrl"]);
			assert.strictEqual(findings[0]?.severity, "advisory");
		});

		it("passes clean when the description ends with a URL line", () => {
			const findings = DocumentLint.lint(
				document({ type: "object", description: "A config file\nhttps://example.com/docs" }),
			);
			assert.deepStrictEqual(findings, []);
		});

		it("stays silent when there is no description at all", () => {
			assert.deepStrictEqual(DocumentLint.lint(document({ type: "object" })), []);
		});
	});

	describe("DepthExceeded", () => {
		it("degrades to a finding instead of overflowing the stack", () => {
			let node: Record<string, unknown> = { type: "string" };
			for (let index = 0; index < 300; index++) {
				node = { type: "object", properties: { inner: node } };
			}
			const findings = DocumentLint.lint(document(node));
			assert.isTrue(findings.some((finding) => finding.check === "DepthExceeded"));
		});
	});

	describe("end to end over a built document", () => {
		it.effect("a fromSchema document with a described root lints to only the advisory", () =>
			Effect.gen(function* () {
				class Item extends Schema.Class<Item>("Item")({ id: Schema.String }) {}
				const Manifest = Schema.Struct({
					items: Schema.Array(Item),
				}).annotate({ description: "A manifest\nhttps://example.com/manifest-docs" });
				const built = yield* StoreDocument.fromSchema(Manifest, {
					$id: "https://example.com/manifest.schema.json",
				});
				assert.deepStrictEqual(DocumentLint.lint(built), []);
			}),
		);
	});
});
