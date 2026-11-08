// Task 3 unit tests for the minimatch core port: escape/unescape, character
// classes, the pattern-length assertion, Minimatch smoke behavior, the
// platform deviation, and reachability of the new AST depth guards.

import { assert, describe, it } from "@effect/vitest";
import { Minimatch as OracleMinimatch, minimatch as oracle } from "minimatch";
import { assertValidPattern } from "../src/internal/assertValidPattern.js";
import { escape as escapePattern } from "../src/internal/escape.js";
import { GuardExceeded } from "../src/internal/limits.js";
import { Minimatch } from "../src/internal/minimatch.js";
import { unescape as unescapePattern } from "../src/internal/unescape.js";

const reasonOf = (fn: () => unknown): string => {
	try {
		fn();
	} catch (e) {
		if (e instanceof GuardExceeded) return e.reason;
		throw e;
	}
	throw new Error("expected a GuardExceeded throw");
};

describe("escape and unescape", () => {
	it("escapes the magic characters with backslashes by default", () => {
		assert.strictEqual(escapePattern("a*b?"), "a\\*b\\?");
		assert.strictEqual(escapePattern("[x](y)"), "\\[x\\]\\(y\\)");
	});

	it("wraps in brackets under windowsPathsNoEscape", () => {
		assert.strictEqual(escapePattern("a*b", { windowsPathsNoEscape: true }), "a[*]b");
	});

	it("escapes braces only with magicalBraces", () => {
		assert.strictEqual(escapePattern("{a}"), "{a}");
		assert.strictEqual(escapePattern("{a}", { magicalBraces: true }), "\\{a\\}");
	});

	it("unescape round-trips escape", () => {
		for (const s of ["a*b?", "[x](y)", "has*star", "no magic at all"]) {
			assert.strictEqual(unescapePattern(escapePattern(s)), s);
		}
	});

	it("an escaped literal matches itself and nothing else", () => {
		const m = new Minimatch(escapePattern("has*star"));
		assert.isTrue(m.match("has*star"));
		assert.isFalse(m.match("hasXstar"));
		assert.isFalse(m.match("hasstar"));
	});

	it("agrees with the oracle on escape and unescape", () => {
		for (const s of ["a*b?", "[x](y)", "{a,b}", "a\\b"]) {
			assert.strictEqual(escapePattern(s), oracle.escape(s));
			assert.strictEqual(unescapePattern(s), oracle.unescape(s));
		}
	});
});

describe("character classes", () => {
	it("matches simple classes, ranges and negations", () => {
		assert.isTrue(new Minimatch("[abc]").match("b"));
		assert.isFalse(new Minimatch("[abc]").match("d"));
		assert.isTrue(new Minimatch("[a-c]x").match("bx"));
		assert.isTrue(new Minimatch("[!a]x").match("bx"));
		assert.isFalse(new Minimatch("[!a]x").match("ax"));
		assert.isTrue(new Minimatch("[^a]x").match("bx"));
	});

	it("matches POSIX classes via unicode properties", () => {
		assert.isTrue(new Minimatch("[[:alpha:]]").match("x"));
		assert.isFalse(new Minimatch("[[:alpha:]]").match("5"));
		assert.isTrue(new Minimatch("[[:digit:]]").match("5"));
		assert.isTrue(new Minimatch("[[:alnum:]]*").match("x5y"));
	});

	it("treats a single-character class as a literal escape", () => {
		// [_] is a valid way to escape glob magic
		assert.isTrue(new Minimatch("[*]").match("*"));
		assert.isFalse(new Minimatch("[*]").match("x"));
	});

	it("agrees with the oracle on degenerate classes", () => {
		for (const [p, c] of [
			["[]", "[]"],
			["[", "["],
			["[a-", "[a-"],
			["[z-a]x", "x"],
			["a[]b", "a[]b"],
		] as const) {
			assert.strictEqual(new Minimatch(p).match(c), oracle(c, p), `${p} vs ${c}`);
		}
	});
});

describe("assertValidPattern", () => {
	it("fails typed past 64KB", () => {
		assert.strictEqual(
			reasonOf(() => assertValidPattern("a".repeat(65537))),
			"PatternTooLong",
		);
		assertValidPattern("a".repeat(65536)); // exactly at the cap: fine
	});

	it("dies on a non-string, programmer error", () => {
		assert.throws(() => assertValidPattern(42 as unknown as string), TypeError);
	});
});

describe("Minimatch smoke", () => {
	it("matches globstar across levels", () => {
		const m = new Minimatch("a/**/b");
		assert.isTrue(m.match("a/b"));
		assert.isTrue(m.match("a/x/b"));
		assert.isTrue(m.match("a/x/y/b"));
		assert.isFalse(m.match("a/x/y/c"));
	});

	it("treats comment patterns as matching nothing", () => {
		assert.isFalse(new Minimatch("#x").match("#x"));
		assert.isTrue(new Minimatch("#x", { nocomment: true }).match("#x"));
	});

	it("treats an empty pattern as matching only the empty string", () => {
		assert.isTrue(new Minimatch("").match(""));
		assert.isFalse(new Minimatch("").match("a"));
	});

	it("negates whole patterns with a leading bang", () => {
		assert.isTrue(new Minimatch("!a/*").match("b/x"));
		assert.isFalse(new Minimatch("!a/*").match("a/x"));
	});

	it("splits backslashes only under platform win32, never ambiently", () => {
		assert.isTrue(new Minimatch("a/b", { platform: "win32" }).match("a\\b"));
		// no ambient process.platform read: default is posix, backslash is an escape
		assert.isFalse(new Minimatch("a/b").match("a\\b"));
	});

	it("dies on a NaN globstar cap, programmer error", () => {
		assert.throws(() => new Minimatch("a/**/b", { maxGlobstarRecursion: Number.NaN }), TypeError);
		assert.throws(() => new Minimatch("a/**/b", { maxGlobstarRecursion: 1.5 }), TypeError);
	});
});

describe("extglob depth behavior", () => {
	it("degrades over-nesting to literal at the default cap, agreeing with the oracle", () => {
		const p = `${"+(".repeat(6)}a${")".repeat(6)}`;
		for (const c of [p, "a", "aa"]) {
			assert.strictEqual(new Minimatch(p).match(c), oracle(c, p), `candidate ${c}`);
		}
	});

	it("caps AST depth typed when maxExtglobRecursion is raised past the nesting cap", () => {
		const deep = `${"!(".repeat(300)}a${")".repeat(300)}`;
		assert.strictEqual(
			reasonOf(() => new Minimatch(deep, { maxExtglobRecursion: 400 })),
			"NestingDepthExceeded",
		);
	});

	it("caps the adoption-chain recursion upstream leaves unbounded", () => {
		// Coalescible types recurse without incrementing extDepth upstream:
		// the real minimatch 10.2.5 dies with RangeError (stack overflow) on this
		// input at DEFAULT options (verified 2026-07-09). The port fails typed.
		const chain = `${"@(".repeat(20000)}a${")".repeat(20000)}`;
		assert.strictEqual(
			reasonOf(() => new Minimatch(chain)),
			"NestingDepthExceeded",
		);
	});

	it("still coalesces reasonable adoption chains like upstream", () => {
		const p = `${"@(".repeat(50)}a${")".repeat(50)}`;
		const m = new Minimatch(p);
		assert.isTrue(m.match("a"));
		assert.isFalse(m.match("b"));
		assert.strictEqual(m.match("a"), oracle("a", p));
	});
});

describe("optimizationLevel 2 dedupe", () => {
	const level2 = { optimizationLevel: 2 } as const;

	it("keeps a row a ** row does not cover (minimatch 11.0.5)", () => {
		// The pairwise compare merged {**/x,x/y} into **/x, so x/y stopped matching.
		const m = new Minimatch("{**/x,x/y}", level2);
		assert.isTrue(m.match("x/y"));
		assert.isTrue(m.match("a/x"));
		assert.strictEqual(m.set.length, 2);
	});

	it("drops a row a * row covers, and an exact duplicate", () => {
		assert.strictEqual(new Minimatch("{a/*/c,a/b/c}", level2).set.length, 1);
		assert.strictEqual(new Minimatch("{a/b,a/./b}", level2).set.length, 1);
		// A dot portion is not covered by * without dot.
		assert.strictEqual(new Minimatch("{a/*/c,a/.b/c}", level2).set.length, 2);
		assert.strictEqual(new Minimatch("{a/*/c,a/.b/c}", { ...level2, dot: true }).set.length, 1);
	});
});

describe("portion rules from minimatch 11", () => {
	type Case = readonly [pattern: string, path: string, expected: boolean, options?: { readonly dot?: boolean }];
	const check = (cases: ReadonlyArray<Case>) => {
		for (const [pattern, path, expected, options] of cases) {
			assert.strictEqual(
				new Minimatch(pattern, { platform: "posix", ...options }).match(path),
				expected,
				`${pattern} vs ${path} (${JSON.stringify(options)})`,
			);
		}
	};

	// The same rows, also asserted against the 11.0.5 oracle.
	const checkBoth = (cases: ReadonlyArray<Case>) => {
		check(cases);
		for (const [pattern, path, expected, options] of cases) {
			assert.strictEqual(
				oracle(path, pattern, { platform: "linux", ...options }),
				expected,
				`oracle: ${pattern} vs ${path}`,
			);
		}
	};

	it("matches an empty path portion only with an empty pattern portion", () => {
		check([
			["a/?(x)", "a/", false],
			["a/*(x)", "a/", false],
			["a/!(x)", "a/", false],
			["*(a|b)", "", false],
			["?(a|b)/a", "/a", false],
			// a trailing / still satisfies a/* and a/**, and an empty portion an empty one
			["a/*", "a/b/", true],
			["a/**", "a/", true],
			["a/", "a/", true],
			["a/?(x)", "a/x", true],
		]);
	});

	it("matches a . or .. portion only through literal dots, with or without dot", () => {
		for (const dot of [true, false]) {
			check([
				["x/!(a)", "x/.", false, { dot }],
				["x/!(a)", "x/..", false, { dot }],
				["x/*.", "x/.", false, { dot }],
				["x/@(.)*", "x/.", false, { dot }],
				["x/.!(x)", "x/..", false, { dot }],
				["x/+([.])", "x/.", false, { dot }],
				["x/!(*).", "x/.", false, { dot }],
				["x/!().", "x/..", false, { dot }],
				["x/*(!(x))", "x/.", false, { dot }],
				// a ! that takes nothing, and literal dots in extglobs
				["x/!(a).", "x/.", true, { dot }],
				["x/!(a)..", "x/..", true, { dot }],
				["x/!(x)!(y).", "x/.", true, { dot }],
				["x/@(.|..)", "x/..", true, { dot }],
				["x/+(.)", "x/..", true, { dot }],
				["x/?(.).", "x/..", true, { dot }],
				["x/@(.|!(a))", "x/.", true, { dot }],
				["x/[.]", "x/.", true, { dot }],
			]);
		}
		// dot still lets !(...) match other dotfiles
		check([
			["x/!(a)", "x/.x", true, { dot: true }],
			["x/!(a)", "x/.x", false],
		]);
	});

	it("keeps a one-character range a class, as 11's literal() does", () => {
		assert.isTrue(new Minimatch("[a-a]", { platform: "posix" }).hasMagic());
		assert.isFalse(new Minimatch("[a]", { platform: "posix" }).hasMagic());
		assert.isFalse(new Minimatch("[\\*]", { platform: "posix" }).hasMagic());
		check([
			["[a-a]", "a", true],
			["x/[.-.]", "x/.", false],
		]);
	});

	it("never lets a wildcard take the leading dot of a dotfile without dot", () => {
		checkBoth([
			// a class beside other magic stays a class, even [.]
			["[.]*", ".a", false],
			["[\\.]*(a|b)", ".a", false],
			["[.]@(a|b)", ".a", false],
			["[.]", ".", true],
			["\\.*", ".a", true],
			// a * reached at the leading dot, after a nullable extglob, ends that match
			["*(a|b)*", ".a", false],
			["?(a|)*", ".a", false],
			["@(a|)*", ".a", false],
			["*(a|b)*", "a.a", true],
			// a !(...) takes nothing at a leading dot
			["x/!(b)", "x/.a", false],
			["x/!(b).a", "x/.a", true],
			// with dot, none of this applies
			["[.]*", ".a", true, { dot: true }],
			["*(a|b)*", ".a", true, { dot: true }],
		]);
	});

	it("reads an extglob opener that is never closed as literal text", () => {
		checkBoth([
			["a*(", "a*(", true],
			["a*(", "ax(", false],
			["a?(", "ax(", false],
			["a+(", "a+(", true],
			// what follows reads as at the enclosing level: a closed extglob stays one
			["@(a|*(b)", "@(a|bb", true],
			["@(a|*(b)", "@(a|", true],
			["@(a|*(b)", "a", false],
			// a * after the opener is one part among several, so it can match nothing
			["*(*", "*(", true],
			["@(a|*", "@(a|", true],
		]);
	});

	it("reads a [ that never closes as a literal and goes on parsing", () => {
		checkBoth([
			["[+(a)", "[a", true],
			["[+(a)", "[aa", true],
			["[!(a)", "[b", true],
			["a[]+(a)", "a[]a", true],
			["[*()", "[x()", false],
			["[*()", "[", true],
			["[x?()", "[x?()", false],
			// a class that closes still holds what is inside it
			["[+(a)]", "+", true],
			["[+(a)]", "a", true],
			["[+(a)]x", "ax", true],
			["@(a[|b])", "a|", true],
		]);
		for (const p of ["[+(a)", "[x", "[*()"]) {
			assert.strictEqual(
				new Minimatch(p, { platform: "posix" }).hasMagic(),
				new OracleMinimatch(p).hasMagic(),
				`hasMagic ${p}`,
			);
		}
	});

	it("reads [:punct:] and [:print:] as minimatch 11 does", () => {
		checkBoth([
			// punct includes symbols
			["[[:punct:]]", "$", true],
			["[[:punct:]]", "^", true],
			["[[:punct:]]", "!", true],
			["[[:punct:]]", "a", false],
			// print is every char but controls
			["[[:print:]]", "a", true],
			["x[[:print:]]", "x ", true],
			["[[:print:]]", "\u0001", false],
		]);
	});

	it("counts an astral character as one, as minimatch 11 does", () => {
		checkBoth([
			["?.txt", "😀.txt", true],
			["??.txt", "😀.txt", false],
			["[!a].md", "😀.md", true],
			["src/?.ts", "src/😀.ts", true],
			["*😀*", "a😀b", true],
			["[😀]", "😀", true],
		]);
		// a one-character class is a literal by code point, so [😀] is not magic
		for (const p of ["[😀]", "[\\😀]", "x[😀]", "[😀a]"]) {
			assert.strictEqual(
				new Minimatch(p, { platform: "posix" }).hasMagic(),
				new OracleMinimatch(p).hasMagic(),
				`hasMagic ${p}`,
			);
		}
	});

	it("reads an escaped extension as written (10's * and ? fast paths compared it with its backslash)", () => {
		checkBoth([
			["*\\.", "a.", true],
			["***\\.", "a.", true],
			["?\\.", "a.", true],
			["?\\.", "?\\.", false],
			["*.\\.", "*.\\.", false],
		]);
	});

	it("writes an escaped regexp syntax character as that character", () => {
		checkBoth([
			["\\|*", "b", false],
			["\\|*", "|b", true],
			["a\\|*", "ab", false],
			["@(\\|x)", "x", false],
			["@(\\|x)", "|x", true],
			["\\(*", "(a", true],
			["\\(*", "a", false],
			["\\)a", ")a", true],
			["\\+*", "+a", true],
			["\\^*", "^a", true],
			["\\$*", "$a", true],
			["\\.*", ".a", true],
			["\\.*", "xa", false],
			["\\{*", "{a", true],
			["\\}*", "}a", true],
		]);
	});

	it("negates exactly the sub-pattern of a !(...), not it and the rest", () => {
		checkBoth([
			// !(*) never matches, since * matches anything, empty included
			["a/!(*)?", "a/A", false],
			["a/!(*)b", "a/b", false],
			["x/a!(b)*", "x/ab", true],
			["x/!(a)*", "x/a", true],
			["x/!(ab)b", "x/abb", false],
			["a/!(b)c", "a/xc", true],
			["a/!(b)c", "a/bc", false],
		]);
		assert.isFalse(new Minimatch("!(*)!(*)", { platform: "posix", nonegate: true }).match("x"));
		assert.isFalse(oracle("x", "!(*)!(*)", { platform: "linux", nonegate: true }));
	});

	it("reads a portion that is exactly an empty extglob with extglobs off", () => {
		checkBoth([
			// ?() and *() are a ? or * and a literal ()
			["?()", "?()", true],
			["?()", "a()", true],
			["*()", "abc()", true],
			["x/*()", "x/{a,}*()", true],
			["?()", ".()", false],
			["*()", ".()", true, { dot: true }],
			// +() and @() are literal text
			["@()", "@()", true],
			["+()", "a()", false],
			// any other empty-bodied extglob matches only the empty string
			["+(|)", "+(|)", false],
			["*(*())", "*(*())", false],
		]);
		assert.isTrue(new Minimatch("?()", { platform: "posix" }).hasMagic());
		assert.isTrue(new Minimatch("*()", { platform: "posix" }).hasMagic());
		assert.isFalse(new Minimatch("+()", { platform: "posix" }).hasMagic());
		assert.isFalse(new Minimatch("@()", { platform: "posix" }).hasMagic());
		for (const p of ["?()", "*()", "+()", "@()"]) {
			assert.strictEqual(new Minimatch(p, { platform: "posix" }).hasMagic(), new OracleMinimatch(p).hasMagic(), p);
		}
	});
});

describe("win32 roots from minimatch 11", () => {
	it("keeps a UNC root with a host and no share a string, as 11 does", () => {
		const cases = [
			["//b", { nocase: true }],
			["//B", { nocase: true }],
			["//?", { windowsNoMagicRoot: true, preserveMultipleSlashes: true }],
			["//?", {}],
			["/b", { nocase: true }],
		] as const;
		for (const [p, o] of cases) {
			const kit = new Minimatch(p, { platform: "win32", ...o });
			const upstream = new OracleMinimatch(p, { platform: "win32", ...o });
			assert.strictEqual(kit.hasMagic(), upstream.hasMagic(), `${p} ${JSON.stringify(o)}`);
			for (const f of ["//b", "//B", "//x"]) assert.strictEqual(kit.match(f), upstream.match(f), `${p} vs ${f}`);
		}
		assert.isFalse(new Minimatch("//b", { platform: "win32", nocase: true }).hasMagic());
	});

	// The answers are minimatch 11.0.5's. A `..` can not remove a drive letter or
	// a UNC host and share; a UNC host and share compare without case; and the
	// long form //?/UNC/host/share matches //host/share and back.
	type WinRow = readonly [
		pattern: string,
		path: string,
		expected: boolean,
		options?: { readonly optimizationLevel?: number; readonly nocase?: boolean },
	];
	const rows: ReadonlyArray<WinRow> = [
		["C:/a/../../x", "x", false],
		["C:/a/../../x", "C:/../x", true],
		["C:/a/../../x", "x", false, { optimizationLevel: 2 }],
		["C:/a/../../x", "C:/../x", true, { optimizationLevel: 2 }],
		["C:/a/../../x", "C:/../x", false, { optimizationLevel: 0 }],
		["x", "C:/a/../../x", false, { optimizationLevel: 2 }],
		["C:/x", "C:/a/../../x", false, { optimizationLevel: 2 }],
		["C:/../x", "C:/a/../../x", true, { optimizationLevel: 2 }],
		["//host/x", "//host/share/../x", false, { optimizationLevel: 2 }],
		["//host/share/x", "//host/share/a/../x", true, { optimizationLevel: 2 }],
		["//host/share/../x", "//host/share/../x", true, { optimizationLevel: 2 }],
		["//host/share/../x", "//host/x", false],
		["//host/share/../x", "//host/share/../x", true],
		["//host/share/a", "//HOST/SHARE/a", true],
		["//HOST/share/a", "//host/SHARE/a", true],
		["//host/share/a", "//host/share/A", false],
		["//host/share/*", "//HOST/Share/b", true],
		["//*/share/a", "//HOST/share/a", true],
		["//*/share/a", "//HOST/SHARE/a", false],
		["//h*/s*/a", "//host/share/a", true],
		["//?/UNC/host/share/a", "//host/share/a", true],
		["//host/share/a", "//?/UNC/host/share/a", true],
		["//?/unc/HOST/share/a", "//host/SHARE/a", true],
		["//?/UNC/host/share/a", "//?/UNC/host/share/a", true],
		["//?/UNC/host/share/a", "//?/unc/host/share/a", true],
		["//?/UNC/host/share/a", "//host/share/a", true, { nocase: true }],
		["//?/UNC/host/share/*", "//host/share/a", true, { nocase: true }],
		["//?/c:/a", "C:/a", true],
		["c:/a", "//?/C:/a", true],
		["C:/*", "c:/x", true],
		["c:/**", "C:/x/y", true],
		["//?/UNC/host/share/../x", "//?/UNC/host/x", false],
		["//?/c:/a/../../x", "//?/c:/x", false],
		["//?/c:/a/../../x", "x", false],
		["C:\\a\\..\\..\\x", "x", false],
		["//host/share/a/**", "//HOST/share/a/b/c", true],
		["**/a", "//host/share/a", true],
		["//host/share/**/a", "//HOST/SHARE/x/a", true],
		["//host/share", "//HOST/SHARE", true],
		["//host/share/", "//HOST/SHARE/", true],
		["//?/UNC/host/share", "//host/share", true],
	];

	it("answers every row as minimatch 11.0.5 does", () => {
		for (const [pattern, path, expected, options] of rows) {
			assert.strictEqual(
				new Minimatch(pattern, { platform: "win32", ...options }).match(path),
				expected,
				`${pattern} vs ${path} (${JSON.stringify(options)})`,
			);
		}
	});

	it("does not change the compiled pattern when a drive letter matches", () => {
		const m = new Minimatch("C:/x", { platform: "win32" });
		assert.isTrue(m.match("c:/x"));
		assert.strictEqual(m.set[0]?.[0], "C:");
	});
});
