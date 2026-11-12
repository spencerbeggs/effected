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
 * minimatch 11.0.5's row merge throws `TypeError: pattern is too long` from its
 * constructor on some short brace patterns (`{x,{0..120}}[a-c]{0..199}.hidden\a`
 * is one), which the kit compiles. A pattern the oracle refuses that way, and
 * for no reason of its own, is a named exception on the one divergence kind
 * where the engine accepts it, never a skip of anything else.
 */
export const oracleRowMergeTooLong = (pattern: string, opts: EngineOptions): boolean => {
	try {
		new OracleMinimatch(pattern, oracleOpts(opts));
		return false;
	} catch (e) {
		return e instanceof TypeError && e.message === "pattern is too long";
	}
};

/**
 * The divergence kinds each named exception may excuse. A kind outside its
 * list is reported, whatever exception the triple carries.
 */
export const EXCEPTION_KINDS: Readonly<Record<string, ReadonlyArray<string>>> = {
	bracketsAcrossAlternatives: ["match"],
	oracleRowMergeTooLong: ["oracle-throws-engine-accepts"],
};
