import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { canonicalJson } from "../src/internal/canonical.js";

const ok = (value: unknown) => {
	const result = canonicalJson(value);
	assert.isTrue(Result.isSuccess(result), JSON.stringify(result));
	return Result.isSuccess(result) ? result.success : "";
};

describe("canonicalJson", () => {
	it("sorts object keys recursively and drops whitespace", () => {
		assert.strictEqual(
			ok({ b: 1, a: { d: [1, { z: 0, y: "x" }], c: null } }),
			'{"a":{"c":null,"d":[1,{"y":"x","z":0}]},"b":1}',
		);
	});

	it("key order does not change the output", () => {
		assert.strictEqual(ok({ a: 1, b: 2 }), ok({ b: 2, a: 1 }));
	});

	it("omits undefined object members exactly as JSON.stringify does (review focus 5)", () => {
		assert.strictEqual(ok({ a: 1, b: undefined }), ok({ a: 1 }));
	});

	it("a __proto__ own key is ordinary data", () => {
		assert.strictEqual(ok(JSON.parse('{"__proto__":1,"a":2}')), '{"__proto__":1,"a":2}');
	});

	it("rejects values JSON cannot carry faithfully", () => {
		for (const bad of [
			Number.NaN,
			Number.POSITIVE_INFINITY,
			1n,
			new Date(0),
			new Uint8Array(1),
			() => 0,
			Symbol("s"),
			[undefined],
			new Map(),
		]) {
			assert.isTrue(Result.isFailure(canonicalJson(bad)), String(typeof bad));
		}
	});

	it("rejects nesting deeper than 256", () => {
		let deep: unknown = 0;
		for (let i = 0; i < 300; i++) deep = [deep];
		assert.isTrue(Result.isFailure(canonicalJson(deep)));
	});
});
