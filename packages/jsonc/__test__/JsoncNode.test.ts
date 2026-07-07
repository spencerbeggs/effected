import { assert, describe, it } from "@effect/vitest";
import { Effect, Equal, Hash, Option } from "effect";
import { Jsonc, JsoncNode } from "../src/index.js";

const tree = (text: string) => Effect.runSync(Jsonc.parseTree(text)).pipe(Option.getOrThrow);

describe("JsoncNode", () => {
	describe("construction", () => {
		it("constructs via make", () => {
			const node = JsoncNode.make({ type: "number", offset: 0, length: 2, value: 42 });
			assert.strictEqual(node.type, "number");
			assert.strictEqual(node.value, 42);
			assert.strictEqual(node.children, undefined);
		});
	});

	describe("find", () => {
		it.effect("navigates object keys and array indices", () =>
			Effect.gen(function* () {
				const root = Option.getOrThrow(yield* Jsonc.parseTree('{ "a": { "b": [10, 20] } }'));
				const b1 = root.find(["a", "b", 1]);
				assert.isTrue(Option.isSome(b1));
				assert.strictEqual(Option.getOrThrow(b1).toValue(), 20);
			}),
		);

		it("returns none for missing paths", () => {
			const root = tree('{ "a": 1 }');
			assert.isTrue(Option.isNone(root.find(["missing"])));
			assert.isTrue(Option.isNone(root.find(["a", "deeper"])));
			assert.isTrue(Option.isNone(root.find([0])));
		});
	});

	describe("findAtOffset / pathAt", () => {
		it("finds the innermost node at an offset and its path", () => {
			const text = '{ "a": { "b": 42 } }';
			const root = tree(text);
			const offset = text.indexOf("42");
			const node = root.findAtOffset(offset);
			assert.isTrue(Option.isSome(node));
			assert.strictEqual(Option.getOrThrow(node).type, "number");
			assert.deepStrictEqual(Option.getOrThrow(root.pathAt(offset)), ["a", "b"]);
		});

		it("returns none outside the tree", () => {
			const root = tree('{ "a": 1 }');
			assert.isTrue(Option.isNone(root.findAtOffset(9999)));
			assert.isTrue(Option.isNone(root.pathAt(9999)));
		});
	});

	describe("toValue", () => {
		it("reconstructs nested values", () => {
			assert.deepStrictEqual(tree('{ "x": [1, { "y": true }], "z": null }').toValue(), {
				x: [1, { y: true }],
				z: null,
			});
		});
	});

	describe("offset discipline (issue #62)", () => {
		it("node spans never swallow trailing whitespace or comments", () => {
			const text = '{ "a": 1   // trailing\n}';
			const root = tree(text);
			const prop = root.children?.[0];
			const valueNode = prop?.children?.[1];
			assert.isDefined(valueNode);
			// The value node covers exactly "1", not the trailing spaces/comment.
			const span = text.substring(valueNode?.offset ?? 0, (valueNode?.offset ?? 0) + (valueNode?.length ?? 0));
			assert.strictEqual(span, "1");
		});

		it("string value spans stop at the closing quote", () => {
			const text = '[ "hello"  , 2 ]';
			const root = tree(text);
			const first = root.children?.[0];
			assert.isDefined(first);
			const span = text.substring(first?.offset ?? 0, (first?.offset ?? 0) + (first?.length ?? 0));
			assert.strictEqual(span, '"hello"');
		});

		it("array span stops at the closing bracket", () => {
			const text = "[1, 2]   ";
			const root = tree(text);
			const span = text.substring(root.offset, root.offset + root.length);
			assert.strictEqual(span, "[1, 2]");
		});
	});

	describe("structural equality and hashing", () => {
		it("Equal.equals holds for structurally-identical nodes; hash agrees", () => {
			const a = JsoncNode.make({ type: "string", offset: 0, length: 3, value: "x" });
			const b = JsoncNode.make({ type: "string", offset: 0, length: 3, value: "x" });
			const c = JsoncNode.make({ type: "string", offset: 0, length: 3, value: "y" });
			assert.isTrue(Equal.equals(a, b));
			assert.isFalse(Equal.equals(a, c));
			assert.strictEqual(Hash.hash(a), Hash.hash(b));
		});
	});

	describe("quote-containing keys", () => {
		it("resolves keys that contain quote characters", () => {
			const root = tree('{ "a\\"b": 1 }');
			const found = root.find(['a"b']);
			assert.isTrue(Option.isSome(found));
			assert.strictEqual(Option.getOrThrow(found).toValue(), 1);
		});
	});
});
