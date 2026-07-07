import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Jsonc, JsoncEdit, JsoncModificationError, JsoncModifier } from "../src/index.js";

const apply = (text: string, edits: ReadonlyArray<JsoncEdit>) => JsoncEdit.applyAll(text, edits);

describe("JsoncModifier", () => {
	describe("replace", () => {
		it.effect("updates an existing object property", () =>
			Effect.gen(function* () {
				const text = '{ "a": 1 }';
				const edits = yield* JsoncModifier.modify(text, ["a"], 2);
				assert.strictEqual(apply(text, edits), '{ "a": 2 }');
			}),
		);

		it.effect("updates a nested array element", () =>
			Effect.gen(function* () {
				const text = '{ "xs": [1, 2, 3] }';
				const edits = yield* JsoncModifier.modify(text, ["xs", 1], 99);
				assert.strictEqual(apply(text, edits), '{ "xs": [1, 99, 3] }');
			}),
		);

		it.effect("preserves comments and surrounding whitespace (byte-minimal)", () =>
			Effect.gen(function* () {
				const text = '{\n  "a": 1, // keep\n  "b": 2\n}';
				const edits = yield* JsoncModifier.modify(text, ["b"], 5);
				const out = apply(text, edits);
				assert.include(out, "// keep");
				assert.include(out, '"b": 5');
			}),
		);
	});

	describe("insert", () => {
		it.effect("appends a new property after the last one", () =>
			Effect.gen(function* () {
				const text = '{ "a": 1 }';
				const edits = yield* JsoncModifier.modify(text, ["b"], 2);
				assert.deepStrictEqual(yield* Jsonc.parse(apply(text, edits)), { a: 1, b: 2 });
			}),
		);

		it.effect("inserts into an empty object", () =>
			Effect.gen(function* () {
				const edits = yield* JsoncModifier.modify("{}", ["a"], 1);
				assert.deepStrictEqual(yield* Jsonc.parse(apply("{}", edits)), { a: 1 });
			}),
		);
	});

	describe("delete via undefined", () => {
		it.effect("removes an object property and its comma", () =>
			Effect.gen(function* () {
				const text = '{ "a": 1, "b": 2 }';
				const edits = yield* JsoncModifier.modify(text, ["a"], undefined);
				assert.deepStrictEqual(yield* Jsonc.parse(apply(text, edits)), { b: 2 });
			}),
		);

		it.effect("removes an array element", () =>
			Effect.gen(function* () {
				const text = "[1, 2, 3]";
				const edits = yield* JsoncModifier.modify(text, [1], undefined);
				assert.deepStrictEqual(yield* Jsonc.parse(apply(text, edits)), [1, 3]);
			}),
		);

		it.effect("deleting a missing key is a no-op", () =>
			Effect.gen(function* () {
				const edits = yield* JsoncModifier.modify('{ "a": 1 }', ["missing"], undefined);
				assert.deepStrictEqual(edits, []);
			}),
		);
	});

	describe("whole-document replace", () => {
		it.effect("replaces the entire document at the empty path", () =>
			Effect.gen(function* () {
				const edits = yield* JsoncModifier.modify('{ "old": 1 }', [], { new: true });
				assert.deepStrictEqual(yield* Jsonc.parse(apply('{ "old": 1 }', edits)), { new: true });
			}),
		);
	});

	describe("quote-containing keys (navigation correctness)", () => {
		it.effect("deletes a key that contains a quote character without corrupting siblings", () =>
			Effect.gen(function* () {
				const text = '{ "a\\"b": 1, "c": 2 }';
				const edits = yield* JsoncModifier.modify(text, ['a"b'], undefined);
				assert.deepStrictEqual(yield* Jsonc.parse(apply(text, edits)), { c: 2 });
			}),
		);

		it.effect("replaces the value of a quote-containing key", () =>
			Effect.gen(function* () {
				const text = '{ "a\\"b": 1 }';
				const edits = yield* JsoncModifier.modify(text, ['a"b'], 42);
				assert.deepStrictEqual(yield* Jsonc.parse(apply(text, edits)), { 'a"b': 42 });
			}),
		);
	});

	describe("errors", () => {
		it.effect("fails with JsoncModificationError on a structural mismatch", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(JsoncModifier.modify('{ "a": 1 }', ["a", "b"], 2));
				assert.instanceOf(error, JsoncModificationError);
				assert.strictEqual(error._tag, "JsoncModificationError");
				assert.deepStrictEqual([...error.path], ["a", "b"]);
				assert.include(error.message, "Modification failed");
			}),
		);
	});
});
