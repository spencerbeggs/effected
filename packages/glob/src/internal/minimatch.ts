// Ported from minimatch@10.2.5 (https://github.com/isaacs/minimatch)
// Copyright: Isaac Z. Schlueter and Contributors
// License: BlueOak-1.0.0 (https://blueoakcouncil.org/license/1.0.0)
//
// Port notes, the deliberate changes from upstream index.ts:
// - NO ambient environment detection: defaultPlatform (process.platform and
//   the __MINIMATCH_TESTING_PLATFORM__ env read) is deleted; platform is an
//   explicit option defaulting to "posix". All win32 handling (UNC, drive
//   letters, backslash splitting, windowsNoMagicRoot) is kept behind it, and
//   takes minimatch 11.0.5's root rules: a .. can not remove a drive letter or
//   a UNC host and share (#rootIndex, in levelOneOptimize,
//   levelTwoFileOptimize and firstPhasePreProcess); a UNC host and share
//   compare without case; //?/UNC/host/share matches //host/share and back;
//   and a matching drive letter starts the match after it rather than
//   rewriting the compiled pattern's drive to the path's.
// - Dropped surface: the minimatch() convenience function, filter, match,
//   defaults(), sep, the nonull option (only meaningful for match lists),
//   the debug option and its console.error wiring (the no-op debug() method
//   and its call sites are kept so the bodies diff cleanly against
//   upstream), the deprecated allowWindowsEscape, and makeRe() with its
//   regexp field (11.0.5 removed it too; a portion with a !(...) has no
//   regexp of its own, so a whole-pattern regexp could not be built).
// - maxGlobstarRecursion is validated by assertCap (a NaN or non-integer cap
//   is a wiring bug and dies as a TypeError defect). The
//   #matchGlobStarBodySections limit check is kept verbatim: exceeding it is
//   upstream's intentional false negative — an acceptable break in
//   correctness for security — and must never throw; match() stays total.
// - The ** matching in #matchGlobstar and #matchGlobStarBodySections takes
//   minimatch 11.0.4's fixes, and nothing else from that rewrite: each body
//   section's last start comes from the portions that it and the later sections
//   need, not the earlier ones; a body stops short of the tail (fileLength) and
//   the last ** does not walk it; under partial the body is the rest of the
//   pattern, so it can run past the path, and it matches only when the path is
//   used up; and a walk stops at a place already tried (tried), which keeps
//   sections that all fail from taking exponential time.
// - braceExpand keeps the CVE-2022-3517 ReDoS-safe pre-check regex verbatim
//   (credit: Yeting Li). Budget exhaustion inside the expander throws the
//   typed guard signal instead of silently truncating (see
//   braceExpansion.ts).
// - The fs-walk optimizer passes (adjascentGlobstarOptimize, spelled as
//   upstream spells it, levelOneOptimize, levelTwoFileOptimize) are kept
//   behind optimizationLevel, with 11.0.5's win32 root guard. firstPhasePreProcess and
//   secondPhasePreProcess take minimatch 11.0.5's fix for GHSA-g3hv-75wg-m249:
//   the **/.. split stops at braceExpandMax rows or MAX_SPLIT_CELLS added path
//   portions, and fails with the typed ExpansionBudgetExceeded signal where
//   upstream throws a RangeError (a partial split would match some paths and
//   not others); the dedupe is a keyed lookup in place of a pairwise compare,
//   and partsMatch, which only that compare used, is gone.
// - Brace expansion takes minimatch 11.0.5's #expandBraces (expandMarked): a
//   numeric range of 100 or more values is not expanded but marked, and its
//   portion is answered by 11's matcher (rangePortion), so it is magic and no
//   budget applies to it. braceAlternatives, for GlobSet, writes each
//   alternative back as pattern text (no 11 counterpart).
// - One compile shares its regexp work (CompileBudget, MAX_REGEXP_WORK): an
//   identical portion in many rows is compiled once (#portions, as 11 shares
//   a Matcher), identical matcher regexps are built once, and past the budget
//   the compile fails typed (CompileBudgetExceeded) instead of running out of
//   memory; 11 builds its matchers lazily and compiles such a pattern.

import { assertValidPattern } from "./assertValidPattern.js";
import type { CompileBudget } from "./ast.js";
import { AST, compileBudget, portionPlan, rangePortion } from "./ast.js";
import { expand } from "./braceExpansion.js";
import { EXPANSION_MAX, GuardExceeded, MAX_GLOBSTAR_RECURSION, MAX_SPLIT_CELLS, assertCap } from "./limits.js";
import type { EngineOptions, MMRegExp, ParseReturn, ParseReturnFiltered, Platform } from "./types.js";
import { GLOBSTAR } from "./types.js";

export { escape } from "./escape.js";
export type { EngineOptions, MMRegExp, ParseReturn, ParseReturnFiltered, Platform } from "./types.js";
export { unescape } from "./unescape.js";
export { GLOBSTAR };

// a Windows drive letter portion, like `c:`
const isDrive = (p: ParseReturn | undefined): boolean => typeof p === "string" && /^[a-z]:$/i.test(p);

// true for the `UNC` portion of a long UNC root, //?/UNC/host/share
const isLongUNC = (p: ParseReturn | undefined): boolean => typeof p === "string" && /^unc$/i.test(p);

// The index of the host in a row or split path that starts with a
// Windows UNC root: 2 for `//host/share`, and 4 for
// `//?/UNC/host/share`. Otherwise -1. `//?/c:` is not one.
const uncHost = (p: ReadonlyArray<ParseReturn>): number => {
	if (p[0] !== "" || p[1] !== "") return -1;
	const h = p[2] !== "?" ? 2 : isLongUNC(p[3]) ? 4 : -1;
	if (h === -1) return -1;
	const host = p[h];
	const share = p[h + 1];
	return host !== undefined &&
		host !== "" &&
		host !== GLOBSTAR &&
		share !== undefined &&
		share !== "" &&
		share !== GLOBSTAR
		? h
		: -1;
};

// Brace expansion:
// a{b,c}d -> abd acd
// a{b,}c -> abc ac
// a{0..3}d -> a0d a1d a2d a3d
// a{b,c{d,e}f}g -> abg acdfg acefg
// a{b,c}d{e,f}g -> abdeg acdeg abdeg abdfg
//
// Invalid sets are not expanded.
// a{2..}b -> a{2..}b
// a{b}c -> a{b}c
export const braceExpand = (pattern: string, options: EngineOptions = {}): Array<string> => {
	assertValidPattern(pattern);

	// Thanks to Yeting Li <https://github.com/yetingli> for
	// improving this regexp to avoid a ReDOS vulnerability.
	if (options.nobrace || !/\{(?:(?!\{).)*\}/.test(pattern)) {
		// shortcut. no need to expand.
		return [pattern];
	}

	const opts = options.braceExpandMax === undefined ? {} : { max: options.braceExpandMax };
	return expand(pattern, opts);
};

// A numeric range with at least this many values is matched as one pattern
// portion, rather than expanded, as minimatch 11.0.5 does. For a glob walk,
// that is one directory read, in place of a stat for each value.
const RANGE_MIN = 100;
// a {lo..hi} range that is not escaped, and not a ${...} variable
const rangeRe = /(?<![\\$])\{(-?\d+)\.\.(-?\d+)\}/g;

/** A pattern's brace expansion with its large numeric ranges kept whole. */
interface MarkedExpansion {
	readonly set: Array<string>;
	// the char that marks a range in `set`, as `<mark>lo..hi<mark>`; undefined
	// when every range was expanded
	readonly mark: string | undefined;
}

// minimatch 11.0.5's #expandBraces: expand braces, except numeric ranges such
// as {0..999} with at least RANGE_MIN values. Each of those stays in its
// pattern as `<mark>0..999<mark>`, for the Matcher to test. If a range might
// be inside a [...] class, expand all of them instead.
const expandMarked = (pattern: string, options: EngineOptions): MarkedExpansion => {
	const all = (): MarkedExpansion => ({ set: braceExpand(pattern, options), mark: undefined });
	if (options.nobrace) return all();
	let code = 0xe000;
	while (pattern.includes(String.fromCharCode(code))) {
		if (++code > 0xf8ff) return all();
	}
	const mark = String.fromCharCode(code);
	let found = false;
	const marked = pattern.replace(rangeRe, (m, lo: string, hi: string) => {
		const a = Number(lo);
		const b = Number(hi);
		if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || Math.abs(a - b) + 1 < RANGE_MIN) {
			return m;
		}
		found = true;
		return `${mark}${lo}..${hi}${mark}`;
	});
	if (!found) return all();
	const set = braceExpand(marked, options);
	for (const p of set) {
		for (const portion of p.split("/")) {
			const c = portion.indexOf("[");
			if (c !== -1 && c < portion.lastIndexOf(mark)) return all();
		}
	}
	return { set, mark };
};

/**
 * The brace alternatives of `pattern` as pattern text, under default options,
 * for `GlobSet`'s per-alternative classification; undefined when one of them
 * can not be written as text that reads alone as it does in the whole, and
 * the caller keeps the pattern whole. Expansion unescapes braces (`\{a,b}`
 * makes `{a,b}`), and an alternative is not expanded again in the whole, so
 * each brace it still has is escaped. A numeric range of 100 or more values
 * stays one `{lo..hi}` portion, as minimatch 11.0.5 keeps it, and an
 * unescaped `\` just before it is dropped (11's matcher takes it with the
 * range). After a `$` or a literal (escaped) backslash, `{lo..hi}` would not
 * read as a range, so the answer is undefined.
 *
 * An alternative is compiled alone, so one that is exactly `!` (a negation
 * alone), `#` (a comment) or `/` does not mean alone what it means in the
 * whole; the other text does.
 */
export const braceAlternatives = (pattern: string, options: EngineOptions = {}): Array<string> | undefined => {
	const { set, mark } = expandMarked(pattern, options);
	// the run of `\` that ends `out`
	const slashes = (out: string): number => /\\*$/.exec(out)?.[0].length ?? 0;
	const alternatives: Array<string> = [];
	for (const alt of set) {
		let out = "";
		for (let i = 0; i < alt.length; i++) {
			const c = alt.charAt(i);
			const end = c === mark ? alt.indexOf(mark, i + 1) : -1;
			if (end !== -1) {
				const [lo = "", hi = ""] = alt.slice(i + 1, end).split("..");
				// the matcher takes an unescaped `\` just before a range with it
				if (slashes(out) % 2 === 1) out = out.slice(0, -1);
				if (out.endsWith("\\") || out.endsWith("$")) return undefined;
				out += `{${lo}..${hi}}`;
				i = end;
			} else if ((c === "{" || c === "}") && slashes(out) % 2 === 0) {
				out += `\\${c}`;
			} else {
				out += c;
			}
		}
		alternatives.push(out);
	}
	return alternatives;
};

// replace stuff like \* with *
const globMagic = /[?*]|[+@!]\(.*?\)|\[|\]/;

export class Minimatch {
	options: EngineOptions;
	set: Array<Array<ParseReturnFiltered>>;
	pattern: string;

	windowsPathsNoEscape: boolean;
	nonegate: boolean;
	negate: boolean;
	comment: boolean;
	empty: boolean;
	preserveMultipleSlashes: boolean;
	partial: boolean;
	globSet: Array<string>;
	globParts: Array<Array<string>>;
	nocase: boolean;

	isWindows: boolean;
	platform: Platform;
	windowsNoMagicRoot: boolean;
	maxGlobstarRecursion: number;
	// the char that marks numeric ranges in globSet, if any
	#rangeMark: string | undefined;
	// the work of this compile (MAX_REGEXP_WORK), and its shared regexps; a
	// caller compiling several patterns as one (GlobSet) passes one budget
	readonly #budget: CompileBudget;
	// brace expansion can make the same portion in many rows, so they share
	// one compiled portion, as minimatch 11 shares one Matcher
	readonly #portions = new Map<string, ParseReturn>();

	constructor(pattern: string, options: EngineOptions = {}, budget: CompileBudget = compileBudget()) {
		this.#budget = budget;
		assertValidPattern(pattern);

		this.options = options;
		this.maxGlobstarRecursion = assertCap(
			"maxGlobstarRecursion",
			options.maxGlobstarRecursion ?? MAX_GLOBSTAR_RECURSION,
		);
		this.pattern = pattern;
		this.platform = options.platform ?? "posix";
		this.isWindows = this.platform === "win32";
		this.windowsPathsNoEscape = !!options.windowsPathsNoEscape;
		if (this.windowsPathsNoEscape) {
			this.pattern = this.pattern.replace(/\\/g, "/");
		}
		this.preserveMultipleSlashes = !!options.preserveMultipleSlashes;
		this.negate = false;
		this.nonegate = !!options.nonegate;
		this.comment = false;
		this.empty = false;
		this.partial = !!options.partial;
		this.nocase = !!this.options.nocase;
		this.windowsNoMagicRoot =
			options.windowsNoMagicRoot !== undefined ? options.windowsNoMagicRoot : !!(this.isWindows && this.nocase);

		this.globSet = [];
		this.globParts = [];
		this.set = [];

		// make the set of regexps etc.
		this.make();
	}

	hasMagic(): boolean {
		if (this.options.magicalBraces && this.set.length > 1) {
			return true;
		}
		for (const pattern of this.set) {
			for (const part of pattern) {
				if (typeof part !== "string") return true;
			}
		}
		return false;
	}

	debug(..._args: Array<unknown>) {
		// no-op: the upstream debug option and its console.error wiring are
		// dropped; call sites are kept for diffability against upstream.
	}

	make() {
		const pattern = this.pattern;
		const options = this.options;

		// empty patterns and comments match nothing.
		if (!options.nocomment && pattern.charAt(0) === "#") {
			this.comment = true;
			return;
		}

		if (!pattern) {
			this.empty = true;
			return;
		}

		// step 1: figure out negation, etc.
		this.parseNegate();

		// step 2: expand braces
		this.globSet = [...new Set(this.#expandBraces())];

		this.debug(this.pattern, this.globSet);

		// step 3: now we have a set, so turn each one into a series of
		// path-portion matching patterns.
		// These will be regexps, except in the case of "**", which is
		// set to the GLOBSTAR object for globstar behavior,
		// and will not contain any / characters
		//
		// First, we preprocess to make the glob pattern sets a bit simpler
		// and deduped.  There are some perf-killing patterns that can cause
		// problems with a glob walk, but we can simplify them down a bit.
		const rawGlobParts = this.globSet.map((s) => this.slashSplit(s));
		this.globParts = this.preprocess(rawGlobParts);
		this.debug(this.pattern, this.globParts);

		// glob --> regexps
		const set = this.globParts.map((s) => {
			if (this.isWindows && this.windowsNoMagicRoot) {
				// check if it's a drive or unc path. The root of a long UNC
				// path, //?/UNC/host/share, is 6 portions.
				const n = s[2] === "?" && isLongUNC(s[3]) ? 6 : 4;
				const isUNC =
					s[0] === "" &&
					s[1] === "" &&
					(s[2] === "?" || (s[2] !== undefined && !globMagic.test(s[2]))) &&
					// as 11: a root with a host and no share (`//b`) counts too
					s.slice(3, n).every((p) => !globMagic.test(p));
				const startsWithDrive = s[0] !== undefined && /^[a-z]:/i.test(s[0]);
				if (isUNC) {
					return [...s.slice(0, n), ...s.slice(n).map((ss) => this.parse(ss))];
				}
				if (startsWithDrive) {
					return [s[0] as ParseReturn, ...s.slice(1).map((ss) => this.parse(ss))];
				}
			}
			return s.map((ss) => this.parse(ss));
		});

		this.debug(this.pattern, set);

		// filter out everything that didn't compile properly.
		this.set = set.filter((s) => s.indexOf(false) === -1) as Array<Array<ParseReturnFiltered>>;

		// do not treat the ? in UNC paths as magic
		if (this.isWindows) {
			for (let i = 0; i < this.set.length; i++) {
				const p = this.set[i];
				if (
					p !== undefined &&
					p[0] === "" &&
					p[1] === "" &&
					this.globParts[i]?.[2] === "?" &&
					(isDrive(p[3]) || isLongUNC(this.globParts[i]?.[3]))
				) {
					if (isLongUNC(this.globParts[i]?.[3])) p[3] = "UNC";
					p[2] = "?";
				}
			}
		}

		this.debug(this.pattern, this.set);
	}

	// various transforms to equivalent pattern sets that are
	// faster to process in a filesystem walk.  The goal is to
	// eliminate what we can, and push all ** patterns as far
	// to the right as possible, even if it increases the number
	// of patterns that we have to process.
	preprocess(globPartsInput: Array<Array<string>>) {
		let globParts = globPartsInput;
		// if we're not in globstar mode, then turn ** into *
		if (this.options.noglobstar) {
			for (const partset of globParts) {
				for (let j = 0; j < partset.length; j++) {
					if (partset[j] === "**") {
						partset[j] = "*";
					}
				}
			}
		}

		const { optimizationLevel = 1 } = this.options;

		if (optimizationLevel >= 2) {
			// aggressive optimization for the purpose of fs walking
			globParts = this.firstPhasePreProcess(globParts);
			globParts = this.secondPhasePreProcess(globParts);
		} else if (optimizationLevel >= 1) {
			// just basic optimizations to remove some .. parts
			globParts = this.levelOneOptimize(globParts);
		} else {
			// just collapse multiple ** portions into one
			globParts = this.adjascentGlobstarOptimize(globParts);
		}

		return globParts;
	}

	// just get rid of adjascent ** portions
	adjascentGlobstarOptimize(globParts: Array<Array<string>>) {
		return globParts.map((parts) => {
			let gs = parts.indexOf("**");
			while (gs !== -1) {
				let i = gs;
				while (parts[i + 1] === "**") {
					i++;
				}
				if (i !== gs) {
					parts.splice(gs, i - gs);
				}
				gs = parts.indexOf("**", gs + 1);
			}
			return parts;
		});
	}

	// On Windows, the index of the last root portion of a row: 0 for
	// `c:/...`, 3 for `//?/c:/...` and `//host/share/...`, and 5 for
	// `//?/UNC/host/share/...`. Otherwise -1.
	#rootIndex(row: ReadonlyArray<ParseReturn>): number {
		if (!this.isWindows) return -1;
		if (isDrive(row[0])) return 0;
		const uncDrive = row[0] === "" && row[1] === "" && row[2] === "?" && isDrive(row[3]);
		if (uncDrive) return 3;
		const h = uncHost(row);
		return h === -1 ? -1 : h + 1;
	}

	// get rid of adjascent ** and resolve .. portions
	levelOneOptimize(globParts: Array<Array<string>>) {
		return globParts.map((partsInput) => {
			// .. can not remove the root of a Windows path
			const root = this.#rootIndex(partsInput) + 1;
			const parts = partsInput.reduce((set: Array<string>, part) => {
				const prev = set[set.length - 1];
				if (part === "**" && prev === "**") {
					return set;
				}
				if (part === "..") {
					if (set.length > root && prev && prev !== ".." && prev !== "." && prev !== "**") {
						set.pop();
						return set;
					}
				}
				set.push(part);
				return set;
			}, []);
			return parts.length === 0 ? [""] : parts;
		});
	}

	levelTwoFileOptimize(partsInput: string | Array<string>) {
		const parts = Array.isArray(partsInput) ? partsInput : this.slashSplit(partsInput);
		let didSomething = false;

		do {
			didSomething = false;
			// <pre>/<e>/<rest> -> <pre>/<rest>
			if (!this.preserveMultipleSlashes) {
				for (let i = 1; i < parts.length - 1; i++) {
					const p = parts[i];
					// don't squeeze out UNC patterns
					if (i === 1 && p === "" && parts[0] === "") continue;
					if (p === "." || p === "") {
						didSomething = true;
						parts.splice(i, 1);
						i--;
					}
				}
				if (parts[0] === "." && parts.length === 2 && (parts[1] === "." || parts[1] === "")) {
					didSomething = true;
					parts.pop();
				}
			}

			// <pre>/<p>/../<rest> -> <pre>/<rest>
			// .. can not remove the root of a Windows path
			const root = this.#rootIndex(parts) + 1;
			let dd = parts.indexOf("..", root + 1);
			while (dd !== -1) {
				const p = parts[dd - 1];
				if (p && p !== "." && p !== ".." && p !== "**") {
					didSomething = true;
					parts.splice(dd - 1, 2);
					dd = Math.max(dd - 2, root);
				}
				dd = parts.indexOf("..", dd + 1);
			}
		} while (didSomething);
		return parts.length === 0 ? [""] : parts;
	}

	// First phase: single-pattern processing
	// <pre> is 1 or more portions
	// <rest> is 1 or more portions
	// <p> is any portion other than ., .., '', or **
	// <e> is . or ''
	//
	// **/.. is *brutal* for filesystem walking performance, because
	// it effectively resets the recursive walk each time it occurs,
	// and ** cannot be reduced out by a .. pattern part like a regexp
	// or most strings (other than .., ., and '') can be.
	//
	// <pre>/**/../<p>/<p>/<rest> -> {<pre>/../<p>/<p>/<rest>,<pre>/**/<p>/<p>/<rest>}
	// <pre>/<e>/<rest> -> <pre>/<rest>
	// <pre>/<p>/../<rest> -> <pre>/<rest>
	// **/**/<rest> -> **/<rest>
	//
	// **/*/<rest> -> */**/<rest> <== not valid because ** doesn't follow
	// this WOULD be allowed if ** did follow symlinks, or * didn't
	firstPhasePreProcess(globParts: Array<Array<string>>) {
		// each **/.. split doubles the patterns, and adds a copy of the
		// whole pattern. Throw if either gets too large. A partial split
		// would match some paths and not others, depending on which rows
		// the pass reached first.
		const braceExpandMax = assertCap("braceExpandMax", this.options.braceExpandMax ?? EXPANSION_MAX);
		let splitCells = 0;
		let didSomething = false;
		do {
			didSomething = false;
			// <pre>/**/../<p>/<p>/<rest> -> {<pre>/../<p>/<p>/<rest>,<pre>/**/<p>/<p>/<rest>}
			for (const parts of globParts) {
				let gs = parts.indexOf("**");
				while (gs !== -1) {
					let gss = gs;
					while (parts[gss + 1] === "**") {
						// <pre>/**/**/<rest> -> <pre>/**/<rest>
						gss++;
					}
					// eg, if gs is 2 and gss is 4, that means we have 3 **
					// parts, and can remove 2 of them.
					if (gss > gs) {
						parts.splice(gs + 1, gss - gs);
					}

					const next = parts[gs + 1];
					const p = parts[gs + 2];
					const p2 = parts[gs + 3];
					if (next !== "..") {
						gs = parts.indexOf("**", gs + 1);
						continue;
					}
					if (!p || p === "." || p === ".." || !p2 || p2 === "." || p2 === "..") {
						gs = parts.indexOf("**", gs + 1);
						continue;
					}
					// Check before changing parts or allocating the new row.
					const addedCells = parts.length - 1;
					if (globParts.length >= braceExpandMax) {
						throw new GuardExceeded("ExpansionBudgetExceeded", braceExpandMax, globParts.length + 1);
					}
					if (splitCells + addedCells > MAX_SPLIT_CELLS) {
						throw new GuardExceeded("ExpansionBudgetExceeded", MAX_SPLIT_CELLS, splitCells + addedCells);
					}
					didSomething = true;
					// edit parts in place, and push the new one
					parts.splice(gs, 1);
					const other = parts.slice(0);
					other[gs] = "**";
					splitCells += addedCells;
					globParts.push(other);
					gs--;
					gs = parts.indexOf("**", gs + 1);
				}

				// <pre>/<e>/<rest> -> <pre>/<rest>
				if (!this.preserveMultipleSlashes) {
					for (let i = 1; i < parts.length - 1; i++) {
						const p = parts[i];
						// don't squeeze out UNC patterns
						if (i === 1 && p === "" && parts[0] === "") continue;
						if (p === "." || p === "") {
							didSomething = true;
							parts.splice(i, 1);
							i--;
						}
					}
					if (parts[0] === "." && parts.length === 2 && (parts[1] === "." || parts[1] === "")) {
						didSomething = true;
						parts.pop();
					}
				}

				// <pre>/<p>/../<rest> -> <pre>/<rest>
				// .. can not remove the root of a Windows path
				const root = this.#rootIndex(parts) + 1;
				let dd = parts.indexOf("..", root + 1);
				while (dd !== -1) {
					const p = parts[dd - 1];
					if (p && p !== "." && p !== ".." && p !== "**") {
						didSomething = true;
						const needDot = dd === 1 && parts[dd + 1] === "**";
						const splin = needDot ? ["."] : [];
						parts.splice(dd - 1, 2, ...splin);
						if (parts.length === 0) parts.push("");
						dd = Math.max(dd - 2, root);
					}
					dd = parts.indexOf("..", dd + 1);
				}
			}
		} while (didSomething);

		return globParts;
	}

	// second phase: multi-pattern dedupes
	// {<pre>/<rest>,<pre>/<rest>} -> <pre>/<rest>
	// {<pre>/*/<rest>,<pre>/<p>/<rest>} -> <pre>/*/<rest>
	secondPhasePreProcess(globParts: Array<Array<string>>): Array<Array<string>> {
		const keys = new Set<string>();
		const rows = globParts.filter((parts) => {
			const key = parts.join("/");
			if (keys.has(key)) return false;
			keys.add(key);
			return true;
		});

		// A row is covered by another row that has `*` at some positions,
		// and is the same at all others. Collect each distinct set of `*`
		// positions, then look up each row with `*` put at those positions.
		const stars = new Map<string, Array<number>>();
		for (const parts of rows) {
			const s: Array<number> = [];
			for (let i = 0; i < parts.length; i++) {
				if (parts[i] === "*") s.push(i);
			}
			if (s.length) stars.set(s.join(","), s);
		}
		// Each row is checked against each set of `*` positions, so skip
		// this if there are too many. The patterns match the same paths
		// either way.
		if (!stars.size || rows.length * stars.size > 100_000) return rows;

		const { dot } = this.options;
		return rows.filter((parts) => {
			for (const s of stars.values()) {
				if ((s[s.length - 1] as number) >= parts.length) continue;
				const c = [...parts];
				let ok = true;
				let changed = false;
				for (const i of s) {
					const p = parts[i] as string;
					if (p === "*") continue;
					if (!p || p === "**" || (!dot && p.startsWith("."))) {
						ok = false;
						break;
					}
					c[i] = "*";
					changed = true;
				}
				if (ok && changed && keys.has(c.join("/"))) return false;
			}
			return true;
		});
	}

	parseNegate() {
		if (this.nonegate) return;

		const pattern = this.pattern;
		let negate = false;
		let negateOffset = 0;

		const extglobBang = !!this.options.extglobBang && !this.options.noext;
		for (let i = 0; i < pattern.length && pattern.charAt(i) === "!"; i++) {
			// Adaptation: a `!` opening an extglob is not a negation (see EngineOptions.extglobBang).
			if (extglobBang && pattern.charAt(i + 1) === "(" && !/^\?[!=<:]/.test(pattern.slice(i + 2, i + 4))) break;
			negate = !negate;
			negateOffset++;
		}

		if (negateOffset) this.pattern = pattern.slice(negateOffset);
		this.negate = negate;
	}

	// set partial to true to test if, for example,
	// "/a/b" matches the start of "/*/b/*/d"
	// Partial means, if you run out of file before you run
	// out of pattern, then that's fine, as long as all
	// the parts match.
	matchOne(fileInput: Array<string>, pattern: Array<ParseReturn>, partial = false) {
		let file = fileInput;
		let fileStartIndex = 0;
		let patternStartIndex = 0;

		// resolve and reduce . and .. portions in the file as well.
		// don't need to do the second phase, because it's only one string[]
		const { optimizationLevel = 1 } = this.options;
		const resolved = optimizationLevel >= 2 ? this.levelTwoFileOptimize(file) : file;

		// UNC paths like //?/X:/... can match X:/... and vice versa, and
		// //?/UNC/host/share/... can match //host/share/... and vice versa.
		// Drive letters in absolute drive or unc paths, and the host and
		// share of UNC paths, are always compared case-insensitively.
		// Level 2 can resolve the share away (//h/s/../x), so the UNC root
		// is found in the resolved parts.
		const fh = this.isWindows ? uncHost(resolved) : -1;
		const ph = fh === -1 ? -1 : uncHost(pattern);
		if (ph !== -1) {
			const host = pattern[ph];
			const share = pattern[ph + 1];
			if (typeof host !== "string" || typeof share !== "string") {
				// a host or share with magic is matched as usual
				fileStartIndex = fh;
				patternStartIndex = ph;
			} else if (
				(resolved[fh] as string).toLowerCase() === host.toLowerCase() &&
				(resolved[fh + 1] as string).toLowerCase() === share.toLowerCase()
			) {
				fileStartIndex = fh + 2;
				patternStartIndex = ph + 2;
			}
		} else if (this.isWindows) {
			const f0 = file[0];
			const fileDrive = typeof f0 === "string" && /^[a-z]:$/i.test(f0);
			const fileUNC =
				!fileDrive &&
				file[0] === "" &&
				file[1] === "" &&
				file[2] === "?" &&
				typeof file[3] === "string" &&
				/^[a-z]:$/i.test(file[3]);

			const p0 = pattern[0];
			const patternDrive = typeof p0 === "string" && /^[a-z]:$/i.test(p0);
			const patternUNC =
				!patternDrive &&
				pattern[0] === "" &&
				pattern[1] === "" &&
				pattern[2] === "?" &&
				typeof pattern[3] === "string" &&
				/^[a-z]:$/i.test(pattern[3]);

			const fdi = fileUNC ? 3 : fileDrive ? 0 : undefined;
			const pdi = patternUNC ? 3 : patternDrive ? 0 : undefined;
			if (typeof fdi === "number" && typeof pdi === "number") {
				const [fd, pd]: [string, string] = [file[fdi] as string, pattern[pdi] as string];
				// the drives match, so start matching after them
				if (fd.toLowerCase() === pd.toLowerCase()) {
					patternStartIndex = pdi + 1;
					fileStartIndex = fdi + 1;
				}
			}
		}

		// the drive letters are found in the parts before level 2 resolves
		// them, and the match uses the resolved parts
		file = resolved;

		if (pattern.includes(GLOBSTAR)) {
			return this.#matchGlobstar(file, pattern, partial, fileStartIndex, patternStartIndex);
		}

		return this.#matchOne(file, pattern, partial, fileStartIndex, patternStartIndex);
	}

	#matchGlobstar(
		file: Array<string>,
		pattern: Array<ParseReturn>,
		partial: boolean,
		fileIndexInput: number,
		patternIndexInput: number,
	) {
		let fileIndex = fileIndexInput;
		let patternIndex = patternIndexInput;
		// split the pattern into head, tail, and middle of ** delimited parts
		const firstgs = pattern.indexOf(GLOBSTAR, patternIndex);
		const lastgs = pattern.lastIndexOf(GLOBSTAR);

		// split the pattern up into globstar-delimited sections
		// the tail has to be at the end, and the others just have
		// to be found in order from the head.
		const [head, body, tail] = partial
			? [pattern.slice(patternIndex, firstgs), pattern.slice(firstgs + 1), []]
			: [pattern.slice(patternIndex, firstgs), pattern.slice(firstgs + 1, lastgs), pattern.slice(lastgs + 1)];

		// check the head, from the current file/pattern index.
		if (head.length) {
			const fileHead = file.slice(fileIndex, fileIndex + head.length);
			if (!this.#matchOne(fileHead, head, partial, 0, 0)) {
				return false;
			}
			fileIndex += head.length;
			patternIndex += head.length;
		}
		// now we know the head matches!

		// if the last portion is not empty, it MUST match the end
		// check the tail
		let fileTailMatch = 0;
		if (tail.length) {
			// if head + tail > file, then we cannot possibly match
			if (tail.length + fileIndex > file.length) return false;

			// try to match the tail
			let tailStart = file.length - tail.length;
			if (this.#matchOne(file, tail, partial, tailStart, 0)) {
				fileTailMatch = tail.length;
			} else {
				// affordance for stuff like a/**/* matching a/b/
				// if the last file portion is '', and there's more to the pattern
				// then try without the '' bit.
				if (file[file.length - 1] !== "" || fileIndex + tail.length === file.length) {
					return false;
				}
				tailStart--;
				if (!this.#matchOne(file, tail, partial, tailStart, 0)) {
					return false;
				}
				fileTailMatch = tail.length + 1;
			}
		}

		// now we know the tail matches!

		// the middle is zero or more portions wrapped in **, possibly
		// containing more ** sections.
		// so a/**/b/**/c/**/d has become **/b/**/c/**
		// if it's empty, it means a/**/b, just verify we have no bad dots
		// if there's no tail, so it ends on /**, then we must have *something*
		// after the head, or it's not a matc
		if (!body.length) {
			let sawSome = !!fileTailMatch;
			for (let i = fileIndex; i < file.length - fileTailMatch; i++) {
				const f = String(file[i]);
				sawSome = true;
				if (f === "." || f === ".." || (!this.options.dot && f.startsWith("."))) {
					return false;
				}
			}
			// in partial mode, we just need to get past all file parts
			return partial || sawSome;
		}

		// now we know that there's one or more body sections, which can
		// be matched anywhere from the 0 index (because the head was pruned)
		// through to the length-fileTailMatch index.
		// split the body up into sections, and note the number of portions
		// that must come after the start of each one
		// [section, need]
		const bodySegments: Array<[Array<ParseReturn>, number]> = [[[], 0]];
		let currentBody: [Array<ParseReturn>, number] = bodySegments[0] as [Array<ParseReturn>, number];
		let nonGsParts = 0;
		const nonGsPartsSums: Array<number> = [0];
		for (const b of body) {
			if (b === GLOBSTAR) {
				nonGsPartsSums.push(nonGsParts);
				currentBody = [[], 0];
				bodySegments.push(currentBody);
			} else {
				currentBody[0].push(b);
				nonGsParts++;
			}
		}
		// the portions in this section and the ones after it
		for (const [index, b] of bodySegments.entries()) {
			b[1] = nonGsParts - (nonGsPartsSums[index] as number);
		}

		return !!this.#matchGlobStarBodySections(
			file,
			bodySegments,
			file.length - fileTailMatch,
			fileIndex,
			0,
			partial,
			0,
			!!fileTailMatch,
			new Set(),
		);
	}

	// return false for "nope, not matching"
	// return null for "not matching, cannot keep trying"
	#matchGlobStarBodySections(
		file: Array<string>,
		// pattern section, and the portions that it and the rest need
		bodySegments: Array<[Array<ParseReturn>, number]>,
		// the end of the file portions that the body can match
		fileLength: number,
		fileIndexInput: number,
		bodyIndex: number,
		partial: boolean,
		globStarDepth: number,
		sawTailInput: boolean,
		// the places a walk has already tried, as
		// bodyIndex * (file.length + 1) + fileIndex. A walk from a place does
		// the same no matter how it got there, and it only comes back if it
		// found no match, so a walk that gets to one stops. globStarDepth always
		// equals bodyIndex, so the recursion cap can not make two walks differ.
		tried: Set<number>,
	): boolean | null {
		let fileIndex = fileIndexInput;
		let sawTail = sawTailInput;
		// take the first body segment, and walk from fileIndex to its "after"
		// value at the end
		// If it doesn't match at that position, we increment, until we hit
		// that final possible position, and give up.
		// If it does match, then advance and try to rest.
		// If any of them fail we keep walking forward.
		// this is still a bit recursively painful, but it's more constrained
		// than previous implementations, because we never test something that
		// can't possibly be a valid matching condition.
		const bs = bodySegments[bodyIndex];
		if (!bs) {
			// with partial, the body is the rest of the pattern, so it matches
			// if no portions are left, or only the '' of a trailing / (as a/*
			// matches a/b/). A ** at the end walks them as its own empty section.
			if (partial) {
				return fileIndex >= fileLength || (fileIndex === fileLength - 1 && file[fileIndex] === "");
			}
			// just make sure that there's no bad dots before the tail
			for (let i = fileIndex; i < fileLength; i++) {
				sawTail = true;
				const f = file[i] as string;
				if (f === "." || f === ".." || (!this.options.dot && f.startsWith("."))) {
					return false;
				}
			}
			return sawTail;
		}

		// have a non-globstar body section to test, up to the last index where
		// it can start
		const [body, need] = bs;
		// with partial, the path can end before the body does
		const after = partial ? fileLength : fileLength - need;
		while (fileIndex <= after) {
			const key = bodyIndex * (file.length + 1) + fileIndex;
			if (tried.has(key)) return false;
			tried.add(key);
			const m = this.#matchOne(file, body, partial, fileIndex, 0, fileIndex + body.length);
			// if limit exceeded, no match. intentional false negative,
			// acceptable break in correctness for security.
			if (m && globStarDepth < this.maxGlobstarRecursion) {
				// match! see if the rest match. if so, we're done!
				const sub = this.#matchGlobStarBodySections(
					file,
					bodySegments,
					fileLength,
					fileIndex + body.length,
					bodyIndex + 1,
					partial,
					globStarDepth + 1,
					sawTail,
					tried,
				);
				if (sub !== false) {
					return sub;
				}
			}
			// the ** does not walk past the last place the body can start
			if (fileIndex === after) break;
			const f = file[fileIndex] as string;
			if (f === "." || f === ".." || (!this.options.dot && f.startsWith("."))) {
				return false;
			}

			fileIndex++;
		}
		// walked off. no point continuing
		return partial || null;
	}

	// One path portion against one magic pattern portion: minimatch 11.0.5's
	// own matcher answers it, built when the pattern compiled, so nothing
	// here builds a regexp or can throw. The portion's regexp is compile-time
	// validation only (InvalidRegExp): 10's regexp backtracks O(n^k) on k stars
	// separated by literals (`*a` fourteen times then `b` took 25 s against 40
	// characters) and reads UTF-16 code units where 11 reads code points.
	#matchesRegExpPortion(p: MMRegExp, f: string): boolean {
		// An empty path portion only matches an empty pattern portion.
		if (f === "") return false;
		const plan = portionPlan(p);
		return plan === undefined ? p.test(f) : plan.matcher.testUnchecked(f);
	}

	#matchOne(
		file: Array<string>,
		pattern: Array<ParseReturn>,
		partial: boolean,
		fileIndex: number,
		patternIndex: number,
		// only match the file portions before this index
		fileEnd = file.length,
	) {
		let fi: number;
		let pi: number;
		let pl: number;
		let fl: number;
		for (
			fi = fileIndex, pi = patternIndex, fl = Math.min(fileEnd, file.length), pl = pattern.length;
			fi < fl && pi < pl;
			fi++, pi++
		) {
			this.debug("matchOne loop");
			const p = pattern[pi] as ParseReturn;
			const f = file[fi] as string;

			this.debug(pattern, p, f);

			// should be impossible.
			// some invalid regexp stuff in the set.
			if (p === false || p === GLOBSTAR) {
				return false;
			}

			// something other than **
			// non-magic patterns just have to match exactly
			// patterns with magic have been turned into regexps.
			let hit: boolean;
			if (typeof p === "string") {
				hit = f === p;
				this.debug("string match", p, f, hit);
			} else {
				// An empty path portion only matches an empty pattern portion, a .
				// or .. portion only matches through literal dots, no wildcard takes
				// the leading dot of a dotfile without `dot`, and a !(...) negates
				// exactly its sub-pattern (all minimatch 11).
				hit = this.#matchesRegExpPortion(p, f);
				this.debug("pattern match", p, f, hit);
			}

			if (!hit) return false;
		}

		// Note: ending in / means that we'll get a final ""
		// at the end of the pattern.  This can only match a
		// corresponding "" at the end of the file.
		// If the file ends in /, then it can only match a
		// a pattern that ends in /, unless the pattern just
		// doesn't have any more for it. But, a/b/ should *not*
		// match "a/b/*", even though "" matches against the
		// [^/]*? pattern, except in partial mode, where it might
		// simply not be reached yet.
		// However, a/b/ should still satisfy a/*

		// now either we fell off the end of the pattern, or we're done.
		if (fi === fl && pi === pl) {
			// ran out of pattern and filename at the same time.
			// an exact hit!
			return true;
		}
		if (fi === fl) {
			// ran out of file, but still had pattern left.
			// this is ok if we're doing the match as part of
			// a glob fs traversal.
			return partial;
		}
		if (pi === pl) {
			// ran out of pattern, still have file left.
			// this is only acceptable if we're on the very last
			// empty segment of a file with a trailing slash.
			// a/* should match a/b/
			return fi === fl - 1 && file[fi] === "";
		}

		// should be unreachable.
		throw new Error("wtf?");
	}

	braceExpand() {
		return braceExpand(this.pattern, this.options);
	}

	// minimatch 11.0.5: braces expand, except a numeric range of 100 or more
	// values, which stays marked in its portion for the Matcher (expandMarked).
	#expandBraces(): Array<string> {
		const { set, mark } = expandMarked(this.pattern, this.options);
		this.#rangeMark = mark;
		return set;
	}

	parse(pattern: string): ParseReturn {
		assertValidPattern(pattern);

		// shortcuts
		if (pattern === "**") return GLOBSTAR;
		if (pattern === "") return "";

		const known = this.#portions.get(pattern);
		if (known !== undefined) return known;
		// a portion with a marked range is magic, answered by 11's matcher. 10's
		// `*`, `*.*`, `*.<ext>` and `?…` fast tests are gone: minimatch 11's
		// matcher answers every magic portion (port note 9 in ast.ts), with its
		// own linear path for a chain of `*`, `?` and literals.
		const rangeMark = this.#rangeMark;
		const parsed =
			rangeMark !== undefined && pattern.includes(rangeMark)
				? rangePortion(pattern, this.options, rangeMark, this.#budget)
				: AST.fromGlob(pattern, this.options).toMMPattern(this.#budget);
		this.#portions.set(pattern, parsed);
		return parsed;
	}

	slashSplit(p: string) {
		// if p starts with // on windows, we preserve that
		// so that UNC paths aren't broken.  Otherwise, any number of
		// / characters are coalesced into one, unless
		// preserveMultipleSlashes is set to true.
		if (this.preserveMultipleSlashes) {
			return p.split("/");
		}
		if (this.isWindows && /^\/\/[^/]+/.test(p)) {
			// add an extra '' for the one we lose
			return ["", ...p.split(/\/+/)];
		}
		return p.split(/\/+/);
	}

	match(fInput: string, partial = this.partial) {
		this.debug("match", fInput, this.pattern);
		// short-circuit in the case of busted things.
		// comments, etc.
		if (this.comment) {
			return false;
		}
		if (this.empty) {
			return fInput === "";
		}

		if (fInput === "/" && partial) {
			return true;
		}

		const options = this.options;

		// windows: need to use /, not \
		let f = fInput;
		if (this.isWindows) {
			f = f.split("\\").join("/");
		}

		// treat the test path as a set of pathparts.
		const ff = this.slashSplit(f);
		this.debug(this.pattern, "split", ff);

		// just ONE of the pattern sets in this.set needs to match
		// in order for it to be valid.  If negating, then just one
		// match means that we have failed.
		// Either way, return on the first hit.

		const set = this.set;
		this.debug(this.pattern, "set", set);

		// Find the basename of the path by looking for the last non-empty segment
		let filename = ff[ff.length - 1] ?? "";
		if (!filename) {
			for (let i = ff.length - 2; !filename && i >= 0; i--) {
				filename = ff[i] ?? "";
			}
		}

		for (const pattern of set) {
			let file = ff;
			if (options.matchBase && pattern.length === 1) {
				file = [filename];
			}
			const hit = this.matchOne(file, pattern, partial);
			if (hit) {
				if (options.flipNegate) {
					return true;
				}
				return !this.negate;
			}
		}

		// didn't get any hits.  this is success if it's a negative
		// pattern, failure otherwise.
		if (options.flipNegate) {
			return false;
		}
		return this.negate;
	}
}
