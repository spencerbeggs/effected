// Task 4, the engine compliance gate (part 1): a deterministic behavioral
// fixture table across every dialect feature category, where EVERY row asserts
// both the expected boolean AND agreement with the real upstream minimatch
// 11.0.9 (the exact-pinned oracle devDependency); plus oracle property tests
// sampling the full dialect and option surface.
//
// Rule of the gate: if the vendored engine disagrees with the oracle, fix the
// engine, never the expectation — except where a row exercises the documented
// deviations (typed budget exhaustion; explicit platform), which are tested
// separately and excluded from oracle comparison.

import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { Minimatch as OracleMinimatch, minimatch as oracle } from "minimatch";
import { GuardExceeded } from "../src/internal/limits.js";
import type { EngineOptions } from "../src/internal/minimatch.js";
import { Minimatch, escape as escapePattern, unescape as unescapePattern } from "../src/internal/minimatch.js";
import { bracketsAcrossAlternatives, oracleAnswer, oracleOpts, oracleTooManyExtglobs } from "./support/oracle.js";

type Row = readonly [pattern: string, candidate: string, expected: boolean, options?: EngineOptions];

const table: ReadonlyArray<Row> = [
	// ── star / qmark segment scoping ──────────────────────────────────────
	["*", "abc", true],
	["*", ".abc", false],
	["*", "a/b", false],
	["*", "", false],
	["a*", "abc", true],
	["a*", "bac", false],
	["*test*", "vitest", true],
	["*test*", "vite", false],
	["@scope/*", "somepkg", false],
	["@scope/*", "@scope/x", true],
	["a?c", "abc", true],
	["a?c", "a/c", false],
	["a?c", "ac", false],
	["???", "abc", true],
	["???", "ab", false],
	// ── dots ──────────────────────────────────────────────────────────────
	[".*", ".abc", true],
	["*", ".abc", true, { dot: true }],
	["*", ".", false, { dot: true }],
	["*", "..", false, { dot: true }],
	["a/*/b", "a/.x/b", false],
	["a/*/b", "a/.x/b", true, { dot: true }],
	// ── globstar (the #62 inversion class) ────────────────────────────────
	["packages/**", "packages/a", true],
	["packages/**", "packages/a/b", true],
	["packages/**", "other/a", false],
	["a/**/b", "a/b", true],
	["a/**/b", "a/x/b", true],
	["a/**/b", "a/x/y/b", true],
	["a/**/b", "a/x/y/c", false],
	["**", "a/b/c", true],
	["**", ".a/b", false],
	["**", ".a/b", true, { dot: true }],
	["a/**", "a/.b/c", false],
	["a/**", "a/.b/c", true, { dot: true }],
	["a/**/b/**/c", "a/x/b/y/c", true],
	["a/**/b/**/c", "a/b/c", true],
	["a/**/b/**/c", "a/c", false],
	// ── negation / flipNegate / nonegate ──────────────────────────────────
	["!a/*", "b/x", true],
	["!a/*", "a/x", false],
	["!a/*", "a/x", true, { flipNegate: true }],
	["!a/*", "b/x", false, { flipNegate: true }],
	["!!a", "a", true],
	["!!!a", "a", false],
	["!a", "!a", true, { nonegate: true }],
	["!a", "b", false, { nonegate: true }],
	// ── comments / nocomment ──────────────────────────────────────────────
	["#a", "#a", false],
	["#a", "anything", false],
	["#a", "#a", true, { nocomment: true }],
	// ── empty pattern ─────────────────────────────────────────────────────
	["", "", true],
	["", "a", false],
	// ── braces incl. sequences; nobrace ───────────────────────────────────
	["a{b,c}d", "abd", true],
	["a{b,c}d", "acd", true],
	["a{b,c}d", "aed", false],
	["x{1..3}", "x2", true],
	["x{1..3}", "x4", false],
	["{a,b}/*", "a/x", true],
	["{a,b}/*", "c/x", false],
	["a{b,c}d", "a{b,c}d", true, { nobrace: true }],
	["a{b,c}d", "abd", false, { nobrace: true }],
	// ── extglobs, all five types; noext ───────────────────────────────────
	["+(a|b)c", "aabc", true],
	["+(a|b)c", "c", false],
	["?(a)b", "b", true],
	["?(a)b", "ab", true],
	["?(a)b", "aab", false],
	// an empty path portion only matches an empty pattern portion (minimatch 11)
	["*(a|b)", "", false],
	["*(a|b)", "abab", true],
	["@(a|b)", "a", true],
	["@(a|b)", "ab", false],
	// NOTE: a LEADING !( is whole-pattern negation, not an extglob — parseNegate
	// strips the bang before the AST ever sees it (oracle-confirmed; the sketch
	// that assumed extglob semantics here was wrong). The nonegate rows exercise
	// the actual !() extglob at the pattern start.
	["!(a)", "b", true],
	["!(a)", "a", true],
	["!(a)", "(a)", false],
	["!(a)", "a", false, { nonegate: true }],
	["!(a)", "b", true, { nonegate: true }],
	["a!(b)c", "axc", true],
	["a!(b)c", "abc", false],
	["+(a)", "+(a)", true, { noext: true }],
	["+(a)", "a", false, { noext: true }],
	// ── classes incl. POSIX ───────────────────────────────────────────────
	["[abc]", "b", true],
	["[abc]", "d", false],
	["[a-c]x", "bx", true],
	["[a-c]x", "dx", false],
	["[!abc]", "d", true],
	["[!abc]", "b", false],
	["[[:digit:]]", "5", true],
	["[[:digit:]]", "x", false],
	["[[:alpha:]][[:digit:]]", "x5", true],
	// ── escaping / regex metachars ────────────────────────────────────────
	["libs/a.b+c/*", "libs/a.b+c/x", true],
	["libs/a.b+c/*", "libs/aXbYc/x", false],
	["\\*", "*", true],
	["\\*", "x", false],
	["a\\?b", "a?b", true],
	["a\\?b", "axb", false],
	// ── matchBase ─────────────────────────────────────────────────────────
	["a?b", "/xyz/123/acb", true, { matchBase: true }],
	["a?b", "/xyz/acb/123", false, { matchBase: true }],
	["a/b", "/x/a/b", false, { matchBase: true }],
	// ── nocase / nocaseMagicOnly ──────────────────────────────────────────
	["AbC", "abc", true, { nocase: true }],
	["AbC", "abc", false],
	["A*C", "abc", true, { nocase: true }],
	["AbC", "abc", false, { nocase: true, nocaseMagicOnly: true }],
	["A*C", "abc", true, { nocase: true, nocaseMagicOnly: true }],
	// ── partial ───────────────────────────────────────────────────────────
	["/a/b/*/d", "/a/b", true, { partial: true }],
	["/", "/", true, { partial: true }],
	["/a/b", "/x", false, { partial: true }],
	// ── multiple slashes / preserveMultipleSlashes ────────────────────────
	["a//b", "a/b", true],
	["a//b", "a/b", false, { preserveMultipleSlashes: true }],
	["a//b", "a//b", true, { preserveMultipleSlashes: true }],
	// ── optimization levels over . and .. ─────────────────────────────────
	["a/b/../c", "a/c", true, { optimizationLevel: 2 }],
	["a/./b", "a/b", true, { optimizationLevel: 2 }],
	["a/b/../c", "a/c", true, { optimizationLevel: 1 }],
	// The **/.. rewrite needs TWO trailing portions (<pre>/**/../<p>/<p>/<rest>);
	// with one, .. stays literal and nothing matches it (oracle-confirmed — the
	// sketched single-portion row was wrong).
	["a/**/../b/c", "a/x/b/c", true, { optimizationLevel: 2 }],
	["a/**/../b", "a/x/b", false, { optimizationLevel: 2 }],
	["a/b", "a/b", true, { optimizationLevel: 0 }],
	["a/**/**/b", "a/x/b", true, { optimizationLevel: 0 }],
	// ── win32 behavior, explicit platform on BOTH engines ─────────────────
	["a/b", "a\\b", true, { platform: "win32" }],
	["a/b", "a\\b", false],
	["c:/x/*", "C:/x/y", true, { platform: "win32", nocase: true }],
	["//?/c:/x", "c:/x", true, { platform: "win32" }],
	["a\\*b", "a*b", false, { windowsPathsNoEscape: true, platform: "win32" }],
	["a\\*b", "a/xb", true, { windowsPathsNoEscape: true, platform: "win32" }],
	// ── noglobstar ────────────────────────────────────────────────────────
	["a/**/b", "a/x/y/b", false, { noglobstar: true }],
	["a/**/b", "a/x/b", true, { noglobstar: true }],
	// ── trailing-slash semantics ──────────────────────────────────────────
	["a/*", "a/b/", true],
	["a/b/", "a/b", false],
	["a/b/", "a/b/", true],
];

describe("engine compliance: behavioral table", () => {
	it("agrees with the expected outcome AND the oracle on every row", () => {
		for (const [pattern, candidate, expected, options] of table) {
			const opts: EngineOptions = { platform: "posix", ...options };
			const vendored = new Minimatch(pattern, opts).match(candidate);
			assert.strictEqual(vendored, expected, `expected: ${pattern} vs ${candidate} (${JSON.stringify(options)})`);
			assert.strictEqual(
				vendored,
				oracle(candidate, pattern, oracleOpts(opts)),
				`oracle disagrees: ${pattern} vs ${candidate} (${JSON.stringify(options)})`,
			);
		}
	});

	it("classifies magic like the oracle Minimatch", () => {
		const cases: ReadonlyArray<readonly [string, EngineOptions?]> = [
			["packages/*"],
			["packages/internal"],
			["{a,b}"],
			["{a,b}", { magicalBraces: true }],
			["[x]"],
			["a?b"],
			["a/**"],
			["plain/literal"],
		];
		for (const [pattern, options] of cases) {
			const opts: EngineOptions = { platform: "posix", ...options };
			assert.strictEqual(
				new Minimatch(pattern, opts).hasMagic(),
				new OracleMinimatch(pattern, oracleOpts(opts)).hasMagic(),
				`hasMagic: ${pattern} (${JSON.stringify(options)})`,
			);
		}
	});

	it("matches the union of brace alternatives, where the oracle's merge makes a class", () => {
		const opts: EngineOptions = { platform: "posix" };
		const pattern = "b**{Z..a}";
		const merged = new OracleMinimatch(pattern, oracleOpts(opts));
		assert.isTrue(bracketsAcrossAlternatives(merged));
		assert.isTrue(new Minimatch(pattern, opts).match(pattern));
		assert.isTrue(oracleAnswer(pattern, pattern, oracleOpts(opts)));
		// If the oracle stops losing `b**` here, this exception can go.
		assert.isFalse(merged.match(pattern));
		// a brace set with no bracket in it, or only closed classes, is judged by
		// the oracle as it is
		assert.isFalse(bracketsAcrossAlternatives(new OracleMinimatch("b*{x,y}", oracleOpts(opts))));
		// an empty alternative is judged as a row, not as the empty pattern
		assert.strictEqual(oracleAnswer("/", "{Z..a}", oracleOpts(opts)), new Minimatch("{Z..a}", opts).match("/"));
		assert.isTrue(oracleAnswer("/", "{Z..a}", oracleOpts(opts)));
		// and `/` under partial is true before the set or the negation is read
		const partialOpts = oracleOpts({ platform: "posix", partial: true, noext: true, dot: true });
		assert.isTrue(oracleAnswer("/", "!(*)/../{Z..a}/a", partialOpts));
		assert.isTrue(
			new Minimatch("!(*)/../{Z..a}/a", { platform: "posix", partial: true, noext: true, dot: true }).match("/"),
		);
		// balanced alternatives can hit the defect too
		const balanced = "b[a-#{Z..a}[.]";
		assert.isTrue(bracketsAcrossAlternatives(new OracleMinimatch(balanced, oracleOpts(opts))));
		assert.isTrue(new Minimatch(balanced, opts).match("ba"));
		assert.isTrue(oracleAnswer("ba", balanced, oracleOpts(opts)));
		assert.isFalse(new OracleMinimatch(balanced, oracleOpts(opts)).match("ba"));
		// a negated pattern takes the same rule, negated
		const negated = "!*{[,,]}";
		assert.isTrue(bracketsAcrossAlternatives(new OracleMinimatch(negated, oracleOpts(opts))));
		assert.isFalse(new Minimatch(negated, opts).match(negated));
		assert.isFalse(oracleAnswer(negated, negated, oracleOpts(opts)));
		assert.isTrue(oracle(negated, negated, oracleOpts(opts)));
	});

	it("keeps a numeric range of 100 or more values one portion, as the oracle does", () => {
		const opts: EngineOptions = { platform: "posix" };
		// one magic portion, not its numbers; below 100 values, an escaped range,
		// a $-prefixed shell variable and a stepped range are expanded
		for (const [pattern, magic] of [
			["{0..199}", true],
			["a{1..150}b", true],
			["x/{-50..60}/y", true],
			["{0..99}", true],
			["{1..99}", false],
			["{0..98}", false],
			["\\{0..199}", false],
			[`$${"{0..199}"}`, false],
			["{0..300..3}", false],
		] as const) {
			assert.strictEqual(new Minimatch(pattern, opts).hasMagic(), magic, pattern);
			assert.strictEqual(new OracleMinimatch(pattern, oracleOpts(opts)).hasMagic(), magic, `oracle: ${pattern}`);
		}
		for (const [pattern, candidate, expected] of [
			["{0..199}", "150", true],
			["{0..199}", "200", false],
			["{0..199}", "0150", false],
			["{000..199}", "050", true],
			["{000..199}", "50", false],
			["{-05..95}", "-05", true],
			["{-05..95}", "007", true],
			["{-150..-1}", "-100", true],
			["{-150..-1}", "0", false],
			["{199..0}", "42", true],
			["a{1..150}b", "a99b", true],
			["{0..199}-{0..199}", "7-198", true],
			["{0..199..2}", "5", false],
			["{x,{0..199}}", "x", true],
			["{$,a}{0..199}", "$5", true],
			// an escaped backslash before a range stays a literal backslash
			// (11.0.5 dropped it, and matched `a5`)
			["{a\\\\,b}{0..199}", "a\\5", true],
			["{a\\\\,b}{0..199}", "a5", false],
			// a [ before the range in its portion expands it instead
			["[x]{0..199}", "x150", true],
			["{0..199}[x]", "150x", true],
			// inside a !(...), *(...) or +(...) extglob it expands instead, since
			// those repeat or negate each value: 510 is not one value repeated
			["*({1..100})", "510", false],
			["*({1..100})", "5555", true],
			["+({1..100})", "510", false],
			["+({1..100})", "1010", true],
			// a leading `!` negates the whole pattern, so this one is no extglob; the
			// one after a literal is, and expands: every `x!(N)` but `x!(5)` takes `x5`
			["!({1..100})", "5", true],
			["x!({1..100})", "x5", true],
			["x!({1..100})", "x", true],
			["x/!(a{1..100})/y", "x/a5/y", true],
			// @(...) and ?(...) pick one value at most, so the range stays marked
			["@({1..100})", "510", false],
			["@({1..100})", "50", true],
			["?({1..100})", "5", true],
			["?({1..100})", "510", false],
			// an escaped opener is no extglob
			["\\*({1..100})", "*(50)", true],
			// past the budget it still matches, as one portion
			["{0..200000}", "5", true],
			["{0..9007199254740991}", "9007199254740991", true],
			["x/{0..1000000}/y", "x/999999/y", true],
		] as const) {
			assert.strictEqual(new Minimatch(pattern, opts).match(candidate), expected, `${pattern} vs ${candidate}`);
			assert.strictEqual(oracle(candidate, pattern, oracleOpts(opts)), expected, `oracle: ${pattern} vs ${candidate}`);
		}
		// under every option the oracle answers alike
		for (const options of [
			{ nocase: true },
			{ dot: true },
			{ noext: true },
			{ nobrace: true },
			{ braceExpandMax: 10 },
		]) {
			const o: EngineOptions = { ...opts, ...options };
			for (const candidate of ["150", "{0..199}", "1000"]) {
				assert.strictEqual(
					new Minimatch("{0..199}", o).match(candidate),
					oracle(candidate, "{0..199}", oracleOpts(o)),
					`${JSON.stringify(options)} vs ${candidate}`,
				);
			}
		}
		// under noext a `*(` is a star and a literal `(`, no extglob, so the range
		// stays one portion
		const noext: EngineOptions = { ...opts, noext: true };
		for (const [candidate, expected] of [
			["510", false],
			["x(50)", true],
			["*(50)", true],
		] as const) {
			assert.strictEqual(new Minimatch("*({1..100})", noext).match(candidate), expected, `noext vs ${candidate}`);
			assert.strictEqual(
				oracle(candidate, "*({1..100})", oracleOpts(noext)),
				expected,
				`oracle: noext vs ${candidate}`,
			);
		}
		// an unsafe integer end is expanded, so past the budget it fails typed
		assert.throws(() => new Minimatch("{0..9007199254740993}", opts), GuardExceeded);
		// so is a range inside a repeating or negating extglob, past the budget,
		// where 11 truncates it at 100,000 values (it matches 5, not 150000)
		for (const pattern of ["*({0..200000})"]) {
			try {
				new Minimatch(pattern, opts);
				assert.fail(`${pattern} compiled`);
			} catch (e) {
				assert.instanceOf(e, GuardExceeded, pattern);
				assert.strictEqual((e as GuardExceeded).reason, "ExpansionBudgetExceeded", pattern);
			}
		}
		assert.isTrue(oracle("5", "*({0..200000})", oracleOpts(opts)));
		assert.isFalse(oracle("150000", "*({0..200000})", oracleOpts(opts)));
		// 100,000 values is within the budget, so that one still compiles
		assert.isTrue(new Minimatch("+({0..99999})", opts).match("55"));
		assert.isTrue(oracle("55", "+({0..99999})", oracleOpts(opts)));
	});
});

// ── Oracle property tests ─────────────────────────────────────────────────
// Array form ONLY: the named-record form of it.effect.prop silently discards
// Schema conversion in @effect/vitest 4.0.0-beta.94.
//
// Literal and magic segments are two equal-weight groups (a Union of two
// Literals unions, not one flat list), so the pattern mix stays balanced
// between plain paths and paths that exercise the dialect.

const literalSeg = Schema.Literals(["a", "b", "abc", "x-y", "a.b+c", ".hidden", "..", ""]);
const magicSeg = Schema.Literals([
	"*",
	"?",
	"**",
	"*.js",
	"a*",
	"?(a|b)",
	"+(a|b)",
	"!(a)",
	"@(a|b)",
	"*(a|b)",
	"[abc]",
	"[!a]",
	"[[:alpha:]]",
	"{a,b}",
	"{1..3}",
	"\\*",
	"!x",
	// minimatch 11's dot and negation rules: a class beside other magic, a
	// nullable extglob before a *, and a !(...) not at the pattern start
	"[.]",
	"[.]*",
	"*(a|b)*",
	"?(a|)*",
	"!(*)",
	"a!(b)*",
	".!(a)",
	"*\\.",
	// escaped regexp syntax, and a sequence through [ \ ] ^ _ `
	"\\|*",
	"a\\(",
	"{Z..a}",
	// a [ that never closes, before extglobs
	"[",
	"[+(a)",
	"a[*(b)",
	"[!(a)",
]);
const patternArb = Arbitrary.schema(
	Schema.Array(Schema.Union([literalSeg, magicSeg])).check(Schema.isBetweenLength(1, 5)),
).pipe(Arbitrary.map((xs) => xs.join("/")));
// The dot rules are reached only by the path portions they restrict: `.`, `..`
// and dotfiles, so they are a group of their own beside the plain ones.
const candidateArb = Arbitrary.schema(
	Schema.Array(
		Schema.Union([
			Schema.Literals(["a", "b", "abc", "x", "a.b+c", "", "A", "[a", "[", "a[b"]),
			Schema.Literals([".hidden", ".", "..", ".a", "a."]),
		]),
	).check(Schema.isBetweenLength(1, 6)),
).pipe(Arbitrary.map((xs) => xs.join("/")));
// Every key is optional so the bag ranges from `{}` to fully specified — the
// generator draws a random subset of the optional keys per run.
const optionBagArb = Arbitrary.schema(
	Schema.Struct({
		dot: Schema.optionalKey(Schema.Boolean),
		nocase: Schema.optionalKey(Schema.Boolean),
		matchBase: Schema.optionalKey(Schema.Boolean),
		noglobstar: Schema.optionalKey(Schema.Boolean),
		noext: Schema.optionalKey(Schema.Boolean),
		nobrace: Schema.optionalKey(Schema.Boolean),
		nonegate: Schema.optionalKey(Schema.Boolean),
		flipNegate: Schema.optionalKey(Schema.Boolean),
		preserveMultipleSlashes: Schema.optionalKey(Schema.Boolean),
		partial: Schema.optionalKey(Schema.Boolean),
		optimizationLevel: Schema.optionalKey(Schema.Literals([0, 1, 2])),
		platform: Schema.optionalKey(Schema.Literals(["posix", "win32"])),
	}),
);
// Printable ASCII only, as the property's name promises; the pattern also
// keeps `/` and `\` out constructively instead of by residual filtering. The
// class is spelled as the four spans printable ASCII splits into around those
// two characters so the exclusions read as such.
const printableNoSlashArb = Arbitrary.schema(Schema.String.check(Schema.isPattern(/^[ -.0-9:-@A-Z[\]-~]{1,30}$/)));
const braceSegArb = Arbitrary.schema(
	Schema.Array(Schema.Literals(["a", "{b,c}", "{1..4}", "x{y,z}w", "{a,{b,c}}", "plain", "[{a,b}", "{[,x}"])).check(
		Schema.isBetweenLength(1, 4),
	),
).pipe(Arbitrary.map((xs) => xs.join("/")));

// One path portion built from the atoms minimatch 11's matcher rules turn on:
// classes beside other magic, nullable extglobs, negations at any position,
// unclosed openers and escapes. nonegate keeps a leading ! an extglob. The
// candidates are the portions those rules decide: dotfiles, `.`, `..`, and
// strings a negation's tail can split.
const ruleAtom = Schema.Literals([
	"a",
	"b",
	".",
	"*",
	"?",
	"[.]",
	"[!a]",
	"!(a)",
	"!(*)",
	"!(b*)",
	"*(a|b)",
	"?(a|)",
	"@(a|.)",
	"*(",
	"?(",
	"@(a|",
	"\\.",
	"*\\.",
	"?\\.",
	"\\|",
	"\\(",
	"[,]",
	"[",
	"]",
	"[+(",
]);
const ruleShapeArb = Arbitrary.schema(Schema.Array(ruleAtom).check(Schema.isBetweenLength(1, 4))).pipe(
	Arbitrary.map((xs) => xs.join("")),
);
const ruleCandidateArb = Arbitrary.schema(
	Schema.Literals([
		".a",
		".ab",
		".",
		"..",
		"a",
		"ab",
		"abc",
		"ba",
		"a.",
		"*(",
		"a*(",
		"@(a|",
		"a(",
		"b",
		"[a",
		"[",
		"]a",
		"[x()",
	]),
);

describe("engine compliance: minimatch 11.0.8", () => {
	const posix: EngineOptions = { platform: "posix" };
	const agree = (pattern: string, candidate: string, expected: boolean, options: EngineOptions = {}) => {
		const opts: EngineOptions = { ...posix, ...options };
		const label = `${pattern} vs ${candidate} ${JSON.stringify(options)}`;
		assert.strictEqual(new Minimatch(pattern, opts).match(candidate), expected, label);
		assert.strictEqual(oracle(candidate, pattern, oracleOpts(opts)), expected, `oracle: ${label}`);
	};

	it("keeps an escaped backslash escaped through brace expansion", () => {
		// 11.0.5 turned `\\` into one `\`, which then escaped the next character
		for (const [pattern, candidate, expected] of [
			["a\\\\{b,c}", "a\\b", true],
			["a\\\\{b,c}", "ab", false],
			["x\\\\\\*.{js,ts}", "x\\*.js", true],
			["x\\\\\\*.{js,ts}", "x\\anything.js", false],
			["x\\\\*{,}", "x\\anything", true],
			["{a\\\\,b}c", "a\\c", true],
			["{a\\\\,b}c", "ac", false],
			// an odd run still escapes the brace
			["a\\{b,c}", "a{b,c}", true],
			["a\\{b,c}", "ab", false],
		] as const) {
			agree(pattern, candidate, expected);
		}
		for (const pattern of ["a\\\\{b,c}", "a\\{b,c}", "{a\\\\,b}{0..9}", "x\\\\\\*.{js,ts}"]) {
			assert.deepStrictEqual(
				new Minimatch(pattern, posix).braceExpand(),
				new OracleMinimatch(pattern, oracleOpts(posix)).braceExpand(),
				pattern,
			);
		}
	});

	it("keeps a [{] or [}] class literal under windowsPathsNoEscape", () => {
		const wb: EngineOptions = { windowsPathsNoEscape: true, magicalBraces: true };
		const p = escapePattern("x{a,b}", wb);
		assert.strictEqual(p, "x[{]a,b[}]");
		agree(p, "x{a,b}", true, wb);
		agree(p, "xa", false, wb);
		agree(`${p}.{js,ts}`, "x{a,b}.ts", true, wb);
		agree(`${p}.{js,ts}`, "xa.js", false, wb);
	});

	it("escapes a leading # or ! so the result is never a comment or a negation", () => {
		for (const options of [
			{},
			{ magicalBraces: true },
			{ windowsPathsNoEscape: true },
			{ windowsPathsNoEscape: true, magicalBraces: true },
		] as ReadonlyArray<EngineOptions>) {
			for (const literal of ["!secret.txt", "#notes.md", "!", "#", "!(x)"]) {
				const p = escapePattern(literal, options);
				assert.strictEqual(p, oracle.escape(literal, options), `escape ${literal}`);
				agree(p, literal, true, options);
				agree(p, "x", false, options);
				agree(p, literal.slice(1) || "y", false, options);
			}
		}
		assert.strictEqual(escapePattern("!a"), "\\!a");
		assert.strictEqual(escapePattern("#a"), "\\#a");
		assert.strictEqual(escapePattern("!a", { windowsPathsNoEscape: true }), "@(!)a");
		assert.strictEqual(escapePattern("#a", { windowsPathsNoEscape: true }), "[#]a");
		// a run of leading `@(!)` unescapes as the oracle does, and a long run does not overflow the stack it recurses on
		for (const run of ["@(!)@(!)[*]", "@(!)@(!)@(!)a\\b"]) {
			const options = { windowsPathsNoEscape: true };
			assert.strictEqual(unescapePattern(run, options), oracle.unescape(run, options), run);
		}
		assert.strictEqual(
			unescapePattern(`${"@(!)".repeat(200_000)}x`, { windowsPathsNoEscape: true }),
			`${"!".repeat(200_000)}x`,
		);
		// with extglobs off, the windows `@(!)` matches nothing rather than everything
		agree(escapePattern("!a", { windowsPathsNoEscape: true }), "b", false, { windowsPathsNoEscape: true, noext: true });
		agree(escapePattern("!a", { windowsPathsNoEscape: true }), "a", false, { windowsPathsNoEscape: true, noext: true });
	});

	it("refuses more than 256 extglobs in a portion only where the oracle's recursive matcher would", () => {
		const nested = (type: string, n: number) => `${`${type}(`.repeat(n)}a${")".repeat(n)}`;
		const inRow = (type: string, n: number) => `${type}(a)`.repeat(n);
		// within the oracle's limit both answer alike
		for (const type of ["*", "?", "+", "@"]) {
			agree(nested(type, 256), "a", true);
			agree(nested(type, 256), "b", false);
		}
		agree(inRow("+", 256), "a".repeat(256), true);
		agree(inRow("@", 256), "a", false);
		// past it, nesting fails typed in the engine, as the oracle throws
		for (const type of ["*", "?", "+", "@"]) {
			assert.throws(() => new Minimatch(nested(type, 257), posix), GuardExceeded);
			assert.throws(() => oracle("a", nested(type, 257), oracleOpts(posix)), /too many extglobs/);
		}
		// in a row, the engine's worklist matcher answers where the oracle throws
		// (a named exception, `oracleTooManyExtglobs`)
		const row = inRow("?", 300);
		assert.isTrue(new Minimatch(row, posix).match("a"));
		assert.isTrue(oracleTooManyExtglobs(row, posix));
		assert.throws(() => oracle("a", row, oracleOpts(posix)), /too many extglobs/);
		// noext and escaped openers are not counted
		agree(inRow("*", 300), inRow("*", 300), true, { noext: true });
		agree("\\*(a)".repeat(300), "*(a)".repeat(300), true);
		assert.isFalse(oracleTooManyExtglobs(inRow("*", 300), { ...posix, noext: true }));
		// the limit is per path portion
		agree(Array(10).fill(inRow("?", 200)).join("/"), Array(10).fill("a").join("/"), true);
	});
});

describe("engine compliance: oracle properties", () => {
	it.effect.prop(
		"matches exactly as upstream under default options",
		[patternArb, candidateArb],
		([pattern, candidate]) =>
			Effect.sync(() => {
				const opts: EngineOptions = { platform: "posix" };
				assert.strictEqual(
					new Minimatch(pattern, opts).match(candidate),
					oracleAnswer(candidate, pattern, oracleOpts(opts)),
					`${pattern} vs ${candidate}`,
				);
			}),
		{ arbitrary: { runs: 500 } },
	);

	it.effect.prop(
		"matches exactly as upstream under arbitrary option bags",
		[patternArb, candidateArb, optionBagArb],
		([pattern, candidate, options]) =>
			Effect.sync(() => {
				const opts: EngineOptions = { platform: "posix", ...options };
				assert.strictEqual(
					new Minimatch(pattern, opts).match(candidate),
					oracleAnswer(candidate, pattern, oracleOpts(opts)),
					`${pattern} vs ${candidate} (${JSON.stringify(options)})`,
				);
			}),
		{ arbitrary: { runs: 500 } },
	);

	it.effect.prop(
		"matches exactly as upstream on minimatch 11's dot, negation and literal rules",
		[ruleShapeArb, ruleCandidateArb, Arbitrary.schema(Schema.Boolean)],
		([pattern, candidate, dot]) =>
			Effect.sync(() => {
				const opts: EngineOptions = { platform: "posix", dot, nonegate: true };
				assert.strictEqual(
					new Minimatch(pattern, opts).match(candidate),
					oracleAnswer(candidate, pattern, oracleOpts(opts)),
					`${pattern} vs ${candidate} (dot ${dot})`,
				);
			}),
		{ arbitrary: { runs: 500 } },
	);

	it.effect.prop(
		"a compiled escape of any printable string matches exactly that string",
		[printableNoSlashArb],
		([s]) =>
			Effect.sync(() => {
				// default options: escape() escapes a leading # or ! too (11.0.8), so
				// the result is never a comment or a negation. magicalBraces: brace
				// EXPANSION is magic regardless, but escape() only escapes braces
				// under this flag (oracle-confirmed upstream semantics).
				const opts: EngineOptions = { platform: "posix" };
				const m = new Minimatch(escapePattern(s, { magicalBraces: true }), opts);
				assert.isTrue(m.match(s), `escape(${JSON.stringify(s)}) must match its own literal`);
				assert.strictEqual(m.match(s), oracle(s, oracle.escape(s, { magicalBraces: true }), oracleOpts(opts)));
			}),
		{ arbitrary: { runs: 300 } },
	);

	it.effect.prop(
		"braceExpand agrees with the upstream expansion for in-budget patterns",
		[braceSegArb],
		([pattern]) =>
			Effect.sync(() => {
				const vendored = new Minimatch(pattern, { platform: "posix" });
				const upstream = new OracleMinimatch(pattern, oracleOpts({ platform: "posix" }));
				assert.deepStrictEqual(vendored.braceExpand(), upstream.braceExpand(), pattern);
			}),
		{ arbitrary: { runs: 300 } },
	);
});
