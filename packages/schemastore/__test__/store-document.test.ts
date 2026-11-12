import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import type { UndeclaredAnnotationKeyError } from "../src/index.js";
import { DRAFT_07_META_SCHEMA, SchemaConversionError, StoreDocument } from "../src/index.js";

class Person extends Schema.Class<Person>("Person")({
	name: Schema.String,
	age: Schema.Number,
}) {}

const Team = Schema.Struct({
	lead: Person,
	members: Schema.Array(Person),
});

const $id = "https://example.com/team.schema.json";

describe("StoreDocument", () => {
	describe("draft07", () => {
		it("fills $schema with the meta-schema constant so hand-built values need not import it", () => {
			const document = StoreDocument.draft07({ $id: "https://example.com/x.schema.json", root: { type: "object" } });
			assert.strictEqual(document.$schema, DRAFT_07_META_SCHEMA);
			assert.deepStrictEqual(document.defs, {});
			assert.deepStrictEqual(document.toJson(), {
				$schema: DRAFT_07_META_SCHEMA,
				$id: "https://example.com/x.schema.json",
				type: "object",
			});
		});
	});

	describe("fromSchema", () => {
		it.effect("assembles $schema, $id, root and the $defs pool", () =>
			Effect.gen(function* () {
				const document = yield* StoreDocument.fromSchema(Team, { $id });
				assert.strictEqual(document.$schema, DRAFT_07_META_SCHEMA);
				assert.strictEqual(document.$id, $id);
				assert.strictEqual(document.root.type, "object");
				// beta.105 names the encoded-side definition with an `Encoded` suffix
				// when the encoded AST carries no identifier of its own.
				assert.property(document.defs, "PersonEncoded");
			}),
		);

		it.effect("rewrites #/definitions refs back to #/$defs", () =>
			Effect.gen(function* () {
				const document = yield* StoreDocument.fromSchema(Team, { $id });
				const text = JSON.stringify(document.toJson());
				// The Draft-07 lowering emits canonical #/definitions refs; the
				// assembled document keeps the pool under $defs, so every ref
				// must point there and none may survive in the lowered form.
				assert.include(text, '"#/$defs/PersonEncoded"');
				assert.notInclude(text, "#/definitions/");
			}),
		);

		it.effect("rewrites only $ref values, never prose or non-ref strings", () =>
			Effect.gen(function* () {
				const Annotated = Schema.Struct({
					note: Schema.String.annotate({ description: "See #/definitions/Person for details" }),
				});
				const document = yield* StoreDocument.fromSchema(Annotated, { $id });
				const properties = document.root.properties as Record<string, Record<string, unknown>>;
				assert.strictEqual(properties.note?.description, "See #/definitions/Person for details");
			}),
		);

		it.effect("omits $defs when the pool is empty", () =>
			Effect.gen(function* () {
				const Flat = Schema.Struct({ name: Schema.String });
				const document = yield* StoreDocument.fromSchema(Flat, { $id });
				assert.notProperty(document.toJson(), "$defs");
			}),
		);

		it.effect("lowers with a supplied toJsonSchemaDocument, passing the source and the closed-object default", () =>
			Effect.gen(function* () {
				const calls: Array<{ readonly source: unknown; readonly onExcessProperty: unknown }> = [];
				const toJsonSchemaDocument: typeof Schema.toJsonSchemaDocument = (source, options) => {
					calls.push({ source, onExcessProperty: options?.onExcessProperty });
					return Schema.toJsonSchemaDocument(source, options);
				};
				const supplied = yield* StoreDocument.fromSchema(Team, { $id, toJsonSchemaDocument });
				const own = yield* StoreDocument.fromSchema(Team, { $id });
				assert.deepStrictEqual(calls, [{ source: Team, onExcessProperty: "error" }]);
				assert.deepStrictEqual(supplied.toJson(), own.toJson());
			}),
		);

		it.effect("generates closed objects by default and lets jsonSchema reopen them", () =>
			Effect.gen(function* () {
				// additionalProperties survives the Draft-07 lowering, so it is
				// the observable passthrough. Core's own default has been
				// `onExcessProperty: "ignore"` (an open object) since rc.113; a
				// published document is a contract, so this package defaults to
				// "error" and a caller opts back out per target.
				const Flat = Schema.Struct({ name: Schema.String });
				const closed = yield* StoreDocument.fromSchema(Flat, { $id });
				const open = yield* StoreDocument.fromSchema(Flat, {
					$id,
					jsonSchema: { onExcessProperty: "ignore" },
				});
				assert.strictEqual(closed.root.additionalProperties, false);
				assert.strictEqual(open.root.additionalProperties, true);
			}),
		);

		it.effect("fails typed with SchemaConversionError when the generated document nests past the cap", () =>
			Effect.gen(function* () {
				// Core's generator is total over declared schemas (probed: a
				// bare Schema.declare emits {"type":"null"} rather than
				// throwing), so the fireable failure is the package's own
				// hardening cap on the ref-rewrite walk.
				let deep: Schema.Constraint = Schema.String;
				for (let index = 0; index < 200; index++) {
					deep = Schema.Struct({ inner: deep });
				}
				const error = yield* Effect.flip(StoreDocument.fromSchema(deep, { $id }));
				assert.instanceOf(error, SchemaConversionError);
				assert.strictEqual(error.$id, $id);
			}),
		);

		// #624 — rootAnnotations is the escape hatch for a generator-side
		// annotation loss the source schema cannot express.
		it("rootAnnotations land on the root of an inline-root document, overriding generated keys", () => {
			const source = Schema.Struct({ a: Schema.String }).annotate({ title: "generated" });
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(source, {
					$id: "https://example.com/a.json",
					rootAnnotations: { title: "T", description: "D", "x-ai-hint": { audience: "agent" } },
				}),
			);
			assert.strictEqual(document.root.title, "T");
			assert.strictEqual(document.root.description, "D");
			assert.deepStrictEqual(document.root["x-ai-hint"], { audience: "agent" });
			assert.strictEqual(document.root.type, "object", "generated keywords survive");
		});

		it("rootAnnotations follow a bare local $ref root onto its $defs entry (the Schema.Class shape)", () => {
			class Foo extends Schema.Class<Foo>("Foo")({ a: Schema.String }) {}
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(Foo, {
					$id: "https://example.com/foo.json",
					rootAnnotations: { title: "T", "x-taplo": { hidden: true } },
				}),
			);
			assert.deepStrictEqual(document.root, { $ref: "#/$defs/FooEncoded" }, "the root stays a bare $ref");
			const entry = document.defs.FooEncoded as Record<string, unknown>;
			assert.strictEqual(entry.title, "T");
			assert.deepStrictEqual(entry["x-taplo"], { hidden: true });
			assert.strictEqual(entry.type, "object");
		});

		// The $ref token core emits is JSON-Pointer + URI escaped, so the pool
		// lookup must decode it rather than slice a prefix.
		it("rootAnnotations follow a pointer-escaped $ref root onto its $defs entry", () => {
			class Foo extends Schema.Class<Foo>("My Foo/Bar")({ a: Schema.String }) {}
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(Foo, {
					$id: "https://example.com/foo.json",
					rootAnnotations: { title: "T" },
				}),
			);
			assert.deepStrictEqual(document.root, { $ref: "#/$defs/My%20Foo~1BarEncoded" }, "the root stays a bare $ref");
			const entry = document.defs["My Foo/BarEncoded"] as Record<string, unknown>;
			assert.isDefined(entry);
			assert.strictEqual(entry.title, "T");
			assert.strictEqual(entry.type, "object");
		});

		// A recursive class shares its $defs entry with every self-reference:
		// merging the document title onto it would title every occurrence, so
		// the root is wrapped instead (annotations + `allOf: [{ $ref }]`).
		it("rootAnnotations wrap a bare $ref root in allOf when its $defs entry has other referents", () => {
			class Node extends Schema.Class<Node>("Node")({
				value: Schema.String,
				children: Schema.Array(Schema.suspend((): Schema.Codec<Node> => Node)),
			}) {}
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(Node, {
					$id: "https://example.com/node.json",
					rootAnnotations: { title: "T", description: "D" },
				}),
			);
			assert.deepStrictEqual(document.root, { title: "T", description: "D", allOf: [{ $ref: "#/$defs/NodeEncoded" }] });
			assert.deepStrictEqual(
				Object.keys(document.root),
				["title", "description", "allOf"],
				"annotations serialize first",
			);
			const entry = document.defs.NodeEncoded as Record<string, unknown>;
			assert.isFalse(Object.hasOwn(entry, "title"), "the shared entry carries no title");
			assert.isFalse(Object.hasOwn(entry, "description"), "the shared entry carries no description");
			assert.strictEqual(entry.type, "object");
		});

		// Draft-07 §8 content vocabulary: annotations, not assertions.
		it("rootAnnotations admit the contentMediaType and contentEncoding annotation keywords", () => {
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(Schema.String, {
					$id: "https://example.com/a.json",
					rootAnnotations: { contentMediaType: "application/json", contentEncoding: "base64" },
				}),
			);
			assert.strictEqual(document.root.contentMediaType, "application/json");
			assert.strictEqual(document.root.contentEncoding, "base64");
			assert.strictEqual(document.root.type, "string");
		});

		it("rootAnnotations skips undefined-valued entries instead of writing an undefined key", () => {
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(Schema.Struct({ a: Schema.String }), {
					$id: "https://example.com/a.json",
					rootAnnotations: { title: undefined, description: "D" },
				}),
			);
			assert.isFalse(Object.hasOwn(document.root, "title"));
			assert.strictEqual(document.root.description, "D");
		});

		it("rootAnnotations outside the standard keywords and declared families fail UndeclaredAnnotationKeyError", () => {
			const result = StoreDocument.fromSchemaResult(Schema.Struct({ a: Schema.String }), {
				$id: "https://example.com/a.json",
				rootAnnotations: { title: "ok", "x-mine": 1, additionalProperties: false },
			});
			assert.isTrue(Result.isFailure(result));
			const error = Result.getOrThrow(Result.flip(result));
			assert.strictEqual(error._tag, "UndeclaredAnnotationKeyError");
			assert.deepStrictEqual((error as UndeclaredAnnotationKeyError).keys, ["additionalProperties", "x-mine"]);
		});

		it("rootAnnotations $ref-shaped strings inside a declared-family value are not rewritten", () => {
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(Schema.Struct({ a: Schema.String }), {
					$id: "https://example.com/a.json",
					rootAnnotations: { "x-ai-hint": { see: "#/definitions/Other" } },
				}),
			);
			assert.deepStrictEqual(document.root["x-ai-hint"], { see: "#/definitions/Other" });
		});
	});

	describe("toJson", () => {
		it.effect("orders keys $schema, $id, root keywords, $defs", () =>
			Effect.gen(function* () {
				const document = yield* StoreDocument.fromSchema(Team, { $id });
				const keys = Object.keys(document.toJson());
				assert.strictEqual(keys[0], "$schema");
				assert.strictEqual(keys[1], "$id");
				assert.strictEqual(keys[keys.length - 1], "$defs");
			}),
		);
	});

	describe("__proto__ hardening", () => {
		it("a document carrying a literal __proto__ key round-trips it and leaves Object.prototype untouched", () => {
			// The realistic vector: an existing schema file decoded with
			// JSON.parse, which creates a plain OWN "__proto__" property.
			const hostileRoot = JSON.parse(
				'{"type":"object","properties":{"__proto__":{"type":"string"}},"__proto__":{"polluted":true}}',
			) as Record<string, unknown>;
			const document = StoreDocument.make({
				$schema: DRAFT_07_META_SCHEMA,
				$id,
				root: hostileRoot,
				defs: {},
			});
			const json = document.toJson();
			// The key survives as an own data property at both positions…
			assert.isTrue(Object.getOwnPropertyNames(json).includes("__proto__"));
			const properties = json.properties as Record<string, unknown>;
			assert.isTrue(Object.getOwnPropertyNames(properties).includes("__proto__"));
			// …reaches the serialized text…
			const text = Result.getOrThrow(document.serializeResult());
			assert.include(text, '"__proto__"');
			assert.deepStrictEqual(JSON.parse(text).type, "object");
			// …and nothing along the way mutated Object.prototype.
			assert.isFalse("polluted" in {});
			assert.strictEqual(Object.getPrototypeOf(json), Object.prototype);
		});

		it.effect("fromSchema over a hostile __proto__-carrying default leaves Object.prototype untouched", () =>
			Effect.gen(function* () {
				// Probed at the installed beta: core's generation and lowering
				// strip own "__proto__" keys before this package's walks run
				// (the null-prototype accumulators are defense in depth), so
				// the observable contract is: the pipeline completes and no
				// stage pollutes the global prototype.
				const hostileDefault = JSON.parse('{"__proto__":{"polluted":true},"ok":1}') as Record<string, unknown>;
				const Hostile = Schema.Struct({
					a: Schema.Record(Schema.String, Schema.Unknown).annotate({ default: hostileDefault }),
				});
				const document = yield* StoreDocument.fromSchema(Hostile, { $id });
				assert.isFalse("polluted" in {});
				const text = Result.getOrThrow(document.serializeResult());
				assert.isFalse("polluted" in JSON.parse(text));
			}),
		);
	});

	// #818 — core's Draft-07 lowering renders an open-ended tuple as an
	// `items` array plus a schema-shaped `additionalItems`, which ajv's
	// strictTuples rule rejects by construction. A uniform head (every
	// element equal to the rest schema, as `NonEmptyArray` always lowers)
	// collapses to `items` + `minItems`; everything else keeps its shape.
	describe("uniform-tuple collapse", () => {
		it("lowers NonEmptyArray to items+minItems, the shape the strict gate accepts", () => {
			const source = Schema.Struct({ plugins: Schema.NonEmptyArray(Schema.String) }).annotate({ identifier: "Probe" });
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(source, { $id: "https://example.com/probe.json" }),
			);
			const entry = document.defs.Probe as Record<string, unknown>;
			const properties = entry.properties as Record<string, Record<string, unknown>>;
			assert.deepStrictEqual(properties.plugins, { type: "array", minItems: 1, items: { type: "string" } });
			assert.isFalse("additionalItems" in properties.plugins);
		});

		it("leaves tuple-shaped annotation values untouched", () => {
			const tupleLike = { items: [{ type: "string" }], additionalItems: { type: "string" } };
			const source = Schema.Struct({
				value: Schema.Record(Schema.String, Schema.Unknown).annotate({ default: tupleLike, examples: [tupleLike] }),
			});
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(source, { $id: "https://example.com/annotations.json" }),
			);
			const properties = document.root.properties as Record<string, Record<string, unknown>>;
			assert.deepStrictEqual(properties.value?.default, tupleLike);
			assert.deepStrictEqual(properties.value?.examples, [tupleLike]);
		});

		it("collapses a uniform multi-element head, keeping core's minItems", () => {
			const source = Schema.TupleWithRest(Schema.Tuple([Schema.String, Schema.String]), [Schema.String]);
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(source, { $id: "https://example.com/two.json" }),
			);
			assert.deepStrictEqual(document.root, { type: "array", minItems: 2, items: { type: "string" } });
		});

		it("does not raise minItems past what optional head elements require", () => {
			const source = Schema.TupleWithRest(Schema.Tuple([Schema.String, Schema.optionalKey(Schema.String)]), [
				Schema.String,
			]);
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(source, { $id: "https://example.com/optional.json" }),
			);
			assert.deepStrictEqual(document.root, { type: "array", minItems: 1, items: { type: "string" } });
		});

		it("adds no minItems when every head element is optional", () => {
			const source = Schema.TupleWithRest(Schema.Tuple([Schema.optionalKey(Schema.String)]), [Schema.String]);
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(source, { $id: "https://example.com/all-optional.json" }),
			);
			assert.deepStrictEqual(document.root, { type: "array", items: { type: "string" } });
		});

		it("keeps the tuple form for a heterogeneous head with an open rest", () => {
			const source = Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Boolean]);
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(source, { $id: "https://example.com/hetero.json" }),
			);
			assert.deepStrictEqual(document.root.items, [{ type: "string" }]);
			assert.deepStrictEqual(document.root.additionalItems, { type: "boolean" });
		});

		it("leaves a closed tuple alone", () => {
			const source = Schema.Tuple([Schema.String, Schema.Boolean]);
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(source, { $id: "https://example.com/closed.json" }),
			);
			// Core pins a closed tuple with maxItems/minItems at the tuple
			// length and no `additionalItems` at all — the shape strictTuples
			// already accepts, so the collapse must not touch it.
			assert.deepStrictEqual(document.root, {
				type: "array",
				maxItems: 2,
				minItems: 2,
				items: [{ type: "string" }, { type: "boolean" }],
			});
			assert.isFalse("additionalItems" in document.root);
		});

		it("leaves a plain Schema.Array alone", () => {
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(Schema.Array(Schema.String), { $id: "https://example.com/plain.json" }),
			);
			assert.deepStrictEqual(document.root, { type: "array", items: { type: "string" } });
		});

		it("carries a declared-family annotation on the collapsed items", () => {
			const source = Schema.NonEmptyArray(Schema.String.annotate({ "x-taplo": { hidden: true } }));
			const document = Result.getOrThrow(
				StoreDocument.fromSchemaResult(source, { $id: "https://example.com/annotated.json" }),
			);
			assert.deepStrictEqual(document.root.items, { type: "string", "x-taplo": { hidden: true } });
			assert.strictEqual(document.root.minItems, 1);
		});
	});

	describe("serializeResult", () => {
		it("produces canonical text ending in a newline", () => {
			const document = Result.getOrThrow(StoreDocument.fromSchemaResult(Team, { $id }));
			const text = Result.getOrThrow(document.serializeResult());
			assert.isTrue(text.endsWith("}\n"));
			assert.isTrue(text.startsWith(`{\n\t"$schema": ${JSON.stringify(DRAFT_07_META_SCHEMA)},\n`));
		});
	});
});
