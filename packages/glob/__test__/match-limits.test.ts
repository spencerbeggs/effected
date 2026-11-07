// The bounds on matching: the maxGlobstarRecursion ceiling and the stack
// overflow answer in GlobPattern.matches (#1242), and braceExpandMax as the
// caller's lever against a hostile brace pattern (#1241).

import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { GlobPattern, GlobPatternError, GlobPatternOptions } from "../src/index.js";

// `n` body sections between the first and last `**`, and a candidate that
// walks every one of them.
const sections = (n: number): { readonly pattern: string; readonly candidate: string } => ({
	pattern: `**/${"a/**/".repeat(n)}b`,
	candidate: `${"a/".repeat(n)}b`,
});

const atCeiling = GlobPatternOptions.make({ maxGlobstarRecursion: 1000 });

describe("maxGlobstarRecursion ceiling", () => {
	it("accepts the ceiling and rejects one past it as a schema error", () => {
		assert.strictEqual(atCeiling.maxGlobstarRecursion, 1000);
		assert.throws(() => GlobPatternOptions.make({ maxGlobstarRecursion: 1001 }));
		const decoded = Schema.decodeUnknownResult(GlobPatternOptions)({ maxGlobstarRecursion: 1001 });
		assert.isTrue(Result.isFailure(decoded));
		if (Result.isFailure(decoded)) assert.strictEqual(decoded.failure._tag, "SchemaError");
		assert.isTrue(Result.isSuccess(Schema.decodeUnknownResult(GlobPatternOptions)({ maxGlobstarRecursion: 1000 })));
	});

	it.effect("answers with a boolean for thousands of ** sections at the ceiling", () =>
		Effect.gen(function* () {
			// 1,000 sections fit the cap and match; 5,000 and 13,000 (near the 64 KB
			// pattern cap) walk past it and answer the documented false negative.
			const fits = sections(1000);
			assert.isTrue((yield* GlobPattern.compile(fits.pattern, atCeiling)).matches(fits.candidate));
			for (const n of [5000, 13_000]) {
				const { pattern, candidate } = sections(n);
				const compiled = yield* GlobPattern.compile(pattern, atCeiling);
				assert.isFalse(compiled.matches(candidate));
				assert.isFalse(compiled.matches(`${candidate}/c`));
			}
		}),
	);
});

describe("GlobPattern.matches under a stack overflow", () => {
	// Call matches at ever deeper points of the caller's own stack until the
	// caller itself overflows. Near the end the engine runs out of stack before
	// the caller does; matches must answer there, not throw.
	const sweep = (compiled: GlobPattern, candidate: string): ReadonlyArray<string> => {
		const outcomes: Array<string> = [];
		const descend = (depth: number): void => {
			if (depth % 25 === 0) {
				let outcome: string;
				try {
					outcome = compiled.matches(candidate) ? "true" : "false";
				} catch {
					outcome = "threw";
				}
				outcomes.push(outcome);
			}
			descend(depth + 1);
		};
		try {
			descend(0);
		} catch {
			// The caller's own overflow ends the sweep.
		}
		return outcomes;
	};

	it.effect("answers the cap's false negative instead of throwing RangeError", () =>
		Effect.gen(function* () {
			const { pattern, candidate } = sections(1000);
			const outcomes = sweep(yield* GlobPattern.compile(pattern, atCeiling), candidate);
			// Control: with stack to spare the pattern matches.
			assert.strictEqual(outcomes[0], "true");
			// The engine did overflow somewhere in the sweep, and was answered.
			assert.include(outcomes, "false");
			// Only the last calls, where the caller cannot even enter matches, may throw.
			const firstThrow = outcomes.indexOf("threw");
			if (firstThrow !== -1) assert.isAtLeast(firstThrow, outcomes.length - 2);
		}),
	);

	it.effect("answers true for a negated pattern, as the cap does", () =>
		Effect.gen(function* () {
			const { pattern, candidate } = sections(1000);
			const outcomes = sweep(yield* GlobPattern.compile(`!${pattern}`, atCeiling), candidate);
			assert.strictEqual(outcomes[0], "false");
			assert.include(outcomes, "true");
		}),
	);
});

describe("braceExpandMax against a hostile brace pattern", () => {
	const hostile = "**/a/**/*{0..999}*";

	it.effect("fails fast at compile when lowered", () =>
		Effect.gen(function* () {
			// Control: under the default budget the pattern compiles (and is slow to match).
			assert.isTrue(Result.isSuccess(GlobPattern.compileResult(hostile)));
			const e = yield* Effect.flip(GlobPattern.compile(hostile, GlobPatternOptions.make({ braceExpandMax: 100 })));
			assert.instanceOf(e, GlobPatternError);
			assert.strictEqual(e.reason, "ExpansionBudgetExceeded");
			assert.strictEqual(e.limit, 100);
		}),
	);
});
