// Pins the differential runner's named exception for minimatch 11.0.5's row-merge
// `pattern is too long` throw (see `support/oracle.ts`): it must fire on the
// patterns that trigger it and on nothing ordinary, and it may excuse only the
// divergence kind where the engine accepts what the oracle refuses.

import { assert, describe, it } from "@effect/vitest";
import { Minimatch } from "../src/internal/minimatch.js";
import { EXCEPTION_KINDS, oracleRowMergeTooLong } from "./support/oracle.js";

describe("oracleRowMergeTooLong", () => {
	it("fires on patterns the oracle refuses as too long while the engine compiles them", () => {
		for (const pattern of ["{x,{0..120}}[a-c]{0..199}.hidden\\a", "[!a]{x,{0..120}}?(a|b){0..199}//"]) {
			const opts = { platform: "posix" } as const;
			assert.isTrue(oracleRowMergeTooLong(pattern, opts), pattern);
			assert.doesNotThrow(() => new Minimatch(pattern, opts).match("abc"));
		}
	});

	it("does not fire on ordinary patterns", () => {
		for (const pattern of ["*.ts", "a/{b,c}/**", "{0..199}", "b**{Z..a}", "[unclosed"]) {
			assert.isFalse(oracleRowMergeTooLong(pattern, { platform: "posix" }), pattern);
		}
	});

	it("excuses only the divergence kind where the oracle throws and the engine accepts", () => {
		assert.deepStrictEqual(EXCEPTION_KINDS.oracleRowMergeTooLong, ["oracle-throws-engine-accepts"]);
		assert.deepStrictEqual(EXCEPTION_KINDS.bracketsAcrossAlternatives, ["match"]);
	});
});
