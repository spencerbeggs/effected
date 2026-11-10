// npm's `workspaces` pattern rules (`@npmcli/map-workspaces` 5), the one home
// the kit reads them from (#1286). The rules table is the reading real npm
// records: each row's answer is what `@effected/lockfiles` decided for the same
// field before the rules moved here, and those decisions are pinned against
// real npm 11 output in lockfiles' fixtures. The hostile-input guards below
// moved with the matcher; lockfiles keeps its end-to-end ones over
// `Lockfile.parse`.

import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { Minimatch } from "../../glob/node_modules/minimatch/dist/esm/index.js";
import { NpmWorkspacePatterns, NpmWorkspacePatternsError } from "../src/index.js";
import { braceAlternativeCount, compileGlob, stripTrailingDot } from "../src/internal/workspacePatterns.js";

/** The directories every row is asked about. */
const DIRECTORIES = ["packages/a", "packages/b", "packages/.hidden", "apps/c", "packages/deep/d"] as const;

/** The directories `field` declares as workspaces, or the failure's reason. */
const decide = (field: unknown): ReadonlyArray<string> | string => {
	const matcher = NpmWorkspacePatterns.matcherResult(field);
	return Result.isSuccess(matcher)
		? DIRECTORIES.filter((directory) => matcher.success(directory))
		: matcher.failure.reason;
};

const rows: ReadonlyArray<readonly [unknown, ReadonlyArray<string>]> = [
	[["packages/*"], ["packages/a", "packages/b"]],
	[["packages/*", "!packages/a"], ["packages/b"]],
	// Ordered negation: a later positive the negation matches cancels it.
	[
		["packages/*", "!packages/a", "packages/a"],
		["packages/a", "packages/b"],
	],
	[["apps/c", "!apps/*", "apps/c"], ["apps/c"]],
	[["!packages/a", "packages/*"], ["packages/b"]],
	[["./packages/*"], ["packages/a", "packages/b"]],
	[["/packages/*"], ["packages/a", "packages/b"]],
	// A positive matches directories, so a trailing slash is the same pattern.
	[["packages/*/"], ["packages/a", "packages/b"]],
	[["packages/a/."], ["packages/a"]],
	// An even run of bangs is dropped: a positive.
	[["!!packages/a"], ["packages/a"]],
	[["!!!packages/a", "packages/*"], ["packages/b"]],
	[["packages/**"], ["packages/a", "packages/b", "packages/deep/d"]],
	[
		["packages/**", "!packages/deep/**"],
		["packages/a", "packages/b"],
	],
	// A backslash in a positive is a separator.
	[["packages\\a"], ["packages/a"]],
	// A negation ignores with or without a trailing slash.
	[["packages/*", "!packages/a/"], ["packages/b"]],
	[{ packages: ["apps/*"] }, ["apps/c"]],
	// A positive takes no dot; a negation is matched with `dot`, but the positive already left it out.
	[
		["packages/*", "!**/.hidden"],
		["packages/a", "packages/b"],
	],
	[["packages/.*"], ["packages/.hidden"]],
	[["packages/{a,b}"], ["packages/a", "packages/b"]],
	[["packages/*", "!packages/{a,b}"], []],
	[["**"], ["packages/a", "packages/b", "apps/c", "packages/deep/d"]],
	// Any other declaration declares nothing; a non-string entry is skipped.
	[undefined, []],
	["packages/*", []],
	[{ packages: "packages/*" }, []],
	[["packages/a", 7, null], ["packages/a"]],
];

describe("NpmWorkspacePatterns.matcherResult", () => {
	it("reads every row the way npm's map-workspaces reads it", () => {
		const decided = rows.map(([field]) => [field, decide(field)]);
		assert.deepStrictEqual(
			decided,
			rows.map(([field, expected]) => [field, [...expected]]),
		);
	});

	it("never takes the root, nor anything under node_modules", () => {
		const matcher = Result.getOrThrow(NpmWorkspacePatterns.matcherResult(["**"]));
		assert.isFalse(matcher(""));
		assert.isFalse(matcher("packages/node_modules/x"));
		assert.isTrue(matcher("packages/x"));
	});

	it("fails typed past each ceiling, naming the figures", () => {
		const failure = (field: unknown): NpmWorkspacePatternsError => {
			const matcher = NpmWorkspacePatterns.matcherResult(field);
			if (Result.isSuccess(matcher)) return assert.fail(`expected ${JSON.stringify(field).slice(0, 40)} to fail`);
			assert.instanceOf(matcher.failure, NpmWorkspacePatternsError);
			return matcher.failure;
		};
		const range = (n: number, at: (i: number) => string) => Array.from({ length: n }, (_, i) => at(i));
		const many = failure(range(1001, (i) => `pkg${i}`));
		assert.deepInclude(many, { reason: "tooManyPatterns", actual: 1001, limit: 1000 });
		const wild = failure(range(33, (i) => `pkg${i}/*`));
		assert.deepInclude(wild, { reason: "tooManyWildcards", actual: 33, limit: 32 });
		const long = failure(["packages/*", `p/*${"a".repeat(254)}`]);
		assert.deepInclude(long, { reason: "patternTooLong", index: 1, actual: 257, limit: 256 });
		const exact = failure(["**", ...range(30, (i) => `!n${i}/{a,b,c,d,e,f,g,h}/**`), "!m/{a..p}/**"]);
		assert.deepInclude(exact, { reason: "tooManyAlternatives", actual: 257, limit: 256, count: "exact" });
		const stopped = failure(["**", `!${"{a,b}".repeat(48)}`]);
		assert.deepInclude(stopped, { reason: "tooManyAlternatives", count: "stopped" });
		const ranged = failure(["**", "!n/{0..999}"]);
		assert.deepInclude(ranged, { reason: "tooManyAlternatives", count: "inexact" });
		const unbounded = failure(["p/**", `q/{${"9".repeat(20)}..${"9".repeat(20)}}`]);
		assert.deepInclude(unbounded, { reason: "tooManyAlternatives", count: "unbounded" });
		// Controls: every ceiling exactly met reads.
		assert.isTrue(Result.isSuccess(NpmWorkspacePatterns.matcherResult(range(1000, (i) => `pkg${i}`))));
		assert.isTrue(
			Result.isSuccess(
				NpmWorkspacePatterns.matcherResult([...range(32, (i) => `pkg${i}/*`), ...range(968, (i) => `lit/${i}`)]),
			),
		);
		assert.isTrue(Result.isSuccess(NpmWorkspacePatterns.matcherResult(["packages/*", `p/*${"a".repeat(253)}`])));
	});

	it("the moved weights: a range of 100 values or more weighs its values, and a hostile sequence never slips", () => {
		assert.strictEqual(braceAlternativeCount("q/{0..199}"), 200);
		assert.strictEqual(braceAlternativeCount("q/{a,b}/{0..199}"), 400);
		assert.strictEqual(braceAlternativeCount("q/{1..99}{a,b}"), 198);
		const nines = "9".repeat(400);
		const eights = `${"9".repeat(399)}8`;
		for (const shape of [
			`q/{${nines}..${nines}}`,
			`q/{${eights}..${nines}}`,
			`q/{1..${nines}}`,
			`q/{-${nines}..${nines}}`,
			`q/{0..9007199254740992}`,
		]) {
			const weight = braceAlternativeCount(shape);
			assert.isAbove(weight, 256, shape.slice(0, 12));
			assert.isFalse(Number.isNaN(weight), shape.slice(0, 12));
		}
		assert.strictEqual(braceAlternativeCount(`q/{1..9007199254740991}`), 9_007_199_254_740_991);
		assert.isAbove(braceAlternativeCount("{a,b}".repeat(200)), 256);
	});

	it("the brace weight is the count of alternatives the engine matches, never below it", () => {
		// Checked against minimatch 11.0.5's own expansion, the one the glob
		// engine follows (from @effected/glob's oracle devDependency): its
		// `globSet`, the distinct alternatives after a range of 100 or more
		// values is kept whole. Under-counting would let a pattern past the
		// ceiling, so a weight is equal to it with no kept range, at or past it
		// with one, and past the budget where the oracle's expansion runs to its
		// own cap.
		const oracle = (shape: string): number => new Minimatch(shape, { nocomment: true, nonegate: true }).globSet.length;
		const shapes = [
			"p/{a,b}",
			"{a,b}/{c,d}",
			"p/{a,{b,c}}",
			"{a},b}",
			"{a,b}}",
			"{{a,b},{c,d}}",
			"x{1..9}",
			"x{1..9..2}",
			"x{a..e}",
			"x{-3..3}",
			"x{01..10}",
			"{1..3}{a,b}",
			"\\{a,b}",
			"{a\\,b,c}",
			"{a,b\\}",
			"{a,,b}",
			"{1..99}{a,b}",
			"{a,b}{c,d}{e,f}{g,h}{i,j}",
			"p/{a,b,c,d,e,f,g,h}{a,b,c,d,e,f,g,h}",
			"{a,{b,{c,{d,e}}}}",
			"a{b,c{d,e}f}g{h,i}",
			"{x,y}{1..3}{a..c}",
			"}{a,b}{",
			"{{a,b}",
			"{a,b{c,d}",
			"{a,b}{c,d{e,f}}{g,h}",
			"#{a,b}",
		];
		for (const shape of shapes) assert.strictEqual(braceAlternativeCount(shape), oracle(shape), shape);
		// A range of 100 values or more is one alternative to the engine, weighed by its values: never below it.
		assert.strictEqual(oracle("{1..100}"), 1);
		assert.strictEqual(braceAlternativeCount("{1..100}"), 100);
		// The over-refusal the upper bound made is gone: these weighed 9,801 and 7,776.
		assert.strictEqual(braceAlternativeCount("{1..99}{a,b}"), 198);
		assert.strictEqual(braceAlternativeCount("{a,b}{c,d}{e,f}{g,h}{i,j}"), 32);
		for (const shape of [`q/{${"9".repeat(400)}..${"9".repeat(400)}}`, `q/{${"9".repeat(399)}8..${"9".repeat(400)}}`])
			assert.isAbove(braceAlternativeCount(shape), 256, shape.slice(0, 12));
		// A deterministic sweep over a small brace alphabet: every string of up
		// to six characters from `{ } , a \\ 1 .` (7^6 + … ≈ 137,000 strings).
		const alphabet = ["{", "}", ",", "a", "\\", "1", "."];
		let checked = 0;
		const sweep = (prefix: string, depth: number): void => {
			if (prefix !== "") {
				checked += 1;
				const real = oracle(prefix);
				if (braceAlternativeCount(prefix) !== real)
					assert.fail(
						`${JSON.stringify(prefix)} weighs ${braceAlternativeCount(prefix)}, not its ${real} alternatives`,
					);
			}
			if (depth === 0) return;
			for (const character of alphabet) sweep(prefix + character, depth - 1);
		};
		sweep("", 6);
		assert.isAbove(checked, 100_000);
	});

	it("a pattern glob will not compile maps to a typed uncompilable failure naming its index and glob's reason", () => {
		// The ceilings now refuse every pattern glob is known to reject before it
		// is compiled, so the compile failure is checked at the mapping itself.
		const compiled = compileGlob(7, `${"a".repeat(65_537)}*`);
		assert.isTrue(Result.isFailure(compiled));
		if (!Result.isFailure(compiled)) return;
		const failure = compiled.failure;
		assert.instanceOf(failure, NpmWorkspacePatternsError);
		assert.strictEqual(failure.reason, "uncompilable");
		assert.strictEqual(failure.index, 7);
		assert.strictEqual((failure.cause as { readonly reason?: string }).reason, "PatternTooLong");
		assert.strictEqual(failure.limit, (failure.cause as { readonly limit: number }).limit);
		// Control: a pattern glob reads compiles.
		assert.isTrue(Result.isSuccess(compileGlob(0, "packages/*")));
	});

	it("a trailing /. run is dropped exactly as the regex it replaced dropped it", () => {
		// The regex read the run in quadratic time; the walk must give the same
		// answer on every string, so it is checked against the regex on every
		// string of up to nine characters over `/ . a` (29,523 strings), where
		// the regex is still fast.
		const byRegex = (pattern: string): string => {
			const stripped = pattern.replace(/(?:\/\.)+\/?$/, "");
			return stripped === "" ? pattern : stripped;
		};
		const alphabet = ["/", ".", "a"];
		let checked = 0;
		const sweep = (prefix: string, depth: number): void => {
			checked += 1;
			if (stripTrailingDot(prefix) !== byRegex(prefix)) {
				assert.fail(`${JSON.stringify(prefix)}: ${stripTrailingDot(prefix)} vs ${byRegex(prefix)}`);
			}
			if (depth === 0) return;
			for (const character of alphabet) sweep(prefix + character, depth - 1);
		};
		sweep("", 9);
		assert.strictEqual(checked, 29_524);
		assert.strictEqual(stripTrailingDot("packages/a/./."), "packages/a");
		assert.strictEqual(stripTrailingDot("packages/*/./"), "packages/*");
		assert.strictEqual(stripTrailingDot("packages/a/.."), "packages/a/..");
	});
});
