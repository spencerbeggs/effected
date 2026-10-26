import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { AppDirs, AppDirsSegmentError } from "../src/index.js";

/**
 * The persisted contract: vitest-agent's `normalizeWorkspaceKey`
 * (`packages/sdk/src/utils/normalize-workspace-key.ts:28`), copied verbatim as
 * the oracle. Every key it ever stored must map to the same segment.
 */
const oracle = (name: string): string =>
	name
		.replaceAll("/", "__")
		.replace(/[^A-Za-z0-9._@-]/g, "_")
		.replace(/_{3,}/g, "__");

const ok = (name: string): string => {
	const result = AppDirs.segment(name);
	assert.isTrue(Result.isSuccess(result), `expected ${JSON.stringify(name)} to map`);
	return Result.isSuccess(result) ? result.success : "";
};

describe("AppDirs.segment", () => {
	it("reproduces the reference table", () => {
		const table: ReadonlyArray<readonly [string, string]> = [
			["my-app", "my-app"],
			["vitest-agent-reporter", "vitest-agent-reporter"],
			["ALPHA_NUM-123", "ALPHA_NUM-123"],
			["foo.bar", "foo.bar"],
			["@scoped", "@scoped"],
			["@org/pkg", "@org__pkg"],
			["@spencerbeggs/vitest-agent-reporter", "@spencerbeggs__vitest-agent-reporter"],
			["a/b/c", "a__b__c"],
			['foo:bar*baz?qux"a<b>c|d\\e', "foo_bar_baz_qux_a_b_c_d_e"],
			["foo bar\tbaz\nqux", "foo_bar_baz_qux"],
			["a___b", "a__b"],
			["a______b", "a__b"],
			["a__b", "a__b"],
			// Per code unit, not per code point: an astral character is two `_`.
			["a\u{1F600}b", "a__b"],
			["café", "caf_"],
			["a//b", "a__b"],
			["...", "..."],
		];
		for (const [input, expected] of table) {
			assert.strictEqual(ok(input), expected, JSON.stringify(input));
			assert.strictEqual(oracle(input), expected, `oracle ${JSON.stringify(input)}`);
		}
	});

	it("agrees with the reference mapping on generated names", () => {
		const pool = ["a", "Z", "0", ".", "_", "-", "@", "/", "\\", " ", ":", "é", "\u{1F600}", "٣", "\n"];
		let seed = 0x2f6b;
		const next = () => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed;
		};
		for (let n = 0; n < 2000; n++) {
			let name = "";
			for (let length = next() % 12; length > 0; length--) name += pool[next() % pool.length];
			const expected = oracle(name);
			const result = AppDirs.segment(name);
			if (expected === "" || expected === "." || expected === "..") {
				assert.isTrue(Result.isFailure(result), JSON.stringify(name));
			} else {
				assert.deepStrictEqual(result, Result.succeed(expected), JSON.stringify(name));
				assert.match(expected, /^[A-Za-z0-9._@-]+$/);
				assert.notInclude(expected, "___");
			}
		}
	});

	it("refuses the results that name no child, typed", () => {
		const cases: ReadonlyArray<readonly [string, AppDirsSegmentError["reason"]]> = [
			["", "empty"],
			[".", "dot"],
			["..", "dot-dot"],
		];
		for (const [input, reason] of cases) {
			const result = AppDirs.segment(input);
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.instanceOf(result.failure, AppDirsSegmentError);
				assert.strictEqual(result.failure.reason, reason);
				assert.strictEqual(result.failure.input, input);
			}
		}
		// The control: a name that only contains dots among other characters maps.
		assert.strictEqual(ok("..a"), "..a");
	});

	it("names the offending input in its message", () => {
		const result = AppDirs.segment("..");
		assert.isTrue(Result.isFailure(result) && result.failure.message.includes('".."'));
	});
});
