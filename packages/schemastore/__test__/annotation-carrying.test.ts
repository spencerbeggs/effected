import { assert, describe, it } from "@effect/vitest";
import { Effect, JsonSchema, Schema } from "effect";
import { DocumentLint, KeywordFamilies, StoreDocument, UndeclaredAnnotationKeyError } from "../src/index.js";

const $id = "https://example.com/annotated.schema.json";

const record = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

// The evidence half of these tests: what core's Draft-07 lowering does on
// its own, with no help from this package. Since rc.112 ("Make JSON Schema
// dialect conversions preserve custom keywords") the lowering copies unknown
// and custom keywords through as opaque values, which is why the package no
// longer re-grafts them after lowering.
const loweredNodes = (source: Schema.Constraint) => {
	const document = Schema.toJsonSchemaDocument(source, {
		includeAnnotationKey: (key) => KeywordFamilies.isDeclared(key),
	});
	return JsonSchema.toDocumentDraft07(document);
};

describe("annotation carrying", () => {
	describe("core's Draft-07 lowering preserves declared-family keys unaided", () => {
		it("keeps a field-level annotation on the property node", () => {
			const lowered = loweredNodes(Schema.Struct({ a: Schema.String.annotate({ "x-taplo": { hidden: true } }) }));
			const a = record(record(record(lowered.schema).properties).a);
			assert.deepStrictEqual(a["x-taplo"], { hidden: true });
		});

		it("keeps a root-level annotation on the root node", () => {
			const lowered = loweredNodes(
				Schema.Struct({ a: Schema.String }).annotate({ "x-tombi-table-keys-order": "ascending" }),
			);
			assert.strictEqual(record(lowered.schema)["x-tombi-table-keys-order"], "ascending");
		});

		it("keeps an annotation inside a $defs pool entry reached through suspend", () => {
			interface Node {
				readonly value: string;
				readonly children: ReadonlyArray<Node>;
			}
			const Node = Schema.Struct({
				value: Schema.String.annotate({ "x-intellij-html-description": "<b>v</b>" }),
				children: Schema.Array(Schema.suspend((): Schema.Schema<Node> => Node)),
			}).annotate({ identifier: "Node" });
			const lowered = loweredNodes(Node);
			const value = record(record(record(lowered.definitions.Node).properties).value);
			assert.strictEqual(value["x-intellij-html-description"], "<b>v</b>");
		});

		it("moves the annotation with the tuple coordinate move: prefixItems[i] -> items[i]", () => {
			const lowered = loweredNodes(
				Schema.Tuple([Schema.String.annotate({ "x-taplo": { hidden: true } }), Schema.Boolean]),
			);
			const schema = record(lowered.schema);
			assert.isUndefined(schema.prefixItems);
			const items = schema.items as ReadonlyArray<Record<string, unknown>>;
			assert.deepStrictEqual(items[0]?.["x-taplo"], { hidden: true });
			assert.isUndefined(items[1]?.["x-taplo"]);
		});

		it("moves the annotation with the rest-element move: trailing items -> additionalItems", () => {
			const lowered = loweredNodes(
				Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Boolean.annotate({ "x-taplo": { r: true } })]),
			);
			const schema = record(lowered.schema);
			assert.deepStrictEqual(record(schema.additionalItems)["x-taplo"], { r: true });
		});

		it("keeps an annotation that lands in an allOf position on a check-carrying schema", () => {
			const lowered = loweredNodes(
				Schema.Struct({ name: Schema.String.check(Schema.isMinLength(1)).annotate({ "x-taplo": { hidden: true } }) }),
			);
			const name = record(record(record(lowered.schema).properties).name);
			const allOf = name.allOf as ReadonlyArray<Record<string, unknown>>;
			assert.deepStrictEqual(allOf[0]?.["x-taplo"], { hidden: true });
			assert.strictEqual(allOf[0]?.minLength, 1);
		});
	});

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
				// The pool's refs were still rewritten to #/$defs.
				assert.notInclude(JSON.stringify(document.toJson()), "#/definitions/");
			}),
		);

		it.effect("maps the tuple coordinate move: 2020-12 prefixItems[i] lands on Draft-07 items[i]", () =>
			Effect.gen(function* () {
				const source = Schema.Tuple([Schema.String.annotate({ "x-taplo": { hidden: true } }), Schema.Boolean]);
				const document = yield* StoreDocument.fromSchema(source, { $id });
				assert.isUndefined(document.root.prefixItems);
				const items = document.root.items as ReadonlyArray<Record<string, unknown>>;
				assert.deepStrictEqual(items[0]?.["x-taplo"], { hidden: true });
				assert.strictEqual(items[0]?.type, "string");
				assert.isUndefined(items[1]?.["x-taplo"]);
			}),
		);

		it.effect("maps the rest-element move: a trailing items schema lands on additionalItems", () =>
			Effect.gen(function* () {
				const source = Schema.TupleWithRest(Schema.Tuple([Schema.String]), [
					Schema.Boolean.annotate({ "x-taplo": { r: true } }),
				]);
				const document = yield* StoreDocument.fromSchema(source, { $id });
				assert.deepStrictEqual(record(document.root.additionalItems)["x-taplo"], { r: true });
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

		it.effect("passes a declared-family payload through the $ref rewrite verbatim", () =>
			Effect.gen(function* () {
				// The payload is opaque advice to a language server, not a schema
				// position: a $ref-shaped string inside it must not be rewritten.
				const payload = { $ref: "#/definitions/Thing", nested: { $ref: "#/definitions/Other" } };
				const source = Schema.Struct({ a: Schema.String.annotate({ "x-ai-hint": payload }) });
				const document = yield* StoreDocument.fromSchema(source, { $id });
				const a = record(record(document.root.properties).a);
				assert.deepStrictEqual(a["x-ai-hint"], payload);
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

	describe("the undeclared-key gate", () => {
		it.effect("fails typed when the caller's includeAnnotationKey admits an undeclared key", () =>
			Effect.gen(function* () {
				const source = Schema.Struct({ a: Schema.String.annotate({ "x-custom": 1 }) });
				const error = yield* Effect.flip(
					StoreDocument.fromSchema(source, {
						$id,
						jsonSchema: { includeAnnotationKey: (key) => key === "x-custom" },
					}),
				);
				assert.instanceOf(error, UndeclaredAnnotationKeyError);
				assert.deepStrictEqual([...error.keys], ["x-custom"]);
				assert.strictEqual(error.$id, $id);
				assert.include(error.message, '"x-custom"');
			}),
		);

		it.effect("names every offending key once, sorted, rather than only the first", () =>
			Effect.gen(function* () {
				const source = Schema.Struct({
					a: Schema.String.annotate({ zeta: 1, "x-custom": 2 }),
					b: Schema.String.annotate({ "x-custom": 3 }),
				});
				const error = yield* Effect.flip(
					StoreDocument.fromSchema(source, { $id, jsonSchema: { includeAnnotationKey: () => true } }),
				);
				assert.instanceOf(error, UndeclaredAnnotationKeyError);
				assert.deepStrictEqual([...error.keys], ["x-custom", "zeta"]);
			}),
		);

		it.effect("stays silent when the caller admits a key the schema never annotates", () =>
			Effect.gen(function* () {
				const source = Schema.Struct({ a: Schema.String });
				const document = yield* StoreDocument.fromSchema(source, {
					$id,
					jsonSchema: { includeAnnotationKey: (key) => key === "x-custom" },
				});
				assert.strictEqual(record(record(document.root.properties).a).type, "string");
			}),
		);

		it.effect("does not fire for a declared family the caller also admits", () =>
			Effect.gen(function* () {
				const source = Schema.Struct({ a: Schema.String.annotate({ "x-taplo": { hidden: true } }) });
				const document = yield* StoreDocument.fromSchema(source, {
					$id,
					jsonSchema: { includeAnnotationKey: () => true },
				});
				assert.deepStrictEqual(record(record(document.root.properties).a)["x-taplo"], { hidden: true });
			}),
		);
	});
});
