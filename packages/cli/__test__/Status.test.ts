import { assert, describe, it } from "@effect/vitest";
import { Status, Token } from "../src/index.js";

describe("Status.core", () => {
	it("holds the six core statuses with their ranks", () => {
		const ranks = (["success", "skip", "pending", "info", "warning", "failure"] as const).map(
			(name) => Status.core.def(name).rank,
		);
		assert.deepStrictEqual(ranks, [10, 20, 30, 40, 60, 90]);
		assert.deepStrictEqual(Status.core.def("failure"), { glyph: "✗", ascii: "[FAIL]", token: "failure", rank: 90 });
		assert.strictEqual(Status.core.def("skip").token, "muted");
	});

	it("worst is the highest rank", () => {
		assert.strictEqual(Status.core.worst(["success", "skip", "failure"]), "failure");
		assert.strictEqual(Status.core.worst(["success"]), "success");
	});

	it("worst breaks a rank tie in favour of the first name", () => {
		const v = Status.extend({
			a: { glyph: "a", ascii: "a", token: "info", rank: 50 },
			b: { glyph: "b", ascii: "b", token: "info", rank: 50 },
		});
		assert.strictEqual(v.worst(["a", "b"]), "a");
		assert.strictEqual(v.worst(["b", "a"]), "b");
	});
});

describe("Status.extend", () => {
	const vocab = Status.extend({ timeout: { glyph: "⧖", ascii: "[time]", token: Token.hex("#e09a4e"), rank: 85 } });

	it("ranks an extra status among the core ones", () => {
		assert.strictEqual(vocab.worst(["timeout", "warning"]), "timeout");
		assert.strictEqual(vocab.worst(["timeout", "failure"]), "failure");
	});

	it("keeps the core statuses and is available on an instance", () => {
		assert.strictEqual(vocab.def("failure").rank, 90);
		assert.strictEqual(vocab.def("timeout").ascii, "[time]");
		const more = vocab.extend({ flaky: { glyph: "~", ascii: "~", token: "warning", rank: 55 } });
		assert.strictEqual(more.worst(["flaky", "timeout"]), "timeout");
	});

	it("rejects a name the vocabulary does not have at compile time", () => {
		// @ts-expect-error "timeot" is not a status name
		assert.throws(() => assert.isUndefined(vocab.def("timeot").rank));
	});
});
