import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { ToolFailure } from "../src/index.js";

describe("ToolFailure.message", () => {
	it("folds the hint and the suggested tool into one self-contained sentence run", () => {
		assert.strictEqual(
			ToolFailure.message('No concept "x".', { hint: "Check the id.", suggestedTool: "list_concepts" }),
			'No concept "x". Check the id. Try list_concepts.',
		);
	});

	it("omits the Try clause when no tool is suggested", () => {
		assert.strictEqual(ToolFailure.message("Config missing.", { hint: "Run init." }), "Config missing. Run init.");
	});

	it("never leaves a double space for an empty hint", () => {
		assert.strictEqual(ToolFailure.message("Boom.", { hint: "" }), "Boom.");
		assert.strictEqual(ToolFailure.message("Boom.", { hint: "", suggestedTool: "status" }), "Boom. Try status.");
	});
});

describe("ToolFailure.truncate", () => {
	it("returns a value at or under the limit unchanged", () => {
		const value = "a".repeat(200);
		assert.strictEqual(ToolFailure.truncate(value), value);
	});

	it("cuts a caller value at ECHO_LIMIT and marks the cut", () => {
		assert.strictEqual(ToolFailure.truncate("a".repeat(500)), `${"a".repeat(200)}…`);
		assert.strictEqual(ToolFailure.ECHO_LIMIT, 200);
	});

	it("takes the larger ENGINE_ECHO_LIMIT for engine-produced values", () => {
		assert.strictEqual(ToolFailure.ENGINE_ECHO_LIMIT, 2000);
		assert.strictEqual(ToolFailure.truncate("b".repeat(3000), ToolFailure.ENGINE_ECHO_LIMIT).length, 2001);
	});

	it("never splits a surrogate pair at the cut", () => {
		// 199 ASCII chars then an emoji (two code units) straddling index 199-200.
		assert.strictEqual(ToolFailure.truncate(`${"a".repeat(199)}😀b`), `${"a".repeat(199)}…`);
	});
});

describe("ToolFailure.fields", () => {
	it("spreads into a consumer's TaggedError whose message is what reaches the wire", () => {
		class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { ...ToolFailure.fields, id: Schema.String }) {}
		const remediation = { hint: "Check the id.", suggestedTool: "list_things" };
		const error = new NotFound({ id: "x", message: ToolFailure.message('No thing "x".', remediation), remediation });
		assert.instanceOf(error, Error);
		assert.strictEqual(error.message, 'No thing "x". Check the id. Try list_things.');
		assert.deepStrictEqual(error.remediation, remediation);
	});
});
