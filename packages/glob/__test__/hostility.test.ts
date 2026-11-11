// Task 4, the engine compliance gate (part 2): the hostile-input suite.
// Every case asserts a typed guard trip or total boolean AND completes inside
// the default test timeout — the timeout is the hang detector. Malformed or
// hostile input must never surface as a stack overflow, an OOM, or a hang.

import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Effect, Result, Schema } from "effect";
import * as oracle from "minimatch";
import { GlobPattern, GlobPatternOptions, GlobSet } from "../src/index.js";
import { compileBudget, markBudget, rewindBudget } from "../src/internal/ast.js";
import { expand } from "../src/internal/braceExpansion.js";
import { GuardExceeded } from "../src/internal/limits.js";
import { Minimatch, braceExpand } from "../src/internal/minimatch.js";

// Runs `fn` and fails on any throw. chai's `noThrow(fn, "text")`
// reads a string second argument as an error-message matcher, so it passes
// when `fn` throws anything whose message lacks that text: never use it with
// a label here.
const noThrow = (fn: () => unknown, label = ""): void => {
	try {
		fn();
	} catch (e) {
		assert.fail(`${label}: threw ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
	}
};

const reasonOf = (fn: () => unknown): string => {
	try {
		fn();
	} catch (e) {
		if (e instanceof GuardExceeded) return e.reason;
		throw e;
	}
	throw new Error("expected a GuardExceeded throw");
};

/**
 * Milliseconds of CPU time this process has spent (`process.cpuUsage`, user plus system): time the work spent, not
 * time the process was descheduled, so a loaded machine can not stretch a sample. vitest runs each file in its own
 * fork, so no other test's CPU lands here. It under-measures async I/O, which the units here do not use.
 */
const cpuNow = (): number => {
	const used = process.cpuUsage();
	return (used.user + used.system) / 1000;
};

describe("hostility: pattern length", () => {
	it("rejects a pattern past 64KB typed, with limit and actual populated", () => {
		try {
			new Minimatch("a".repeat(65_537));
			assert.fail("expected a GuardExceeded throw");
		} catch (e) {
			assert.instanceOf(e, GuardExceeded);
			const g = e as GuardExceeded;
			assert.strictEqual(g.reason, "PatternTooLong");
			assert.strictEqual(g.limit, 65_536);
			assert.strictEqual(g.actual, 65_537);
		}
	});

	it("compiles a pattern of exactly 64KB", () => {
		const m = new Minimatch("a".repeat(65_536));
		assert.isFalse(m.match("b"));
	});

	it("handles a comment pattern with a 64KB body fast", () => {
		assert.isFalse(new Minimatch(`#${"a".repeat(65_000)}`).match("anything"));
	});
});

describe("hostility: brace expansion", () => {
	it("fails typed on an expansion bomb, never truncating silently", () => {
		// 2^17 = 131_072 > 100_000
		assert.strictEqual(
			reasonOf(() => new Minimatch("{a,b}".repeat(17))),
			"ExpansionBudgetExceeded",
		);
	});

	it("fails typed on comma-bearing nesting past the depth cap", () => {
		const bomb = `${"{".repeat(300)}a,b${"}".repeat(300)}`;
		assert.strictEqual(
			reasonOf(() => new Minimatch(bomb)),
			"NestingDepthExceeded",
		);
	});

	it("survives the exponential-blowup shape (lazy post preserved)", () => {
		const m = new Minimatch(`a${"{},".repeat(60)}b`);
		assert.isNotNull(m);
	});

	it("fails typed past the sequential comma-group cap, never a stack overflow", () => {
		assert.strictEqual(
			reasonOf(() => expand(`${"{a},".repeat(5000)}b}`)),
			"NestingDepthExceeded",
		);
	});

	it("fails typed when the expansion passes 4,000,000 characters (CVE-2026-14257)", () => {
		// 65,536 alternatives stay under the count budget, but each is about 2 KB:
		// the count alone let a 2 KB pattern build 136 MB of strings.
		try {
			expand(`${"x".repeat(2000)}${"{a,b}".repeat(16)}`);
			assert.fail("expected a GuardExceeded throw");
		} catch (e) {
			assert.instanceOf(e, GuardExceeded);
			const g = e as GuardExceeded;
			assert.strictEqual(g.reason, "ExpansionBudgetExceeded");
			assert.strictEqual(g.limit, 4_000_000);
		}
		// Control: the same count of short alternatives still expands.
		assert.strictEqual(expand("{a,b}".repeat(16)).length, 65_536);
	});

	it("stops the {a},b} rewrite after 1,000 restarts and keeps the rest literal, as upstream", () => {
		// Each trailing } costs one more pass over the whole string. brace-expansion
		// 5.0.12 stops at 1,000 rewrites: one fewer brace still expands.
		const rewrites = (n: number): string => `{a}${"}".repeat(n)},z}`;
		assert.deepStrictEqual(expand(rewrites(999)), [`a${"}".repeat(1000)}`, "z"]);
		assert.deepStrictEqual(expand(rewrites(1000)), [rewrites(1000)]);
		const t = cpuNow();
		assert.deepStrictEqual(expand(rewrites(65_000)), [rewrites(65_000)]);
		assert.isBelow(cpuNow() - t, 1000);
	});

	it("shares one {a},b} rewrite count across a chain of groups, as upstream", () => {
		// brace-expansion 5.0.12 scans a string's groups left to right in one loop,
		// so every group in a chain draws on the same 1,000 rewrites.
		const S = (n: number): string => `{a}${"}".repeat(n)},z}`;
		const shapes = [S(999) + S(1), S(600) + S(600), `{a,b}${S(600)}${S(600)}`, S(400).repeat(3), S(1) + S(999)];
		for (const shape of shapes) {
			assert.deepStrictEqual(expand(shape), oracle.braceExpand(shape), shape.slice(0, 40));
		}
		assert.strictEqual(expand(S(999) + S(1)).length, 2);
		// One scan also decides once, at its first group, whether empty results
		// drop: a later group's rewrite does not turn it on.
		for (const shape of ["{1..3}{},,z,,..z}", "{a},z}a{a,b}{a}},,}", "{a,b}{}\\}{a,b}\\,\\}.,,{a..c}}"]) {
			assert.deepStrictEqual(expand(shape), oracle.braceExpand(shape), shape);
		}
		// A sequence first: no empty drop for the whole scan, so `{,}` keeps its
		// empty results (a scan that re-decided at each group loses them).
		for (const shape of ["{Z..a}{,}", "{Z..a}{a,}"]) {
			assert.deepStrictEqual(expand(shape), oracle.braceExpand(shape), shape);
		}
		// 63,744 bytes: upstream stops rewriting after the second group and keeps
		// the rest literal, so this compiles quickly instead of failing typed.
		const long = S(990).repeat(64);
		const t = cpuNow();
		assert.deepStrictEqual(expand(long), oracle.braceExpand(long));
		assert.isBelow(cpuNow() - t, 500);
	});

	it("shortcuts the CVE-2022-3517 non-closing brace prefix fast", () => {
		// No closing brace: the ReDoS-safe pre-check regex must reject expansion
		// in linear time and treat the pattern as literal.
		const p = `${"{".repeat(20_000)}a`;
		assert.deepStrictEqual(braceExpand(p), [p]);
	});
});

describe("hostility: extglobs", () => {
	it("degrades over-nesting to literal at the default cap, never hanging", () => {
		const p = `${"+(".repeat(50)}a${")".repeat(50)}`;
		const m = new Minimatch(p);
		assert.isBoolean(m.match(p));
		assert.isBoolean(m.match("a"));
	});

	it("fails typed when a raised extglob cap meets deep nesting", () => {
		const deep = `${"!(".repeat(300)}a${")".repeat(300)}`;
		assert.strictEqual(
			reasonOf(() => new Minimatch(deep, { maxExtglobRecursion: 400 })),
			"NestingDepthExceeded",
		);
	});

	it("fails typed on the adoption chain that stack-overflows upstream", () => {
		const chain = `${"@(".repeat(20_000)}a${")".repeat(20_000)}`;
		assert.strictEqual(
			reasonOf(() => new Minimatch(chain)),
			"NestingDepthExceeded",
		);
	});
});

describe("hostility: globstar backtracking", () => {
	it("keeps match total under a long globstar chain (documented false negative)", () => {
		// 500 non-adjacent ** sections exceed maxGlobstarRecursion (200): the
		// engine returns a boolean — upstream's intentional false negative,
		// an acceptable break in correctness for security — and never throws.
		const pattern = Array.from({ length: 500 }, () => "**/x").join("/");
		const candidate = Array.from({ length: 60 }, () => "x").join("/");
		const m = new Minimatch(pattern);
		assert.isBoolean(m.match(candidate));
	});

	it("matches a 10k-segment path against a simple globstar pattern fast", () => {
		const candidate = Array.from({ length: 10_000 }, () => "a").join("/");
		assert.isFalse(new Minimatch("**/x").match(candidate));
		assert.isTrue(new Minimatch("**/a").match(candidate));
	});
});

describe("hostility: optimizationLevel 2 **/.. splitting (GHSA-g3hv-75wg-m249)", () => {
	// Each `**/../<p>/<p2>` splits a row in two, so n of them make 2^n rows from a
	// pattern of 10n bytes. Upstream before 11.0.1 split without a bound and then
	// compared every pair of rows: n = 16 (161 bytes) took about a minute to
	// compile. The split now stops at braceExpandMax rows or 1,000,000 added path
	// portions and fails typed, and the dedupe pass is linear in the rows.
	const splits = (n: number): string => `${"**/../a/b/".repeat(n)}z`;
	const level2 = { optimizationLevel: 2 } as const;

	const compileMs = (pattern: string): number => {
		let best = Number.POSITIVE_INFINITY;
		for (let i = 0; i < 3; i++) {
			const t = cpuNow();
			new Minimatch(pattern, level2);
			best = Math.min(best, cpuNow() - t);
		}
		return best;
	};

	it("splits a few **/.. portions as before", () => {
		const m = new Minimatch(splits(3), level2);
		assert.strictEqual(m.set.length, 8);
		assert.isTrue(m.match("a/b/a/b/a/b/z"));
	});

	it("fails typed when the split passes a lowered braceExpandMax", () => {
		try {
			new Minimatch(splits(12), { ...level2, braceExpandMax: 1000 });
			assert.fail("expected a GuardExceeded throw");
		} catch (e) {
			assert.instanceOf(e, GuardExceeded);
			const g = e as GuardExceeded;
			assert.strictEqual(g.reason, "ExpansionBudgetExceeded");
			assert.strictEqual(g.limit, 1000);
		}
	});

	it("fails typed when the split adds more than 1,000,000 path portions", () => {
		// 2^16 rows stay under the default braceExpandMax, but each split copies a
		// row of about 50 portions.
		try {
			new Minimatch(splits(16), level2);
			assert.fail("expected a GuardExceeded throw");
		} catch (e) {
			assert.instanceOf(e, GuardExceeded);
			const g = e as GuardExceeded;
			assert.strictEqual(g.reason, "ExpansionBudgetExceeded");
			assert.strictEqual(g.limit, 1_000_000);
		}
	});

	it("fails typed fast on 2^17 rows at default options, never hanging", () => {
		// Unbounded, this took hours. Whichever bound trips first, it fails typed.
		const t = cpuNow();
		assert.strictEqual(
			reasonOf(() => new Minimatch(splits(17), level2)),
			"ExpansionBudgetExceeded",
		);
		assert.isBelow(cpuNow() - t, 1000);
	});

	it("grows compile time about linearly in the rows the split makes", () => {
		// 8x the rows. A pairwise dedupe grows about 64x (measured about 30x on
		// the unbounded engine: 24 ms to 711 ms); a linear one about 8x.
		new Minimatch(splits(10), level2);
		const small = compileMs(splits(10));
		const large = compileMs(splits(13));
		assert.isBelow(large / Math.max(small, 0.5), 20);
	});
});

describe("hostility: internal cap wiring", () => {
	it("dies on NaN or non-integer caps everywhere they are accepted", () => {
		assert.throws(() => new Minimatch("a", { maxGlobstarRecursion: Number.NaN }), TypeError);
		assert.throws(() => new Minimatch("a", { maxGlobstarRecursion: 1.5 }), TypeError);
		assert.throws(() => new Minimatch("{a,b}", { braceExpandMax: Number.NaN }), TypeError);
		assert.throws(() => new Minimatch("{a,b}", { braceExpandMax: 0 }), TypeError);
		assert.throws(() => new Minimatch("+(a)", { maxExtglobRecursion: Number.NaN }), TypeError);
	});
});

// The growth of an operation's time from size `from` to size `to`. Each size
// is timed on real work, not timer noise: the operation repeats until a sample
// takes at least 5 ms, and its time is that sample over the repeats. A unit
// whose size can not grow (a nesting cap holds it) still does 5 ms of work. A
// ratio over `bound` is timed again, up to three samples, keeping the fastest
// of each size, so one pause can not fail linear work while superlinear work
// fails every sample.
const growth = (make: (n: number) => () => unknown, from: number, to: number, bound: number): number => {
	const sample = (run: () => unknown): number => {
		let reps = 0;
		const t = cpuNow();
		let elapsed = 0;
		while (elapsed < 5) {
			run();
			reps++;
			elapsed = cpuNow() - t;
		}
		return elapsed / reps;
	};
	const small = make(from);
	const large = make(to);
	small();
	large();
	let a = sample(small);
	let b = sample(large);
	for (let i = 1; i < 3 && b / a >= bound; i++) {
		a = Math.min(a, sample(small));
		b = Math.min(b, sample(large));
	}
	return b / a;
};

// An absolute bound on one operation, timed the way the growth units are: a
// try over the bound is timed again, up to three tries, keeping the fastest,
// so one pause on a loaded machine can not fail work that is fast, while slow
// work misses every try.
const fastest = (run: () => unknown, bound: number): number => {
	let best = Number.POSITIVE_INFINITY;
	for (let i = 0; i < 3 && best >= bound; i++) {
		const t = cpuNow();
		run();
		best = Math.min(best, cpuNow() - t);
	}
	return best;
};

describe("hostility: chained and unclosed extglobs", () => {
	it("compiles a chain of unclosed openers in linear time", () => {
		// Each unclosed @( is a node above the next; asking whether one is the end
		// of the portion must not ask its parent twice (2^depth).
		assert.isTrue(Result.isSuccess(GlobPattern.compileResult(`a${"@(".repeat(32)}`)));
		assert.isBelow(
			fastest(() => GlobPattern.compileResult(`a${"@(".repeat(32)}`), 50),
			50,
		);
		assert.isTrue(Result.isSuccess(GlobPattern.compileResult(`a${"@(".repeat(120)}`)));
		// 4x the depth: isStart walks a node's ancestors, so compiling is
		// quadratic in nesting depth, which MAX_NESTING_DEPTH (256) bounds:
		// about 16x (bound 32; measured about 12). Doubling per level would be
		// 2^180.
		assert.isBelow(
			growth((n) => () => new Minimatch(`a${"@(".repeat(n)}`), 60, 240, 32),
			32,
		);
	});

	it("compiles a chain of negations in linear time and answers as the oracle", () => {
		// Each !(...) used to copy the rest of the portion into its regexp, which
		// doubled per negation: 25 of them (101 bytes) ran out of memory.
		const chain = `x${"!(a)".repeat(25)}`;
		const m = new Minimatch(chain, { platform: "posix" });
		assert.isBelow(
			fastest(() => new Minimatch(chain, { platform: "posix" }), 100),
			100,
		);
		for (const f of ["x", "xa", "xb", "xab"]) assert.strictEqual(m.match(f), oracle.minimatch(f, chain), f);
		// 4x the negations: compiling is linear, so about 4x (bound 10, which a
		// quadratic regression, 16x, still fails). At 4,000 the small side is a
		// few ms of real work, not the 0.07 ms whose noise read 12 once; 16,000
		// negations are 64,001 bytes, under the length cap.
		assert.isBelow(
			growth((n) => () => new Minimatch(`x${"!(a)".repeat(n)}`), 4000, 16_000, 10),
			10,
		);
		// the same through an unclosed opener's alternatives
		const open = `a${"!(*(b)|".repeat(1000)}`;
		assert.isTrue(Result.isSuccess(GlobPattern.compileResult(open)));
		assert.isBelow(
			fastest(() => GlobPattern.compileResult(open), 500),
			500,
		);
	});
});

describe("hostility: matches is total", () => {
	it("never compiles a regexp at match time", () => {
		// A class the walk needs compiles when the pattern does, so a bad one
		// fails typed there and matching can not throw.
		for (const [source, path] of [
			["x!(@(@([,])))[[:alpha:]]", "xa"],
			["*(!(*([,]))[[:alpha:]])", "xa"],
			["a/x!(?(*([-])))[[:alpha:]]", "a/xa"],
			["x!(a)[,][[:alpha:]]", "x,q"],
			["x!(a)[#][[:alpha:]]", "x#q"],
		] as const) {
			const decoded = Schema.decodeUnknownResult(GlobPattern.FromString)(source);
			if (Result.isSuccess(decoded)) {
				noThrow(() => decoded.success.matches(path), source);
				noThrow(() => decoded.success.matches(`.${path}`), source);
			} else {
				assert.strictEqual(Result.isFailure(GlobPattern.compileResult(source)), true, source);
			}
		}
	});

	it("answers every getter on a pattern whose dropped segment would not compile alone", () => {
		// `..` drops the first segment from the whole compile, but literalPrefix
		// compiled each source segment on its own and threw the raw guard.
		for (const source of ["[[:alpha:]]#/..", "a/[[:alpha:]],/../b"]) {
			const compiled = GlobPattern.compileResult(source);
			assert.isTrue(Result.isSuccess(compiled), source);
			if (Result.isSuccess(compiled)) {
				const g = compiled.success;
				noThrow(() => g.literalPrefix, source);
				noThrow(() => [g.enumerationPrefix, g.enumerationRoots, g.crossesSegments], source);
			}
		}
	});

	it("compiles a one-character class beside a POSIX class, as the oracle does", () => {
		// A one-character class is its character, escaped only if it is regexp
		// syntax (11's reEscape set), so [,] beside a POSIX class is valid in a
		// portion with or without an extglob, and matches as 11 does.
		for (const [source, path] of [
			["x!(a)[,][[:alpha:]]", "x,q"],
			["x!(a)[#][[:alpha:]]", "x#q"],
			["y!(b)x[-][[:digit:]]", "yax-1"],
		] as const) {
			const compiled = GlobPattern.compileResult(source);
			assert.isTrue(Result.isSuccess(compiled), source);
			if (Result.isSuccess(compiled)) {
				assert.strictEqual(compiled.success.matches(path), oracle.minimatch(path, source), `${source} vs ${path}`);
			}
		}
		for (const [source, path] of [
			["x[,][[:alpha:]]", "x,q"],
			["x[#][[:alpha:]]", "x#q"],
			["x[-][[:digit:]]", "x-1"],
			["x[ ][[:alpha:]]", "x q"],
		] as const) {
			const compiled = GlobPattern.compileResult(source);
			assert.isTrue(Result.isSuccess(compiled), source);
			if (Result.isSuccess(compiled)) {
				assert.isTrue(compiled.success.matches(path), `${source} vs ${path}`);
				assert.strictEqual(compiled.success.matches(path), oracle.minimatch(path, source), `${source} vs ${path}`);
			}
		}
	});

	it("fails typed when a portion's regexp is too large for the runtime", () => {
		// V8 builds a regexp's bytecode on its first exec: a source too large for
		// it passes new RegExp and threw only when matching. Compiling runs it once.
		// V8 builds the code for a two-byte subject separately, on its first
		// two-byte exec: a source of non-Latin-1 literals compiles trivially
		// for a one-byte subject, so compiling runs both.
		for (const source of [
			`${"a".repeat(40_000)}*`,
			`${"[".repeat(40_000)}*`,
			`${"a".repeat(40_000)}?`,
			`${"ā".repeat(33_000)}*`,
			`${"é".repeat(33_000)}*`,
		]) {
			const compiled = GlobPattern.compileResult(source);
			assert.isTrue(Result.isFailure(compiled) && compiled.failure.reason === "InvalidRegExp", source.slice(-3));
			assert.isTrue(Result.isFailure(Schema.decodeUnknownResult(GlobPattern.FromString)(source)), source.slice(-3));
		}
		const twoByte = GlobPattern.compileResult(`${"ā".repeat(16_000)}*`);
		assert.isTrue(Result.isSuccess(twoByte));
		if (Result.isSuccess(twoByte)) {
			noThrow(() => twoByte.success.matches(`${"ā".repeat(100)}b`));
			assert.isTrue(twoByte.success.matches(`${"ā".repeat(16_000)}b`));
		}
		// a long portion the runtime can build compiles, and matching it never throws
		const fits = GlobPattern.compileResult(`${"a".repeat(20_000)}*`);
		assert.isTrue(Result.isSuccess(fits));
		if (Result.isSuccess(fits)) {
			noThrow(() => fits.success.matches("x"));
			assert.isTrue(fits.success.matches(`${"a".repeat(20_000)}b`));
		}
	});

	const atom = Schema.Literals([
		"a",
		"a".repeat(6000),
		"ā".repeat(6000),
		"/",
		"..",
		"!(a)",
		"[",
		"]",
		".",
		",",
		"-",
		"#",
		" ",
		"*",
		"?",
		"[,]",
		"[-]",
		"[#]",
		"[.]",
		"[[:alpha:]]",
		"!(",
		"@(",
		"*(",
		"?(",
		"|",
		")",
		"\\",
		"{a,}",
	]);
	const patternArb = Arbitrary.schema(Schema.Array(atom).check(Schema.isBetweenLength(1, 8))).pipe(
		Arbitrary.map((xs) => xs.join("")),
	);
	const pathArb = Arbitrary.schema(
		Schema.Literals(["a", ".a", ".", "..", "xa", "a,", ",", "a-b", "[,]", "ā", "āā/a", "a/..", "x/.a"]),
	);

	it.effect.prop(
		"neither matches nor a getter throws on a pattern that decodes",
		[patternArb, pathArb, Arbitrary.schema(Schema.Boolean)],
		([source, path, nocase]) =>
			Effect.sync(() => {
				const compiled = GlobPattern.compileResult(source);
				if (Result.isFailure(compiled)) return;
				noThrow(() => compiled.success.matches(path), `${source} vs ${path}`);
				const g = compiled.success;
				noThrow(
					() => [g.literalPrefix, g.enumerationPrefix, g.enumerationRoots, g.crossesSegments, g.hasMagic, g.negated],
					`getters of ${source}`,
				);
				const folded = GlobPattern.compileResult(source, GlobPatternOptions.make({ nocase }));
				if (Result.isSuccess(folded)) noThrow(() => folded.success.matches(path));
			}),
		// up to eight 6,000-character atoms, each compiled twice: seconds of work,
		// not a timing claim, so the timeout only catches a hang
		{ arbitrary: { runs: 1000 }, timeout: 30_000 },
	);
});

describe("hostility: negations in sequence", () => {
	it("matches a run of negations in quadratic time, not cubic", () => {
		// Each !(...) used to try every end from every start: n of them over an
		// n-character path cost n^3.
		const at = (n: number) => {
			const m = new Minimatch(`x${"!(a)".repeat(n)}`, { platform: "posix" });
			const path = `x${"b".repeat(n)}`;
			return () => m.match(path);
		};
		assert.isTrue(at(200)());
		// 4x the negations and the path: minimatch 11's matcher steps a cached
		// state per character, so about 4x (bound 10); the walk it replaced
		// was quadratic (16x) and, memoized per start, cubic (64x).
		assert.isBelow(growth(at, 100, 400, 10), 10);
	});
});

describe("hostility: unclosed [", () => {
	it("compiles a run of [ that never closes in linear time", () => {
		// Each [ looked for its ] to the end of the portion: quadratic, and the
		// engine asks twice per [ (the parse and the regexp).
		const timed = (source: string, bound: number): void => {
			assert.isTrue(Result.isSuccess(GlobPattern.compileResult(source)), source.slice(0, 20));
			assert.isBelow(
				fastest(() => GlobPattern.compileResult(source), bound),
				bound,
				source.slice(0, 20),
			);
		};
		timed("[".repeat(2000), 100);
		timed("[!(a)".repeat(1000), 100);
		// catches a regression to quadratic (minutes); the growth unit carries linearity
		timed("[".repeat(65_000), 3000);
		// every ] escaped, or swallowed by a POSIX class: still linear
		timed("[\\]".repeat(4000), 100);
		timed(`${"[".repeat(4000)}[:alpha:]`, 100);
		assert.isBelow(
			// 4x the run: linear, so about 4x (bound 10)
			growth((n) => () => new Minimatch("[".repeat(n), { platform: "posix" }), 4000, 16_000, 10),
			10,
		);
	});
});

describe("hostility: no regexp at match time", () => {
	it("builds no RegExp while matching compiled patterns", () => {
		let seed = 7;
		const rnd = (): number => {
			seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
			return seed / 2_147_483_648;
		};
		const pick = <A>(xs: ReadonlyArray<A>): A => xs[Math.floor(rnd() * xs.length)] as A;
		const atoms = ["a", ".", ",", "*", "?", "[,]", "[.]", "[!a]", "[[:alpha:]]", "!(a)", "*(a|b)", "@(", "[", "\\|"];
		const portion = (): string => Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => pick(atoms)).join("");
		const paths = ["a", ".a", ".", "..", "a,b", "x/a", ".x/.y", "[a"];
		const compiled: Array<Minimatch> = [];
		const Native = globalThis.RegExp;
		let built = 0;
		const Spy = new Proxy(Native, {
			construct(target, args, newTarget) {
				built++;
				return Reflect.construct(target, args, newTarget);
			},
			apply(target, thisArg, args) {
				built++;
				return Reflect.apply(target, thisArg, args);
			},
		});
		globalThis.RegExp = Spy;
		try {
			while (compiled.length < 1000) {
				const source = Array.from({ length: 1 + Math.floor(rnd() * 2) }, portion).join("/");
				const options = { platform: "posix" as const, nocase: rnd() < 0.5, dot: rnd() < 0.5 };
				try {
					compiled.push(new Minimatch(source, options));
				} catch (e) {
					if (!(e instanceof GuardExceeded)) throw e;
				}
			}
			// control: compiling builds regexps, so the spy sees them
			assert.isAbove(built, 0);
			built = 0;
			for (const m of compiled) for (const f of paths) m.match(f);
			assert.strictEqual(built, 0);
		} finally {
			globalThis.RegExp = Native;
		}
	});
});

describe("hostility: nested quantified extglobs", () => {
	it("matches them in polynomial time, as the oracle answers", () => {
		// 10's regexp for `*(*(a|b)*)` backtracks exponentially. An extglob portion
		// has no regexp: the walk answers it. Each of these took seconds to hang
		// against its own text; the first was 4 ms at git HEAD, which read the
		// extglobs after its unclosed [ as literal text.
		const rows: ReadonlyArray<readonly [string, Record<string, unknown>, string?]> = [
			["[*(*(a|b)*){],y}[({1..3}){a[,b]}?(a|)[+(", { nocase: true, optimizationLevel: 0 }],
			["[*(*(a|b)*){],y}[({1..3}){a[,b]}?(a|)[+(", {}],
			["*(@(|Aa|)?(*|.*))[.-.]/.", {}],
			["+(*(.\\]|-|*)|**|){a,}A", { dot: true, matchBase: true, partial: true, optimizationLevel: 1 }],
			[",+(*(**|*)-|*(.a|\\)))A", { noglobstar: true, nobrace: true }, ",+(*(**|*)-|*(.a|)))A"],
			["*(||@(\\)|)*(|*))!([!a]/{", { nocase: true, nonegate: true }],
			["*(x|+(*)?()|),[A]/****-", { dot: true, nobrace: true, partial: true, optimizationLevel: 2 }],
		];
		for (const [pattern, options, path = pattern] of rows) {
			const m = new Minimatch(pattern, { platform: "posix", ...options });
			const answer = m.match(path);
			assert.isBelow(
				fastest(() => m.match(path), 50),
				50,
				pattern,
			);
			assert.strictEqual(answer, new oracle.Minimatch(pattern, { platform: "linux", ...options }).match(path), pattern);
		}
		// 4x the path: polynomial work, far from the exponential backtracking
		const at = (n: number) => {
			const m = new Minimatch("*(*(a|b)*)x", { platform: "posix" });
			const path = `${"ab".repeat(n)}y`;
			return () => m.match(path);
		};
		assert.isFalse(at(10)());
		// 4x the path: one cached state per character, so about 4x (bound 10)
		assert.isBelow(growth(at, 50, 200, 10), 10);
	});
});

describe("hostility: nested quantifiers and negations in the walk", () => {
	// Each node of the walk ran again for every start set it was handed, so
	// nested quantifiers and negations multiplied: A took 12 s and B 144 s,
	// where minimatch 11 takes under 1 ms. The walk memoizes each node's ends
	// per start for one match.
	const A = "+(+()+(|*(?()[a]|*(*)b)b)?)";
	const B = "*(+(!()@())+(?())[a])!(?(*())*+(!()!(**b)))";
	const at =
		(pattern: string, options: Record<string, unknown> = {}) =>
		(n: number) => {
			const m = new Minimatch(pattern, { platform: "posix", ...options });
			const path = "a".repeat(n);
			return () => m.match(path);
		};

	it("matches them in polynomial time, as the oracle answers", () => {
		for (const pattern of [A, B]) {
			const path = "a".repeat(400);
			assert.strictEqual(
				new Minimatch(pattern, { platform: "posix" }).match(path),
				oracle.minimatch(path, pattern),
				pattern,
			);
			assert.isBelow(fastest(at(pattern)(400), 250), 250, pattern);
			// 2x the path: one cached state per character, so about 2x (bound 4)
			assert.isBelow(growth(at(pattern), 200, 400, 4), 4, pattern);
		}
	});

	it("stays polynomial in nesting under a raised maxExtglobRecursion", () => {
		// B with its [a] replaced by B, three levels (123 bytes): 41 s before
		const nested = B.replace("[a]", B.replace("[a]", B));
		const options = { maxExtglobRecursion: 100 };
		assert.strictEqual(
			new Minimatch(nested, { platform: "posix", ...options }).match("a".repeat(50)),
			oracle.minimatch("a".repeat(50), nested),
		);
		assert.isBelow(fastest(at(nested, options)(50), 100), 100);
		assert.isBelow(fastest(at(nested, options)(400), 1000), 1000);
	});
});

describe("hostility: long extglob chains", () => {
	// A 60 KB chain of quantified extglobs: the memoized walk took 37 s and
	// 2.2 GB for `*(a)` sixteen thousand times against 200 characters, and
	// 141 s for `*(a|?)` ten thousand times against 400. minimatch 11's
	// matcher answers them in milliseconds (11.0.5 itself overflows its
	// stack on them; the port's worklist does not).
	const cold = (pattern: string, n: number) => () => new Minimatch(pattern, { platform: "posix" }).match("a".repeat(n));

	it("answers 60 KB chains in well under a second, and finishes at 1,000 characters", () => {
		for (const [pattern, matches] of [
			["*(a|?)".repeat(10_000), true],
			["*(a)".repeat(16_000), true],
			// sixteen thousand +(a) need sixteen thousand a
			["+(a)".repeat(16_000), false],
		] as const) {
			assert.strictEqual(cold(pattern, 400)(), matches, pattern.slice(0, 8));
			assert.isBelow(fastest(cold(pattern, 400), 500), 500, pattern.slice(0, 8));
			assert.isBelow(fastest(cold(pattern, 1000), 3000), 3000, pattern.slice(0, 8));
		}
	});

	it("compiles and first-matches a chain in time linear in its length", () => {
		// 4x the chain: compile and the first match are each linear, so about
		// 4x (bound 10)
		assert.isBelow(
			growth((k) => cold("*(a)".repeat(k), 200), 1000, 4000, 10),
			10,
		);
	});
});

describe("hostility: stars separated by literals", () => {
	// 10's regexp `^[^/]*?a[^/]*?a…b$` backtracks O(n^k) on k stars: `*a`
	// fourteen times then `b` took 25 s against 40 characters. Every magic
	// portion is matched by minimatch 11's matcher, linear for such a chain.
	// The rows run in this order and the first miss fails the test, so the
	// canary comes first: on the regexp it takes about 0.7 s, so a routing
	// regression fails its bound in about two seconds (three tries) instead of
	// hanging on the 25 s rows after it.
	const rows: ReadonlyArray<readonly [string, string, Record<string, unknown>?]> = [
		[`${"*a".repeat(10)}b`, "a".repeat(40)],
		[`${"*a".repeat(14)}b`, "a".repeat(40)],
		[`src/${"*a".repeat(12)}.ts`, `src/${"a".repeat(40)}.js`],
		[`${"*?".repeat(12)}x`, "a".repeat(40)],
		[`${"*[ab]".repeat(12)}c`, "a".repeat(40)],
		[`**/${"*a".repeat(12)}b`, `x/${"a".repeat(40)}`],
		[`${"*A".repeat(12)}b`, "a".repeat(40), { nocase: true }],
		[`${"*a".repeat(30)}b`, "a".repeat(2000)],
	];

	it("answers each in milliseconds, as the oracle does", () => {
		for (const [pattern, path, options = {}] of rows) {
			// time first, so a slow row fails on its bound before the oracle check
			// runs it once more
			assert.isBelow(
				fastest(() => new Minimatch(pattern, { platform: "posix", ...options }).match(path), 50),
				50,
				pattern,
			);
			const m = new Minimatch(pattern, { platform: "posix", ...options });
			assert.strictEqual(m.match(path), new oracle.Minimatch(pattern, options).match(path), pattern);
		}
	});

	it("matches a star chain in time linear in the path", () => {
		// two stars, so a regression to the regexp is n^2 and fails the bound in
		// seconds rather than hanging on n^30
		const at = (n: number) => {
			const m = new Minimatch(`${"*a".repeat(2)}b`, { platform: "posix" });
			const path = "a".repeat(n);
			return () => m.match(path);
		};
		// 4x the path: the matcher's linear chain test is O(path × pattern), so
		// about 4x (bound 10); the regexp's backtracking would be about 16x
		assert.isBelow(growth(at, 2000, 8000, 10), 10);
	});
});

describe("hostility: negations separated by literals", () => {
	// Inherited from minimatch 11's own matcher: each negation's run stays in
	// every later state, so a chain of `x!(a)` against `xb`... is about cubic
	// (11.0.5 is slower still). Polynomial and bounded by the input: 22 ms at a
	// 400-character path, 1.6 s at 2,000. Callers with untrusted patterns bound
	// the input.
	it("stays cubic, not worse", () => {
		// cold, a fresh matcher each run: a warm one answers from its state
		// cache until the cache passes its budget, which is not the cost
		const at = (n: number) => {
			const pattern = "x!(a)".repeat(n);
			const path = "xb".repeat(n);
			return () => new Minimatch(pattern, { platform: "posix" }).match(path);
		};
		assert.isTrue(at(50)());
		// 2x the chain and the path: cubic is about 8x (bound 16)
		assert.isBelow(growth(at, 125, 250, 16), 16);
	});
});

describe("hostility: nesting the parse does not descend", () => {
	it("fails a deep !( chain typed in the matcher's own guard", () => {
		// #parseAST stops descending past maxExtglobRecursion for an extglob that
		// can not adopt its child (a !( in a !(), so its structural guard never
		// sees the depth. The matcher's build reads every level, and its guard
		// is the one that fires; without it the chain recursed toward a stack
		// overflow.
		for (const depth of [300, 15_000]) {
			const source = `x${"!(".repeat(depth)}a${")".repeat(depth)}`;
			const compiled = GlobPattern.compileResult(source);
			assert.isTrue(Result.isFailure(compiled) && compiled.failure.reason === "NestingDepthExceeded", String(depth));
		}
		// a chain #parseAST does descend fails in its own guard first, the same way
		const adopted = GlobPattern.compileResult(`x${"@(".repeat(300)}a${")".repeat(300)}`);
		assert.isTrue(Result.isFailure(adopted) && adopted.failure.reason === "NestingDepthExceeded");
	});
});

describe("hostility: GlobSet and kept numeric ranges", () => {
	const huge = "{-9007199254740991..9007199254740991}";

	it("never throws from matches when a range after `$` or `\\` can not be split out", () => {
		// Once written as the extglob of its numbers, each alternative of this
		// 294-character pattern (k = 7) ran past the 64 KB pattern cap inside matches.
		for (const k of [1, 7]) {
			for (const member of [`{$,a}${huge}`, `{a\\\\,b}${huge}`, `{a\\,b}${huge}`]) {
				const pattern = member.repeat(k);
				const whole = GlobPattern.compileResult(pattern);
				const set = GlobSet.compileResult([pattern]);
				assert.isTrue(Result.isSuccess(whole) && Result.isSuccess(set), `${k} × ${member}`);
				if (Result.isSuccess(whole) && Result.isSuccess(set)) {
					for (const candidate of ["a1", "$5", "a\\5", "b-3", `${"a7".repeat(k)}`, `${"$-9".repeat(k)}`]) {
						noThrow(() => set.success.matches(candidate), `${k} × ${member} vs ${candidate}`);
						assert.strictEqual(
							set.success.matches(candidate),
							whole.success.matches(candidate),
							`${k} × ${member} vs ${candidate}`,
						);
					}
				}
			}
		}
	}, 30_000);

	it("compiles or fails typed, and then matches without throwing, over hostile range mixes", () => {
		const pieces = [
			"{$,a}",
			"{a\\,b}",
			"{a\\\\,b}",
			"\\",
			"\\\\",
			"$",
			"{0..199}",
			huge,
			"{0..99}",
			"{0..1000000}",
			"x",
			"/",
			"[ab]",
			"*",
			"{x,y}",
			"\\{",
			"}",
			"@(",
			")",
		];
		let seed = 1278;
		const next = (n: number): number => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed % n;
		};
		for (let i = 0; i < 400; i++) {
			let pattern = "";
			for (let j = 1 + next(8); j > 0; j--) pattern += pieces[next(pieces.length)];
			let set: GlobSet | undefined;
			noThrow(() => {
				const compiled = GlobSet.compileResult([pattern, `!${pattern}x`]);
				if (Result.isSuccess(compiled)) set = compiled.success;
			}, pattern);
			if (set === undefined) continue;
			const compiled = set;
			for (const candidate of ["a5", "$150", "x/7", "ab", "a\\5", "{a,b}", "x", "-9007199254740991"]) {
				noThrow(() => compiled.matches(candidate), `${pattern} vs ${candidate}`);
			}
			noThrow(() => [compiled.literals, compiled.wildcards, compiled.excludes], pattern);
		}
	}, 60_000);
});

describe("hostility: regexp work of one compile", () => {
	it("fails typed before building the regexps of a brace expansion past the budget", () => {
		// 100,000 alternatives, each with its own u-flag class regexp: this ran
		// the process out of memory at about 1 GB. Every construction path fails
		// typed instead.
		const source = "[[:alpha:]]{0..99}{0..99}{0..9}";
		assert.strictEqual(
			reasonOf(() => new Minimatch(source, {})),
			"CompileBudgetExceeded",
		);
		const compiled = GlobPattern.compileResult(source);
		assert.isTrue(Result.isFailure(compiled) && compiled.failure.reason === "CompileBudgetExceeded");
		if (Result.isFailure(compiled)) assert.strictEqual(compiled.failure.limit, 8_000_000);
		const set = GlobSet.compileResult(["a/**", source]);
		assert.isTrue(Result.isFailure(set) && set.failure.reason === "CompileBudgetExceeded");
		assert.isTrue(Result.isFailure(Schema.decodeUnknownResult(GlobPattern.FromString)(source)));
	});

	// The CPU time of the fastest of three runs, in milliseconds. Each run gets its own source, since V8 reuses the
	// regexp it compiled for a source it has seen.
	const cpu = (run: (sample: number) => unknown): number => {
		let best = Number.POSITIVE_INFINITY;
		for (let i = 0; i < 3; i++) {
			const start = process.cpuUsage();
			run(i);
			const used = process.cpuUsage(start);
			best = Math.min(best, (used.user + used.system) / 1000);
		}
		return best;
	};

	it("fails typed, before building it, a portion whose one validation regexp holds past 256 property escapes", () => {
		// 3,800 `[[:print:]]` in one portion fit the compile budget and peaked at 3.2 GB while V8 built the regexp: one
		// regexp holds about 400 KB an escape while it is built, whatever the compile spent before it.
		const over = "[[:print:]]".repeat(3800);
		const failed = GlobPattern.compileResult(over);
		assert.isTrue(Result.isFailure(failed) && failed.failure.reason === "CompileBudgetExceeded");
		if (Result.isFailure(failed)) {
			assert.strictEqual(failed.failure.limit, 256);
			assert.strictEqual(failed.failure.actual, 3800);
		}
		assert.strictEqual(
			reasonOf(() => new Minimatch("[[:alpha:]]".repeat(129), {})),
			"CompileBudgetExceeded",
		);
		// 256 escapes still compile and match, as the oracle does.
		const at = "[[:print:]]".repeat(256);
		const compiled = GlobPattern.compileResult(at);
		assert.isTrue(Result.isSuccess(compiled));
		if (Result.isSuccess(compiled)) {
			for (const candidate of ["a".repeat(256), "a".repeat(255)])
				assert.strictEqual(
					compiled.success.matches(candidate),
					oracle.minimatch(candidate, at),
					candidate.length.toString(),
				);
		}
		// The refusal does no regexp work: it costs less than compiling the 256 does (about 100 ms of real work).
		assert.isBelow(
			cpu((sample) => GlobPattern.compileResult(`${over}${sample}`)),
			cpu((sample) => GlobPattern.compileResult(`${at}${sample}`)),
		);
	});

	it("compiles a pattern's defaults engine and its effective engine on one budget", () => {
		// A `nocase` pattern is built twice, under defaults (the value invariant) and under its options. On a budget
		// each, it did twice the work one budget allows. `[[:digit:]]` sixteen times in 200 alternatives is about
		// 5,000,000 units under defaults: it compiles, and with `nocase` its second engine passes the one budget.
		const source = `${"[[:digit:]]".repeat(16)}{${Array.from({ length: 200 }, (_, i) => `q${i}`).join(",")}}`;
		assert.isTrue(Result.isSuccess(GlobPattern.compileResult(source)));
		const nocase = GlobPattern.compileResult(source, GlobPatternOptions.make({ nocase: true }));
		assert.isTrue(Result.isFailure(nocase) && nocase.failure.reason === "CompileBudgetExceeded");
		// Options that change no validation source share every check: `dot` builds the same regexps, charged once.
		assert.isTrue(Result.isSuccess(GlobPattern.compileResult(source, GlobPatternOptions.make({ dot: false }))));
	});

	it("validates a portion repeated across a set once, so members sharing one POSIX-class portion compile", () => {
		// Each member's `[[:alpha:]]*.ts` was validated, and charged about 4,100 units, again: 1,928 members tripped
		// the budget. The validation regexp is one source, checked once in one compile.
		const shared = GlobSet.compileResult(Array.from({ length: 5000 }, (_, i) => `d${i}/[[:alpha:]]*.ts`));
		assert.isTrue(Result.isSuccess(shared));
		if (Result.isSuccess(shared)) {
			assert.isTrue(shared.success.matches("d4999/é.ts"));
			assert.isFalse(shared.success.matches("d4999/1.ts"));
		}
	});

	it("charges a distinct POSIX-class portion its measured cost, about 3,100 units for `[[:alpha:]]`", () => {
		// 1,536 units a property escape (about 465 us at worst to build inside a compile, kept by nothing): distinct
		// members fit about 2,550 to the budget, where 4,096 an escape fit about 1,930.
		const member = (i: number): string => `d${i}/[[:alpha:]]${i}*.ts`;
		const fits = GlobSet.compileResult(Array.from({ length: 2400 }, (_, i) => member(i)));
		assert.isTrue(Result.isSuccess(fits));
		if (Result.isSuccess(fits)) assert.isTrue(fits.success.matches("d2399/x2399.ts"));
		const over = GlobSet.compileResult(Array.from({ length: 2700 }, (_, i) => member(i)));
		assert.isTrue(Result.isFailure(over) && over.failure.reason === "CompileBudgetExceeded");
		if (Result.isFailure(over)) assert.strictEqual(over.failure.limit, 8_000_000);
	}, 30_000);

	it("still compiles an expansion within the budget, and matches it as the oracle does", () => {
		const source = "[[:alpha:]]{0..99}x{0..9}";
		const compiled = GlobPattern.compileResult(source);
		assert.isTrue(Result.isSuccess(compiled));
		if (Result.isSuccess(compiled)) {
			for (const candidate of ["a57x3", "a57x30", "157x3", "é0x9"]) {
				assert.strictEqual(compiled.success.matches(candidate), oracle.minimatch(candidate, source), candidate);
			}
		}
	});
});

describe("hostility: matcher graphs of one compile", () => {
	const kept = "{$,a}{-9007199254740991..9007199254740991}";

	it("fails typed before building the graphs of a range copied into thousands of alternatives", () => {
		// 504 characters, 4,096 alternatives each holding twelve copies of a
		// widest range: this took 16.7 s and 4.2 GB before graphs were charged.
		const source = kept.repeat(12);
		assert.strictEqual(
			reasonOf(() => new Minimatch(source, {})),
			"CompileBudgetExceeded",
		);
		const compiled = GlobPattern.compileResult(source);
		assert.isTrue(Result.isFailure(compiled) && compiled.failure.reason === "CompileBudgetExceeded");
		const set = GlobSet.compileResult([source]);
		assert.isTrue(Result.isFailure(set) && set.failure.reason === "CompileBudgetExceeded");
	});

	it("still compiles the range copied into 128 alternatives, and matches it as the oracle does", () => {
		const source = kept.repeat(7);
		const compiled = GlobPattern.compileResult(source);
		assert.isTrue(Result.isSuccess(compiled));
		if (Result.isSuccess(compiled)) {
			for (const candidate of [
				"$1a2$3a4$5a6$7",
				"a1a2a3a4a5a6a-9007199254740991",
				"a1a2",
				"$1$2$3$4$5$6$9007199254740992",
			]) {
				assert.strictEqual(compiled.success.matches(candidate), oracle.minimatch(candidate, source), candidate);
			}
		}
	});

	it("charges every member of a set to one budget", () => {
		// each member compiles alone; twenty of them are one compile, past it
		const member = (i: number, k: number): string => `d${i}/${kept.repeat(k)}`;
		assert.isTrue(Result.isSuccess(GlobPattern.compileResult(member(0, 8))));
		const many = GlobSet.compileResult(Array.from({ length: 20 }, (_, i) => member(i, 8)));
		assert.isTrue(Result.isFailure(many) && many.failure.reason === "CompileBudgetExceeded");
		if (Result.isFailure(many)) assert.strictEqual(many.failure.pattern, member(1, 8));
		assert.throws(() => GlobSet.make({ patterns: Array.from({ length: 20 }, (_, i) => member(i, 8)) }));
		// a few compile, and match through the engines built for them
		const few = GlobSet.compileResult([member(0, 7), member(1, 7), `!${member(2, 2)}`]);
		assert.isTrue(Result.isSuccess(few));
		if (Result.isSuccess(few)) {
			assert.isTrue(few.success.matches("d0/$1a2$3a4$5a6$7"));
			assert.isFalse(few.success.matches("d1/$1a2"));
		}
	}, 30_000);

	it("hands back what an include's alternatives were charged when it stays whole", () => {
		// Split, each of 100 alternatives builds its own graph of the widest range; whole, the rows share one. Fill the
		// budget so the whole fits and the split does not: the split trips, the include stays whole, and it must be
		// charged only for the whole, not again on top of the alternatives built before the trip.
		const range = "{-9007199254740991..9007199254740991}";
		const include = `{${Array.from({ length: 100 }, (_, i) => `i${i}`).join(",")}}/${range}`;
		const wholeBudget = compileBudget();
		new Minimatch(include, {}, wholeBudget);
		const budget = compileBudget();
		const fillers: Array<string> = [];
		for (let i = 0; ; i++) {
			const before = budget.spent;
			new Minimatch(`f${i}/${range}`, {}, budget);
			if (budget.spent + 2 * (budget.spent - before) + wholeBudget.spent > 8_000_000) break;
			fillers.push(`f${i}/${range}`);
		}
		const set = GlobSet.compileResult([...fillers, include]);
		assert.isTrue(Result.isSuccess(set), Result.isFailure(set) ? set.failure.message : "");
		if (Result.isSuccess(set)) {
			assert.deepStrictEqual(set.success.wildcards.at(-1)?.source, include);
			assert.isTrue(set.success.matches("i42/-7"));
			assert.isFalse(set.success.matches("i100/7"));
		}
		// Control: the split alone does not fit beside the fillers, so the include was refused split.
		const split = compileBudget();
		for (const alternative of Array.from({ length: 100 }, (_, i) => `i${i}/${range}`))
			new Minimatch(alternative, {}, split);
		assert.isAbove(budget.spent + split.spent, 8_000_000);
	}, 30_000);

	it("rewinds a budget to a mark: its spend and the regexps and validations charged after it", () => {
		const budget = compileBudget();
		new Minimatch("a/[[:alpha:]]x*", {}, budget);
		const mark = markBudget(budget);
		const spent = budget.spent;
		new Minimatch("b/[[:digit:]]y*", {}, budget);
		const charged = budget.spent - spent;
		assert.isAbove(charged, 1024);
		rewindBudget(budget, mark);
		assert.strictEqual(budget.spent, spent);
		// The second compile, redone, pays the same again: nothing it built was left behind as already paid for.
		new Minimatch("b/[[:digit:]]y*", {}, budget);
		assert.strictEqual(budget.spent - spent, charged);
		// The first compile's work stays paid: redoing it costs nothing more than its graph items.
		const again = budget.spent;
		new Minimatch("a/[[:alpha:]]x*", {}, budget);
		assert.isBelow(budget.spent - again, 1024);
	});
});
