// The bounds on matching: the maxGlobstarRecursion ceiling and the stack
// overflow answer in GlobPattern.matches (#1242), and braceExpandMax as the
// caller's lever against a hostile brace pattern (#1241).

import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { minimatch } from "minimatch";
import { GlobPattern, GlobPatternError, GlobPatternOptions, GlobSet } from "../src/index.js";

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

describe("optimizationLevel 2 against a hostile **/.. pattern (GHSA-g3hv-75wg-m249)", () => {
	it("fails typed at compile, and the pattern stays valid at default options", () => {
		const hostile = `${"**/../a/b/".repeat(17)}z`;
		assert.isTrue(Result.isSuccess(GlobPattern.compileResult(hostile)));
		const compiled = GlobPattern.compileResult(hostile, GlobPatternOptions.make({ optimizationLevel: 2 }));
		assert.isTrue(Result.isFailure(compiled));
		if (Result.isFailure(compiled)) {
			assert.instanceOf(compiled.failure, GlobPatternError);
			assert.strictEqual(compiled.failure.reason, "ExpansionBudgetExceeded");
			assert.strictEqual(compiled.failure.limit, 1_000_000);
		}
	});
});

describe("a portion whose regexp the runtime rejects", () => {
	// A POSIX class turns on the regexp u flag, and under it the escapes the
	// engine writes for `,`, `#`, a space or `-` are syntax errors. That is a
	// typed failure, never a raw SyntaxError.
	const shapes = ["[[:alpha:]]\\{a,b}", "[[:alpha:]],", "[[:alpha:]]#", "[[:alpha:]] a", "[[:alpha:]]-"];

	it("fails typed with InvalidRegExp, on every construction path", () => {
		for (const source of shapes) {
			const compiled = GlobPattern.compileResult(source);
			assert.isTrue(Result.isFailure(compiled), source);
			if (Result.isFailure(compiled)) {
				assert.instanceOf(compiled.failure, GlobPatternError);
				assert.strictEqual(compiled.failure.reason, "InvalidRegExp", source);
				assert.strictEqual(compiled.failure.pattern, source);
			}
			assert.isTrue(Result.isFailure(Schema.decodeUnknownResult(GlobPattern.FromString)(source)), source);
			const viaEffect = Effect.runSync(Effect.result(GlobPattern.compile(source)));
			assert.isTrue(Result.isFailure(viaEffect), source);
			const set = GlobSet.compileResult(["a/**", `!${source}`]);
			assert.isTrue(Result.isFailure(set) && set.failure.reason === "InvalidRegExp", source);
		}
	});

	it("compiles the same class in a portion with an extglob, which builds no regexp", () => {
		// The walk answers an extglob portion, so its loose `,` never reaches a
		// u-flag regexp: it compiles and matches as minimatch 11 does.
		for (const [source, path] of [
			["x*(a)[[:alpha:]],", "xab,"],
			["x+(a)[[:alpha:]]-", "xab-"],
			["x!(a)[[:alpha:]] ", "xb "],
		] as const) {
			const compiled = GlobPattern.compileResult(source);
			assert.isTrue(Result.isSuccess(compiled), source);
			if (Result.isSuccess(compiled)) {
				assert.strictEqual(compiled.success.matches(path), minimatch(path, source), `${source} vs ${path}`);
				assert.isTrue(compiled.success.matches(path), `${source} vs ${path}`);
			}
		}
	});

	it("still compiles the class beside literals that need no escape, and matches it", () => {
		const compiled = GlobPattern.compileResult("[[:alpha:]]a*");
		assert.isTrue(Result.isSuccess(compiled));
		if (Result.isSuccess(compiled)) {
			assert.isTrue(compiled.success.matches("xab"));
			assert.isFalse(compiled.success.matches("1ab"));
		}
	});
});
