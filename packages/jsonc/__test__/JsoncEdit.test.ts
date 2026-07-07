import { assert, describe, it } from "@effect/vitest";
import { JsoncEdit } from "../src/index.js";

describe("JsoncEdit", () => {
	describe("make", () => {
		it("constructs an edit", () => {
			const edit = JsoncEdit.make({ offset: 10, length: 0, content: ", true" });
			assert.strictEqual(edit.offset, 10);
			assert.strictEqual(edit.length, 0);
			assert.strictEqual(edit.content, ", true");
		});
	});

	describe("applyAll", () => {
		it("applies a single replacement", () => {
			assert.strictEqual(
				JsoncEdit.applyAll('{ "a": 1 }', [JsoncEdit.make({ offset: 7, length: 1, content: "2" })]),
				'{ "a": 2 }',
			);
		});

		it("applies multiple edits in reverse-offset order regardless of input order", () => {
			const text = "abcdef";
			const edits = [
				JsoncEdit.make({ offset: 0, length: 1, content: "X" }),
				JsoncEdit.make({ offset: 4, length: 2, content: "YZ" }),
				JsoncEdit.make({ offset: 2, length: 0, content: "-" }),
			];
			assert.strictEqual(JsoncEdit.applyAll(text, edits), "Xb-cdYZ");
		});

		it("inserts with length 0 and deletes with empty content", () => {
			assert.strictEqual(JsoncEdit.applyAll("[]", [JsoncEdit.make({ offset: 1, length: 0, content: "1" })]), "[1]");
			assert.strictEqual(JsoncEdit.applyAll("[1,2]", [JsoncEdit.make({ offset: 2, length: 2, content: "" })]), "[1]");
		});

		it("does not mutate the input array", () => {
			const edits = [JsoncEdit.make({ offset: 0, length: 0, content: "!" })];
			const snapshot = [...edits];
			JsoncEdit.applyAll("x", edits);
			assert.deepStrictEqual(edits, snapshot);
		});
	});
});
