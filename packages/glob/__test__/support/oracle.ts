// The oracle side of the engine compliance gate, shared by the compliance test
// and the differential runner (`differential/`): the option mapping onto the
// installed minimatch, its one documented defect (brace alternatives joined
// into one Matcher) and the answer the engine is held to under it, plus the
// named exceptions a randomized comparison applies. Not a test file: nothing
// here is collected by vitest.

import type { MinimatchOptions } from "minimatch";
import { Minimatch as OracleMinimatch } from "minimatch";
import type { EngineOptions } from "../../src/internal/minimatch.js";

// Upstream's Platform union has no "posix" member (its posix default is the
// ambient-detection fallback the port deletes). "linux" is behaviorally
// identical (non-win32) and keeps the oracle pinned regardless of the machine
// the suite runs on.
export const oracleOpts = (opts: EngineOptions): MinimatchOptions =>
	({ ...opts, platform: opts.platform === "posix" ? "linux" : opts.platform }) as MinimatchOptions;

// Documented oracle defect: minimatch 11 merges a pattern's brace alternatives
// into one Matcher by joining them with `|`, so a `[` in one alternative and a
// `]` in a later one become a class, and the alternatives between them are
// lost: `b**{Z..a}` (whose alternatives include `b**[`, `b**` and `b**]`) does
// not match its own text in 11, though `b**` does. The engine matches the
// union of the alternatives. Only there is the oracle's answer the union of
// its own per-alternative answers, never a skip.
// Whether one alternative has a `[` that never closes or a `]` outside any
// class, in some portion: only then can joining it to the others make a class.
export const unbalancedBrackets = (alt: string): boolean =>
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
export const bracketsAcrossAlternatives = (m: OracleMinimatch): boolean =>
	m.globSet.length > 1 && m.globSet.some((alt) => unbalancedBrackets(alt) || /[[\]]/.test(alt));
// minimatch's own answer from whether any alternative hit: a hit answers
// `true` under flipNegate and `!negate` otherwise; no hit answers `false`
// under flipNegate and `negate` otherwise.
export const oracleAnswer = (candidate: string, pattern: string, opts: MinimatchOptions): boolean => {
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

/**
 * A `{a..b}` numeric range of 100 or more values. The oracle keeps it as one
 * magic portion rather than expanding it, and past the engine's expansion
 * budget the engine fails typed instead of matching, so a comparison on such a
 * pattern is a named exception, not a divergence.
 */
export const hasLargeNumericRange = (pattern: string): boolean => {
	for (const m of pattern.matchAll(/\{(-?\d+)\.\.(-?\d+)(?:\.\.-?\d+)?\}/g)) {
		const a = Number(m[1]);
		const b = Number(m[2]);
		if (Math.abs(b - a) + 1 >= 100) return true;
	}
	return false;
};

/**
 * The deepest nesting of extglob openers (`@(`, `!(` `*(` `+(` `?(`) in a
 * pattern. Past `maxExtglobRecursion` (default 2) the engine degrades the
 * inner opener to literal text, which the oracle does not do.
 */
export const extglobDepth = (pattern: string): number => {
	let depth = 0;
	let max = 0;
	const stack: Array<boolean> = [];
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern.charAt(i);
		if (c === "\\") {
			i++;
		} else if (c === "(") {
			const ext = i > 0 && "@!*+?".includes(pattern.charAt(i - 1));
			stack.push(ext);
			if (ext) max = Math.max(max, ++depth);
		} else if (c === ")") {
			if (stack.pop() === true) depth--;
		}
	}
	return max;
};

export const pastCapExtglob = (pattern: string, cap = 2): boolean => extglobDepth(pattern) > cap;
