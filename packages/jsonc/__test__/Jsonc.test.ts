import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { Jsonc, JsoncNode, JsoncParseError, JsoncParseOptions } from "../src/index.js";

describe("Jsonc", () => {
	describe("parse", () => {
		it.effect("parses objects, arrays and scalars", () =>
			Effect.gen(function* () {
				const value = yield* Jsonc.parse('{ "a": 1, "b": [true, null, "x"] }');
				assert.deepStrictEqual(value, { a: 1, b: [true, null, "x"] });
			}),
		);

		it.effect("ignores line and block comments by default", () =>
			Effect.gen(function* () {
				const value = yield* Jsonc.parse('{ "port": 3000 // dev\n /* block */ }');
				assert.deepStrictEqual(value, { port: 3000 });
			}),
		);

		it.effect("allows trailing commas by default", () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* Jsonc.parse('{ "a": 1, }'), { a: 1 });
				assert.deepStrictEqual(yield* Jsonc.parse("[1, 2, ]"), [1, 2]);
			}),
		);

		it.effect("fails with an aggregate JsoncParseError carrying positioned details", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Jsonc.parse("{ bad }"));
				assert.instanceOf(error, JsoncParseError);
				assert.strictEqual(error._tag, "JsoncParseError");
				assert.isAbove(error.errors.length, 0);
				assert.strictEqual(error.input, "{ bad }");
				const detail = error.errors[0];
				assert.strictEqual(detail.line, 0);
				assert.isAtLeast(detail.character, 0);
			}),
		);

		it.effect("computes line and character across newlines", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Jsonc.parse('{\n  "a": 1\n  "b": 2\n}'));
				assert.isAbove(error.errors.length, 0);
				// The CommaExpected error sits on line 2 ("b").
				assert.isTrue(error.errors.some((e) => e.line === 2));
			}),
		);

		it.effect("rejects comments when disallowComments is set", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					Jsonc.parse('{ "a": 1 } // no', JsoncParseOptions.make({ disallowComments: true })),
				);
				assert.strictEqual(error._tag, "JsoncParseError");
				assert.isTrue(error.errors.some((e) => e.code === "InvalidCommentToken"));
			}),
		);
	});

	describe("parseTree", () => {
		it.effect("builds a JsoncNode AST", () =>
			Effect.gen(function* () {
				const maybe = yield* Jsonc.parseTree('{ "a": [1, 2] }');
				assert.isTrue(Option.isSome(maybe));
				const root = Option.getOrThrow(maybe);
				assert.instanceOf(root, JsoncNode);
				assert.strictEqual(root.type, "object");
				assert.strictEqual(root.children?.length, 1);
				assert.deepStrictEqual(root.toValue(), { a: [1, 2] });
			}),
		);

		it.effect("returns Option.none() for empty input with allowEmptyContent", () =>
			Effect.gen(function* () {
				const maybe = yield* Jsonc.parseTree("", JsoncParseOptions.make({ allowEmptyContent: true }));
				assert.isTrue(Option.isNone(maybe));
			}),
		);
	});

	describe("stripComments", () => {
		it("removes comments producing valid JSON", () => {
			assert.strictEqual(Jsonc.stripComments('{ "a": 1 // c\n}'), '{ "a": 1 \n}');
		});

		it("preserves offsets when a replacement character is given", () => {
			const input = '{ "a": 1 // comment\n}';
			const stripped = Jsonc.stripComments(input, " ");
			assert.strictEqual(stripped.length, input.length);
			assert.strictEqual(JSON.parse(stripped).a, 1);
		});
	});

	describe("equals / equalsValue", () => {
		it("is key-order independent for objects", () => {
			assert.isTrue(Jsonc.equals('{ "a": 1, "b": 2 }', '{"b":2,"a":1}'));
		});

		it("is order-sensitive for arrays", () => {
			assert.isFalse(Jsonc.equals("[1, 2]", "[2, 1]"));
			assert.isTrue(Jsonc.equals("[1, 2]", "[1,2]"));
		});

		it("ignores comments and formatting", () => {
			assert.isTrue(Jsonc.equals('{ "a": 1 /* c */ }', '{\n  "a": 1 // note\n}'));
		});

		it("equalsValue compares against a JS value", () => {
			assert.isTrue(Jsonc.equalsValue('{ "port": 3000, "host": "x" }', { host: "x", port: 3000 }));
			assert.isFalse(Jsonc.equalsValue('{ "a": 1 }', { a: 2 }));
		});
	});

	describe("schema pipeline", () => {
		const Config = Schema.Struct({ name: Schema.String, version: Schema.Number });

		it.effect("JsoncFromString decodes commented input to unknown", () =>
			Effect.gen(function* () {
				const value = yield* Schema.decodeUnknownEffect(Jsonc.JsoncFromString)('{ "k": 42 // c\n}');
				assert.deepStrictEqual(value, { k: 42 });
			}),
		);

		it.effect("schema(Target) decodes JSONC straight into a domain value", () =>
			Effect.gen(function* () {
				const ConfigFromJsonc = Jsonc.schema(Config);
				const config = yield* Schema.decodeUnknownEffect(ConfigFromJsonc)('{ "name": "app", "version": 1 /* v1 */ }');
				assert.deepStrictEqual(config, { name: "app", version: 1 });
			}),
		);

		it.effect("encodes a value back to JSON", () =>
			Effect.gen(function* () {
				const encoded = yield* Schema.encodeUnknownEffect(Jsonc.JsoncFromString)({ a: 1 });
				assert.strictEqual(JSON.parse(encoded).a, 1);
			}),
		);

		it.effect("boundary: Jsonc.parse yields JsoncParseError, never SchemaError", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Jsonc.parse("{ bad }"));
				assert.strictEqual(error._tag, "JsoncParseError");
			}),
		);

		it.effect("schema decode surfaces a SchemaError carrying the aggregate parse message", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Schema.decodeUnknownEffect(Jsonc.JsoncFromString)("{ bad }"));
				assert.strictEqual(error._tag, "SchemaError");
				assert.include(String(error), "JSONC parse failed");
			}),
		);
	});

	describe("parse ∘ stripComments agreement (property)", () => {
		const Sample = Schema.Struct({
			name: Schema.String,
			count: Schema.Int,
			enabled: Schema.Boolean,
			tags: Schema.Array(Schema.String),
		});

		it.effect.prop("parse agrees with JSON.parse on comment-free-equivalent input", [Sample], ([value]) =>
			Effect.gen(function* () {
				const json = JSON.stringify(value);
				const commented = json.replace(/}$/, " /* trailing */ }");
				const stripped = Jsonc.stripComments(commented);
				assert.deepStrictEqual(JSON.parse(stripped), value);
				const parsed = yield* Jsonc.parse(commented);
				assert.deepStrictEqual(parsed, value);
			}),
		);
	});
});
