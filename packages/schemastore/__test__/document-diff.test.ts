import { assert, describe, it } from "@effect/vitest";
import { DocumentDiff } from "../src/index.js";

const base = {
	$schema: "http://json-schema.org/draft-07/schema#",
	$id: "https://example.com/x.schema.json",
	type: "object",
	properties: {
		name: { type: "string", description: "The name" },
	},
	required: ["name"],
};

describe("DocumentDiff", () => {
	describe("classify", () => {
		it("answers none for structurally identical documents", () => {
			assert.strictEqual(DocumentDiff.classify(base, structuredClone(base)), "none");
		});

		it("answers none when only object key ORDER differs — a formatter may sort keys", () => {
			const reordered = {
				required: ["name"],
				properties: { name: { description: "The name", type: "string" } },
				type: "object",
				$id: "https://example.com/x.schema.json",
				$schema: "http://json-schema.org/draft-07/schema#",
			};
			assert.strictEqual(DocumentDiff.classify(base, reordered), "none");
		});

		it("answers contract when ARRAY order differs — element order is data, not formatting", () => {
			const a = { type: "object", required: ["a", "b"] };
			const b = { type: "object", required: ["b", "a"] };
			assert.strictEqual(DocumentDiff.classify(a, b), "contract");
		});

		it("answers annotations when only a description's wording changed", () => {
			const reworded = structuredClone(base);
			reworded.properties.name.description = "The package name, as published";
			assert.strictEqual(DocumentDiff.classify(base, reworded), "annotations");
		});

		it("answers annotations for title and $comment", () => {
			assert.strictEqual(
				DocumentDiff.classify({ type: "string", title: "A" }, { type: "string", title: "B" }),
				"annotations",
			);
			assert.strictEqual(
				DocumentDiff.classify({ type: "string", $comment: "A" }, { type: "string", $comment: "B" }),
				"annotations",
			);
		});

		it("answers annotations for a declared non-standard family keyword", () => {
			// KeywordFamilies owns this set; the diff must not carry its own copy.
			const a = { type: "string", markdownDescription: "**A**", "x-taplo": { hidden: true } };
			const b = { type: "string", markdownDescription: "**B**", "x-taplo": { hidden: true } };
			assert.strictEqual(DocumentDiff.classify(a, b), "annotations");
		});

		it("answers annotations when an annotation keyword is added or removed outright", () => {
			const withDescription = { type: "string", description: "A" };
			assert.strictEqual(DocumentDiff.classify({ type: "string" }, withDescription), "annotations");
			assert.strictEqual(DocumentDiff.classify(withDescription, { type: "string" }), "annotations");
		});

		// The keyword-position mutant: `description` as a PROPERTY NAME is data.
		it("answers contract when a property NAMED description changes — position awareness", () => {
			const a = { type: "object", properties: { description: { type: "string" } } };
			const b = { type: "object", properties: { description: { type: "number" } } };
			assert.strictEqual(DocumentDiff.classify(a, b), "contract");
		});

		it("answers contract when a property is added or removed", () => {
			const extra = structuredClone(base) as Record<string, unknown> & { properties: Record<string, unknown> };
			extra.properties.version = { type: "string" };
			assert.strictEqual(DocumentDiff.classify(base, extra), "contract");
			assert.strictEqual(DocumentDiff.classify(extra, base), "contract");
		});

		it("answers contract when an assertion keyword changes", () => {
			const loosened = structuredClone(base);
			loosened.required = [];
			assert.strictEqual(DocumentDiff.classify(base, loosened), "contract");
		});

		it("answers contract for default and examples — annotations in the spec, but consumers act on them", () => {
			assert.strictEqual(
				DocumentDiff.classify({ type: "string", default: "a" }, { type: "string", default: "b" }),
				"contract",
			);
			assert.strictEqual(
				DocumentDiff.classify({ type: "string", examples: ["a"] }, { type: "string", examples: ["b"] }),
				"contract",
			);
		});

		it("contract dominates annotations when both changed", () => {
			const both = structuredClone(base);
			both.properties.name.description = "reworded";
			both.required = [];
			assert.strictEqual(DocumentDiff.classify(base, both), "contract");
		});

		it("descends composition keywords and $defs", () => {
			const a = { allOf: [{ type: "string", description: "A" }], $defs: { X: { type: "string" } } };
			const annotated = { allOf: [{ type: "string", description: "B" }], $defs: { X: { type: "string" } } };
			const contract = { allOf: [{ type: "string", description: "A" }], $defs: { X: { type: "number" } } };
			assert.strictEqual(DocumentDiff.classify(a, annotated), "annotations");
			assert.strictEqual(DocumentDiff.classify(a, contract), "contract");
		});

		it("descends the tuple form of items, and a length change is a contract change", () => {
			const a = { type: "array", items: [{ type: "string", description: "A" }] };
			const b = { type: "array", items: [{ type: "string", description: "B" }] };
			const longer = { type: "array", items: [{ type: "string", description: "A" }, { type: "number" }] };
			assert.strictEqual(DocumentDiff.classify(a, b), "annotations");
			assert.strictEqual(DocumentDiff.classify(a, longer), "contract");
		});

		it("treats the array form of dependencies as data and the schema form as a schema", () => {
			const arrayForm = { dependencies: { a: ["b"] } };
			assert.strictEqual(DocumentDiff.classify(arrayForm, { dependencies: { a: ["c"] } }), "contract");
			assert.strictEqual(
				DocumentDiff.classify(
					{ dependencies: { a: { description: "A" } } },
					{ dependencies: { a: { description: "B" } } },
				),
				"annotations",
			);
		});

		it("handles Draft-07 boolean schemas as leaves", () => {
			assert.strictEqual(
				DocumentDiff.classify({ additionalProperties: false }, { additionalProperties: false }),
				"none",
			);
			assert.strictEqual(
				DocumentDiff.classify({ additionalProperties: false }, { additionalProperties: true }),
				"contract",
			);
		});

		it("stays total on hostile nesting, reporting the difference rather than throwing", () => {
			const deep = (depth: number, leaf: unknown): unknown => {
				let node: unknown = leaf;
				for (let index = 0; index < depth; index += 1) {
					node = { type: "object", properties: { nested: node } };
				}
				return node;
			};
			const a = deep(400, { type: "string" });
			const b = deep(400, { type: "number" });
			assert.strictEqual(DocumentDiff.classify(a, structuredClone(a) as unknown), "none");
			assert.strictEqual(DocumentDiff.classify(a, b), "contract");
		});
	});

	describe("isAnnotationKeyword", () => {
		it("covers the documentation keywords and the declared families, and nothing else", () => {
			for (const key of [
				"title",
				"description",
				"$comment",
				"markdownDescription",
				"x-taplo",
				"x-tombi-toml-version",
			]) {
				assert.isTrue(DocumentDiff.isAnnotationKeyword(key), key);
			}
			for (const key of ["type", "required", "default", "examples", "readOnly", "writeOnly", "properties"]) {
				assert.isFalse(DocumentDiff.isAnnotationKeyword(key), key);
			}
		});
	});
});
