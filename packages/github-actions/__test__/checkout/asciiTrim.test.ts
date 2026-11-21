import { assert, describe, it } from "@effect/vitest";
import { asciiTrim } from "../../src/internal/checkout/asciiTrim.js";

describe("asciiTrim", () => {
	it("strips ASCII whitespace from both ends only", () => {
		assert.strictEqual(asciiTrim(" \t\n\v\f\rmain \t\n\v\f\r"), "main");
		assert.strictEqual(asciiTrim("a b"), "a b");
		assert.strictEqual(asciiTrim(" \t "), "");
		assert.strictEqual(asciiTrim(""), "");
	});

	it("keeps a BOM and an NBSP, which are valid inside a ref name", () => {
		assert.strictEqual(asciiTrim(" ﻿main "), "﻿main");
		assert.strictEqual(asciiTrim(" main "), " main ");
	});

	it("is linear on a long interior whitespace run", () => {
		const input = `x${" ".repeat(100_000)}y`;
		const started = performance.now();
		assert.strictEqual(asciiTrim(input), input);
		assert.strictEqual(asciiTrim(`${" ".repeat(100_000)}y`), "y");
		assert.isBelow(performance.now() - started, 250);
	});
});
