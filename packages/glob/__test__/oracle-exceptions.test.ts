// Pins the differential runner's named exceptions for the oracle's refusals
// (see `support/oracle.ts`): minimatch 11.0.8's row-merge `pattern is too long`
// throw and its `pattern has too many extglobs` throw. Each must fire on the
// patterns that trigger it and on nothing ordinary, and may excuse only the
// divergence kind where the engine accepts what the oracle refuses.

import { assert, describe, it } from "@effect/vitest";
import { Minimatch as OracleMinimatch, minimatch as oracle } from "minimatch";
import { Minimatch } from "../src/internal/minimatch.js";
import { EXCEPTION_KINDS, oracleOpts, oracleRowMergeTooLong, oracleTooManyExtglobs } from "./support/oracle.js";

const opts = { platform: "posix" } as const;

describe("oracleRowMergeTooLong", () => {
	it("fires on patterns the oracle refuses as too long while the engine compiles them", () => {
		for (const pattern of ["{x,{0..120}}[a-c]{0..199}.hidden\\a"]) {
			assert.isTrue(oracleRowMergeTooLong(pattern, opts), pattern);
			assert.doesNotThrow(() => new Minimatch(pattern, opts).match("abc"));
		}
	});

	it("does not fire where 11.0.8 skips the merge, and there the engine agrees with the oracle", () => {
		// 11.0.5 refused this one; 11.0.8 skips a merge of more than 256 extglobs
		const pattern = "[!a]{x,{0..120}}?(a|b){0..199}//";
		assert.isFalse(oracleRowMergeTooLong(pattern, opts));
		for (const candidate of ["bx5//", "bxa5//", "b75b199//", "ax5//", "bx5", "b121a5//"]) {
			assert.strictEqual(
				new Minimatch(pattern, opts).match(candidate),
				oracle(candidate, pattern, oracleOpts(opts)),
				candidate,
			);
		}
	});

	it("does not fire on ordinary patterns", () => {
		for (const pattern of ["*.ts", "a/{b,c}/**", "{0..199}", "b**{Z..a}", "[unclosed"]) {
			assert.isFalse(oracleRowMergeTooLong(pattern, opts), pattern);
		}
	});
});

describe("oracleTooManyExtglobs", () => {
	it("fires on a portion with more than 256 extglob openers, which the engine answers", () => {
		for (const pattern of ["?(a)".repeat(257), `x/${"*(a)".repeat(300)}/y`, `[${"*(".repeat(257)}]`]) {
			assert.isTrue(oracleTooManyExtglobs(pattern, opts), pattern.slice(0, 20));
			assert.throws(() => new OracleMinimatch(pattern, oracleOpts(opts)), /too many extglobs/);
			assert.doesNotThrow(() => new Minimatch(pattern, opts).match("a"));
		}
	});

	it("does not fire at the limit, under noext, or on ordinary patterns", () => {
		assert.isFalse(oracleTooManyExtglobs("?(a)".repeat(256), opts));
		assert.isFalse(oracleTooManyExtglobs("?(a)".repeat(300), { ...opts, noext: true }));
		assert.isFalse(oracleTooManyExtglobs("\\?(a)".repeat(300), opts));
		for (const pattern of ["*.ts", "+(a|b)/**", "!(x)", "{0..199}"]) {
			assert.isFalse(oracleTooManyExtglobs(pattern, opts), pattern);
		}
	});
});

describe("EXCEPTION_KINDS", () => {
	it("excuses only the divergence kind where the oracle throws and the engine accepts", () => {
		assert.deepStrictEqual(EXCEPTION_KINDS.oracleRowMergeTooLong, ["oracle-throws-engine-accepts"]);
		assert.deepStrictEqual(EXCEPTION_KINDS.oracleTooManyExtglobs, ["oracle-throws-engine-accepts"]);
		assert.deepStrictEqual(EXCEPTION_KINDS.bracketsAcrossAlternatives, ["match"]);
	});
});
