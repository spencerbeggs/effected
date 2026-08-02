import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { AnnotationCarriers, CarrierDepthExceededError, DocumentLint, StoreDocument } from "../src/index.js";

const $id = "https://example.com/annotated.schema.json";

const record = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

describe("AnnotationCarriers", () => {
	describe("through StoreDocument.fromSchema", () => {
		it.effect("carries a field-level annotation onto the built document's property node", () =>
			Effect.gen(function* () {
				const source = Schema.Struct({
					name: Schema.String.annotate({ "x-taplo": { hidden: true }, markdownDescription: "**name**" }),
				});
				const document = yield* StoreDocument.fromSchema(source, { $id });
				const name = record(record(document.root.properties).name);
				assert.deepStrictEqual(name["x-taplo"], { hidden: true });
				assert.strictEqual(name.markdownDescription, "**name**");
				assert.strictEqual(name.type, "string");
			}),
		);

		it.effect("carries a root-level annotation into the flat publication shape", () =>
			Effect.gen(function* () {
				const source = Schema.Struct({ a: Schema.String }).annotate({
					"x-tombi-table-keys-order": "ascending",
					allowTrailingCommas: true,
				});
				const document = yield* StoreDocument.fromSchema(source, { $id });
				const json = document.toJson();
				assert.strictEqual(json["x-tombi-table-keys-order"], "ascending");
				assert.strictEqual(json.allowTrailingCommas, true);
			}),
		);

		it.effect("carries annotations on hoisted schemas into the $defs pool entry", () =>
			Effect.gen(function* () {
				interface Node {
					readonly value: string;
					readonly children: ReadonlyArray<Node>;
				}
				const Node = Schema.Struct({
					value: Schema.String.annotate({ "x-intellij-html-description": "<b>v</b>" }),
					children: Schema.Array(Schema.suspend((): Schema.Schema<Node> => Node)),
				}).annotate({ identifier: "Node" });
				const document = yield* StoreDocument.fromSchema(Node, { $id });
				const value = record(record(record(document.defs.Node).properties).value);
				assert.strictEqual(value["x-intellij-html-description"], "<b>v</b>");
				// The pool's refs were still rewritten to #/$defs after the graft.
				assert.notInclude(JSON.stringify(document.toJson()), "#/definitions/");
			}),
		);

		it.effect("maps the tuple coordinate move: 2020-12 prefixItems[i] lands on Draft-07 items[i]", () =>
			Effect.gen(function* () {
				const source = Schema.Tuple([Schema.String.annotate({ "x-taplo": { hidden: true } }), Schema.Boolean]);
				const document = yield* StoreDocument.fromSchema(source, { $id });
				// The lowering rewrote prefixItems to the Draft-07 items array.
				assert.isUndefined(document.root.prefixItems);
				const items = document.root.items as ReadonlyArray<Record<string, unknown>>;
				assert.deepStrictEqual(items[0]?.["x-taplo"], { hidden: true });
				assert.strictEqual(items[0]?.type, "string");
				assert.isUndefined(items[1]?.["x-taplo"]);
			}),
		);

		it.effect("follows a check-carrying schema's annotation into its allOf position", () =>
			Effect.gen(function* () {
				const source = Schema.Struct({
					name: Schema.String.check(Schema.isMinLength(1)).annotate({ "x-taplo": { hidden: true } }),
				});
				const document = yield* StoreDocument.fromSchema(source, { $id });
				const name = record(record(document.root.properties).name);
				const allOf = name.allOf as ReadonlyArray<Record<string, unknown>>;
				assert.deepStrictEqual(allOf[0]?.["x-taplo"], { hidden: true });
				assert.strictEqual(allOf[0]?.minLength, 1);
			}),
		);

		it.effect("does not carry keys outside the declared families, even when the caller admits them", () =>
			Effect.gen(function* () {
				const source = Schema.Struct({ a: Schema.String.annotate({ "x-custom": 1 }) });
				const document = yield* StoreDocument.fromSchema(source, {
					$id,
					jsonSchema: { includeAnnotationKey: (key) => key === "x-custom" },
				});
				const a = record(record(document.root.properties).a);
				assert.isUndefined(a["x-custom"]);
				assert.strictEqual(a.type, "string");
			}),
		);

		it.effect("admits the declared families even when the caller's includeAnnotationKey rejects everything", () =>
			Effect.gen(function* () {
				const source = Schema.Struct({ a: Schema.String.annotate({ "x-taplo": { hidden: true } }) });
				const document = yield* StoreDocument.fromSchema(source, {
					$id,
					jsonSchema: { includeAnnotationKey: () => false },
				});
				assert.deepStrictEqual(record(record(document.root.properties).a)["x-taplo"], { hidden: true });
			}),
		);

		it.effect("a carried document passes DocumentLint's UnknownKeyword check — one shared registry", () =>
			Effect.gen(function* () {
				const source = Schema.Struct({
					name: Schema.String.annotate({ "x-taplo": { hidden: true }, markdownDescription: "**name**" }),
				}).annotate({ "x-tombi-table-keys-order": "ascending" });
				const document = yield* StoreDocument.fromSchema(source, { $id });
				const findings = DocumentLint.lint(document);
				assert.deepStrictEqual(
					findings.filter((finding) => finding.check === "UnknownKeyword"),
					[],
				);
			}),
		);
	});

	describe("carryResult", () => {
		it("grafts declared keys onto the parallel node and leaves the rest of the target alone", () => {
			const source = {
				type: "object",
				properties: { a: { type: "string", "x-taplo": { hidden: true }, "not-declared": 1 } },
			};
			const target = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
			const result = AnnotationCarriers.carryResult(source, target);
			assert.isTrue(Result.isSuccess(result));
			const grafted = record(Result.getOrThrow(result));
			assert.deepStrictEqual(grafted, {
				type: "object",
				properties: { a: { type: "string", "x-taplo": { hidden: true } } },
				required: ["a"],
			});
			// Pure: the input target was not mutated.
			assert.deepStrictEqual(target.properties.a, { type: "string" });
		});

		it("adds nothing when the target lacks the parallel position", () => {
			const source = { properties: { a: { "x-taplo": 1 } }, allOf: [{ "x-taplo": 2 }] };
			const target = { type: "object" };
			const result = AnnotationCarriers.carryResult(source, target);
			assert.deepStrictEqual(record(Result.getOrThrow(result)), { type: "object" });
		});

		it("grafts the non-array prefixItems form onto the single items schema", () => {
			const source = { prefixItems: { "x-taplo": { hidden: true } } };
			const target = { items: { type: "string" } };
			const result = AnnotationCarriers.carryResult(source, target);
			assert.deepStrictEqual(record(Result.getOrThrow(result)).items, {
				type: "string",
				"x-taplo": { hidden: true },
			});
		});

		it("grafts a trailing tuple items schema onto Draft-07 additionalItems", () => {
			const source = {
				prefixItems: [{ type: "string" }],
				items: { type: "boolean", "x-taplo": { hidden: true } },
			};
			const target = { items: [{ type: "string" }], additionalItems: { type: "boolean" } };
			const result = AnnotationCarriers.carryResult(source, target);
			assert.deepStrictEqual(record(Result.getOrThrow(result)).additionalItems, {
				type: "boolean",
				"x-taplo": { hidden: true },
			});
		});

		it("fails typed when the walk nests past the hardening cap", () => {
			let source: Record<string, unknown> = { "x-taplo": 1 };
			let target: Record<string, unknown> = { type: "string" };
			for (let i = 0; i < 300; i++) {
				source = { properties: { a: source } };
				target = { properties: { a: target } };
			}
			const result = AnnotationCarriers.carryResult(source, target);
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.instanceOf(result.failure, CarrierDepthExceededError);
				assert.strictEqual(result.failure.maxDepth, 256);
			}
		});

		it.effect("the Effect form is the same walk behind a span", () =>
			Effect.gen(function* () {
				const grafted = yield* AnnotationCarriers.carry({ "x-taplo": 1 }, { type: "string" });
				assert.deepStrictEqual(record(grafted), { type: "string", "x-taplo": 1 });
			}),
		);
	});
});
