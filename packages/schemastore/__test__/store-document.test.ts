import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
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
	describe("fromSchema", () => {
		it.effect("assembles $schema, $id, root and the $defs pool", () =>
			Effect.gen(function* () {
				const document = yield* StoreDocument.fromSchema(Team, { $id });
				assert.strictEqual(document.$schema, DRAFT_07_META_SCHEMA);
				assert.strictEqual(document.$id, $id);
				assert.strictEqual(document.root.type, "object");
				assert.property(document.defs, "Person");
			}),
		);

		it.effect("rewrites #/definitions refs back to #/$defs", () =>
			Effect.gen(function* () {
				const document = yield* StoreDocument.fromSchema(Team, { $id });
				const text = JSON.stringify(document.toJson());
				// The Draft-07 lowering emits canonical #/definitions refs; the
				// assembled document keeps the pool under $defs, so every ref
				// must point there and none may survive in the lowered form.
				assert.include(text, '"#/$defs/Person"');
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

		it.effect("passes jsonSchema options through to core generation", () =>
			Effect.gen(function* () {
				// additionalProperties survives the Draft-07 lowering, so it is
				// the observable passthrough. (Non-standard annotation keys do
				// NOT survive the lowering — the recorded phase-2 hazard.)
				const Flat = Schema.Struct({ name: Schema.String });
				const closed = yield* StoreDocument.fromSchema(Flat, { $id });
				const open = yield* StoreDocument.fromSchema(Flat, {
					$id,
					jsonSchema: { additionalProperties: true },
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

	describe("serializeResult", () => {
		it("produces canonical text ending in a newline", () => {
			const document = Result.getOrThrow(StoreDocument.fromSchemaResult(Team, { $id }));
			const text = Result.getOrThrow(document.serializeResult());
			assert.isTrue(text.endsWith("}\n"));
			assert.isTrue(text.startsWith(`{\n\t"$schema": ${JSON.stringify(DRAFT_07_META_SCHEMA)},\n`));
		});
	});
});
