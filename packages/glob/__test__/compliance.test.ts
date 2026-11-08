// Task 4, the engine compliance gate (part 1): a deterministic behavioral
// fixture table across every dialect feature category, where EVERY row asserts
// both the expected boolean AND agreement with the real upstream minimatch
// 11.0.5 (the exact-pinned oracle devDependency); plus oracle property tests
// sampling the full dialect and option surface.
//
// Rule of the gate: if the vendored engine disagrees with the oracle, fix the
// engine, never the expectation — except where a row exercises the documented
// deviations (typed budget exhaustion; explicit platform) or the one documented
// divergence, numeric ranges of 100 or more values (hasLargeNumericRange
// below), which are tested separately and excluded from oracle comparison.

import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import type { MinimatchOptions } from "minimatch";
import { Minimatch as OracleMinimatch, minimatch as oracle } from "minimatch";
import { GuardExceeded } from "../src/internal/limits.js";
import type { EngineOptions } from "../src/internal/minimatch.js";
import { Minimatch, escape as escapePattern } from "../src/internal/minimatch.js";

type Row = readonly [pattern: string, candidate: string, expected: boolean, options?: EngineOptions];

// Upstream's Platform union has no "posix" member (its posix default is the
// ambient-detection fallback the port deletes). "linux" is behaviorally
// identical (non-win32) and keeps the oracle pinned regardless of the machine
// the suite runs on.
const oracleOpts = (opts: EngineOptions): MinimatchOptions =>
	({ ...opts, platform: opts.platform === "posix" ? "linux" : opts.platform }) as MinimatchOptions;

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

// Documented divergence: minimatch 11 matches a numeric range of 100 or more
// values, such as {0..999}, as one pattern portion instead of expanding it, so
// its hasMagic() is true for one, and it matches a range past braceExpandMax
// where the engine fails typed. The engine expands every range. Matching an
// in-budget range agrees, so only hasMagic and over-budget ranges take this
// exception. The detection is 11.0.5's own: an unescaped {lo..hi}, not a
// ${...} variable, with at least 100 values.
const LARGE_RANGE_MIN = 100;
const hasLargeNumericRange = (pattern: string): boolean => {
	for (const m of pattern.matchAll(/(?<![\\$])\{(-?\d+)\.\.(-?\d+)\}/g)) {
		const lo = Number(m[1]);
		const hi = Number(m[2]);
		if (Number.isSafeInteger(lo) && Number.isSafeInteger(hi) && Math.abs(lo - hi) + 1 >= LARGE_RANGE_MIN) return true;
	}
	return false;
};

// Documented oracle defect: minimatch 11 merges a pattern's brace alternatives
// into one Matcher by joining them with `|`, so a `[` in one alternative and a
// `]` in a later one become a class, and the alternatives between them are
// lost: `b**{Z..a}` (whose alternatives include `b**[`, `b**` and `b**]`) does
// not match its own text in 11, though `b**` does. The engine matches the
// union of the alternatives. Only there is the oracle's answer the union of
// its own per-alternative answers, never a skip.
// Whether one alternative has a `[` that never closes or a `]` outside any
// class, in some portion: only then can joining it to the others make a class.
const unbalancedBrackets = (alt: string): boolean =>
	alt.split("/").some((portion) => {
		for (let i = 0; i < portion.length; i++) {
			const c = portion.charAt(i);
			if (c === "\\") {
				i++;
			} else if (c === "]") {
				return true;
			} else if (c === "[") {
				// 11's classEnd: a `]` after at least one character closes the class
				let j = i + 1;
				if (portion.charAt(j) === "!" || portion.charAt(j) === "^") j++;
				let close = -1;
				for (let sawStart = false; j < portion.length; j++) {
					const d = portion.charAt(j);
					if (d === "]" && sawStart) {
						close = j;
						break;
					}
					sawStart = true;
					if (d === "\\") j++;
				}
				if (close === -1) return true;
				i = close;
			}
		}
		return false;
	});
// The merge defect is not only about unbalanced brackets: `b[a-#{Z..a}[.]`
// expands to balanced alternatives, yet joining them still makes a class
// across a `|`. So the rule covers any alternative with a `[` or `]` in it.
// Those patterns are still judged by 11, alternative by alternative.
const bracketsAcrossAlternatives = (m: OracleMinimatch): boolean =>
	m.globSet.length > 1 && m.globSet.some((alt) => unbalancedBrackets(alt) || /[[\]]/.test(alt));
// minimatch's own answer from whether any alternative hit: a hit answers
// `true` under flipNegate and `!negate` otherwise; no hit answers `false`
// under flipNegate and `negate` otherwise.
const oracleAnswer = (candidate: string, pattern: string, opts: MinimatchOptions): boolean => {
	const m = new OracleMinimatch(pattern, opts);
	if (!bracketsAcrossAlternatives(m)) return m.match(candidate);
	// 11's match answers `/` under partial before it reads the set or the negation
	if (opts.partial && candidate === "/") return true;
	const alone = { ...opts, nobrace: true, nonegate: true, nocomment: true, flipNegate: false };
	const hit = m.globSet.some((alt) => {
		if (alt !== "") return new OracleMinimatch(alt, alone).match(candidate);
		// An empty alternative (`{Z..a}` makes one from `\`) is a row of the set,
		// but alone it would be the empty pattern, which matches nothing. So it is
		// judged by 11's own matcher on that one empty row.
		const row = new OracleMinimatch("x", alone);
		row.set = [[""]];
		return row.match(candidate);
	});
	if (opts.flipNegate) return hit;
	return hit ? !m.negate : m.negate;
};

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

	it("expands a range of 100 or more values, the documented range divergence", () => {
		const opts: EngineOptions = { platform: "posix" };
		for (const pattern of ["{0..199}", "a{1..150}b", "x/{-50..60}/y"]) {
			assert.isTrue(hasLargeNumericRange(pattern), pattern);
			// expanded, so not magic; the oracle matches it as one portion, so
			// magic. If the oracle stops saying so, this exception can go.
			assert.isFalse(new Minimatch(pattern, opts).hasMagic(), pattern);
			assert.isTrue(new OracleMinimatch(pattern, oracleOpts(opts)).hasMagic(), `oracle: ${pattern}`);
		}
		assert.isFalse(hasLargeNumericRange("{0..98}"));
		assert.isFalse(hasLargeNumericRange("\\{0..199}"));
		// a $-prefixed shell variable is not a range
		assert.isFalse(hasLargeNumericRange(`$${"{0..199}"}`));
		// matching an in-budget range agrees with the oracle
		for (const [pattern, candidate] of [
			["{0..199}", "150"],
			["{0..199}", "200"],
			["{000..199}", "050"],
			["a{1..150}b", "a99b"],
			["{0..199..2}", "5"],
		] as const) {
			assert.strictEqual(
				new Minimatch(pattern, opts).match(candidate),
				oracle(candidate, pattern, oracleOpts(opts)),
				`${pattern} vs ${candidate}`,
			);
		}
		// past the budget the engine fails typed; the oracle matches the range
		assert.throws(() => new Minimatch("{0..200000}", opts), GuardExceeded);
		assert.isTrue(oracle("5", "{0..200000}", oracleOpts(opts)));
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

// Every generated pattern is a fair question to the oracle except one with a
// numeric range of 100 or more values, the documented divergence. The segments
// above never make one; the predicate keeps the exception named if they do.
const oracleCanJudge = (pattern: string): boolean => !hasLargeNumericRange(pattern);

describe("engine compliance: oracle properties", () => {
	it.effect.prop(
		"matches exactly as upstream under default options",
		[patternArb, candidateArb],
		([pattern, candidate]) =>
			Effect.sync(() => {
				if (!oracleCanJudge(pattern)) return;
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
				if (!oracleCanJudge(pattern)) return;
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
				// nocomment/nonegate: escape() escapes glob magic, but a leading #
				// or ! is comment/negation syntax that escape deliberately does not
				// touch. magicalBraces: brace EXPANSION is magic regardless, but
				// escape() only escapes braces under this flag. Both are
				// oracle-confirmed upstream semantics.
				const opts: EngineOptions = { platform: "posix", nocomment: true, nonegate: true };
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
