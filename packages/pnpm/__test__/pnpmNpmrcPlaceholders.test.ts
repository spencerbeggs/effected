// Characterisation of `expandPlaceholders` and `hasPlaceholder`: the expected
// column was captured by running the regular-expression implementation they
// replaced over these inputs, so the linear scanner is held to its output.

import { assert, describe, it } from "@effect/vitest";
import { expandPlaceholders, hasPlaceholder } from "../src/internal/pnpmNpmrc.js";

const env = { A: "x", E: "", B: "b-c", N: "n" };

/** Input, the expansion the old implementation produced, and what `hasPlaceholder` said. */
const table: ReadonlyArray<readonly [string, string, boolean]> = [
	["", "", false],
	["plain", "plain", false],
	["${A}", "x", true],
	["${E}", "", true],
	["${U}", "", true],
	["${A:-fb}", "x", true],
	["${U:-fb}", "fb", true],
	["${E:-fb}", "fb", true],
	["${E-fb}", "", true],
	["${U-fb}", "fb", true],
	["${B}", "b-c", true],
	["${B:-z}", "b-c", true],
	["${U-a:-b}", "a:-b", true],
	["${U:-a-b}", "a-b", true],
	["\\${A}", "${A}", true],
	["\\\\${A}", "\\x", true],
	["\\\\\\${A}", "\\${A}", true],
	["\\\\\\\\${A}", "\\\\x", true],
	["x\\${A}y", "x${A}y", true],
	["\\", "\\", false],
	["\\\\", "\\\\", false],
	["\\a${A}", "\\ax", true],
	["a\\\\${U:-q}", "a\\q", true],
	["${A}${N}", "xn", true],
	["${A}-${N}", "x-n", true],
	["${A}${U}${N}", "xn", true],
	["${", "${", false],
	["${A", "${A", false],
	["a${A", "a${A", false],
	["${A}${", "x${", true],
	["${}", "${}", false],
	["${}}", "${}}", false],
	["${}${A}", "${}x", true],
	["${${A}}", "}", true],
	["${${A}", "", true],
	["}", "}", false],
	["}${A}", "}x", true],
	["a}b", "a}b", false],
	["$", "$", false],
	["{A}", "{A}", false],
	["$A", "$A", false],
	["${A}}", "x}", true],
	["${ A }", "", true],
	["${A:-}", "x", true],
	["${U:-}", "", true],
	["${:-x}", "x", true],
	["${-x}", "x", true],
	["${:-}", "", true],
	["${U-}", "", true],
	["\\${", "\\${", false],
	["\\${}", "\\${}", false],
	["\\\\${}${A}", "\\\\${}x", true],
	["\\${A", "\\${A", false],
	["${A}\\${N}\\\\${N}", "x${N}\\n", true],
	["${a${A}b}", "b}", true],
	["${{}", "", true],
	["${{", "${{", false],
	["${{}}", "}", true],
	["${constructor}", "", true],
	["${__proto__}", "", true],
	["${toString:-q}", "q", true],
	["a\\\\\\${${A}}", "a\\${${A}}", true],
];

describe("pnpmNpmrc placeholders", () => {
	it("expandPlaceholders matches the recorded outputs", () => {
		assert.isAbove(table.length, 50, "the table is not empty");
		for (const [input, expanded] of table) {
			assert.strictEqual(expandPlaceholders(input, env), expanded, JSON.stringify(input));
		}
	});

	it("hasPlaceholder matches the recorded answers", () => {
		for (const [input, , placeholder] of table) {
			assert.strictEqual(hasPlaceholder(input), placeholder, JSON.stringify(input));
		}
	});

	it("tells odd and even runs and empty bodies apart (control)", () => {
		assert.isTrue(hasPlaceholder("\\${A}"));
		assert.isFalse(hasPlaceholder("${}"));
		assert.strictEqual(expandPlaceholders("\\\\${A}", env), "\\x");
		assert.strictEqual(expandPlaceholders("\\${A}", env), "${A}");
	});
});

// `pnpmNpmrcPlaceholders.hostile.test.ts` holds that each of these is linear in its length.
describe("pnpmNpmrc placeholders on hostile input", () => {
	const size = 200_000;

	it("a run of ${{ is unexpanded", () => {
		const input = "${{".repeat(Math.floor(size / 3));
		assert.strictEqual(expandPlaceholders(input, env), input);
		assert.isFalse(hasPlaceholder(input));
	});

	it("a long backslash run before an unclosed ${ is unexpanded", () => {
		const input = "\\".repeat(size) + "${";
		assert.strictEqual(expandPlaceholders(input, env), input);
		assert.isFalse(hasPlaceholder(input));
	});

	it("a long backslash run before a closed placeholder halves the run", () => {
		const input = "\\".repeat(size) + "${A}";
		assert.strictEqual(expandPlaceholders(input, env), `${"\\".repeat(size / 2)}x`);
		assert.isTrue(hasPlaceholder(input));
	});

	it("an opener followed by a long body with no closer is unexpanded", () => {
		const input = `\${${"a".repeat(size)}`;
		assert.strictEqual(expandPlaceholders(input, env), input);
		assert.isFalse(hasPlaceholder(input));
	});

	it("many empty placeholders then a closed one expand only the closed one", () => {
		const empties = "${}".repeat(Math.floor(size / 3));
		assert.strictEqual(expandPlaceholders(`${empties}\${A}`, env), `${empties}x`);
	});
});
