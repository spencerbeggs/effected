// Ported from brace-expansion@5.0.13 (https://github.com/juliangruber/brace-expansion)
// Copyright (c) 2013 Julian Gruber <julian@juliangruber.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of
// this software and associated documentation files (the "Software"), to deal in
// the Software without restriction, including without limitation the rights to
// use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
// of the Software, and to permit persons to whom the Software is furnished to do
// so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// Port notes. expand_ follows 5.0.13's iterative scan: one loop consumes a
// string's top-level groups left to right, so the {a},b} rewrite count
// (EXPANSION_MAX_REWRITES, past which the rest stays literal exactly as upstream
// leaves it) and the choice to drop empty results are held once per scan, and
// a chain never recurses. It takes EXPANSION_MAX_LENGTH (CVE-2026-14257) on the
// characters of the results and of a comma set's alternatives. parseCommaParts
// keeps 5.0.7's recursive shape behind guard 2; upstream's nesting depth of
// 1,000 that degrades to literal is covered by guard 1.
//
// From 5.0.13 it takes the step budget whole: EXPANSION_MAX_STEPS of work per
// expand call, shared by every level of it (`Budget`). Each character a scan
// walks, each result combine builds and each sequence value (a padded one, a
// step per character) costs a step, and each expand_ call CALL_STEPS more.
// Past the budget the set being expanded and the rest of its string stay
// literal, at every level still expanding, exactly as upstream. With it come
// 5.0.13's three linear rewrites of quadratic scans: maskUnmatchedOpens (an
// unmatched `{` heading every group made each scan read to the end),
// commaSetFollows (one backward pass in place of the backtracking
// /,(?!,).*\}/ test), and combine skipping a set's empty values for an empty
// prefix instead of visiting them one at a time. The escape tokens take
// Math.random().toFixed(16), so a token never prints in exponent form.
//
// Three deliberate changes from upstream:
// 1. Depth guard on expand_ at MAX_NESTING_DEPTH — comma-bearing nesting
//    descends one frame per level; the guard throws GuardExceeded
//    ("NestingDepthExceeded") instead of overflowing the stack. The upstream
//    {a},b} for-loop rewrite and the lazy tail evaluation (a group's tail is
//    scanned only after the group, once; both load-bearing DoS fixes) are
//    kept exactly.
// 2. Depth guard on parseCommaParts — self-recursive on the post side;
//    upstream made it iterative.
// 3. Budget exhaustion THROWS GuardExceeded("ExpansionBudgetExceeded") where
//    upstream silently truncates the expansion list at max or at
//    EXPANSION_MAX_LENGTH — silent truncation silently changes match semantics;
//    the typed signal is the honest surface.
//    The max cap itself is validated by assertCap: a NaN or non-integer max is
//    programmer error and dies as a TypeError defect.
//
// How the step budget sits beside them. It is not a results budget and is not
// part of change 3: it bounds work, not what comes out, and running out of it
// changes no answer silently, because what it leaves is the pattern's own text,
// literal, as the {a},b} rewrite cap and upstream's depth cap leave theirs. A
// truncated result list drops alternatives a caller asked for; a literal brace
// set matches only itself. So `max` and EXPANSION_MAX_LENGTH throw, and the step
// budget stays literal as upstream, which keeps the engine equal to the oracle
// on every pattern that is too much work but not too many results. Each check
// fires where upstream's does, in upstream's order: a results bound throws at
// the point upstream would truncate, and the step budget is charged after, so a
// pattern can reach only one of the two first. Where upstream truncates at max
// and then runs out of steps, it answers the literal and the engine has already
// thrown; that pattern was already past max, the divergence change 3 documents.
// Guards 1 and 2 trip before the budget on any pattern under the 64KB pattern
// cap that nests or chains past 256 with little else in it (256 levels of
// nesting cost well under a million steps); a pattern padded to spend the budget first
// stays literal on the way down, as upstream, and never reaches the guard.

import { range } from "./balancedMatch.js";
import {
	EXPANSION_MAX,
	EXPANSION_MAX_LENGTH,
	EXPANSION_MAX_REWRITES,
	EXPANSION_MAX_STEPS,
	GuardExceeded,
	MAX_NESTING_DEPTH,
	assertCap,
} from "./limits.js";

// What one expand_ call costs on top of what it scans and builds: a set whose
// results are wrapped and expanded again makes one call per result, each
// scanning next to nothing (upstream's CALL_STEPS).
const CALL_STEPS = 16;

/** The steps one `expand` call has left, shared by every level of it. Overdrawn when negative. */
interface Budget {
	remaining: number;
}

const escSlash = `\0SLASH${Math.random().toFixed(16)}\0`;
const escOpen = `\0OPEN${Math.random().toFixed(16)}\0`;
const escClose = `\0CLOSE${Math.random().toFixed(16)}\0`;
const escComma = `\0COMMA${Math.random().toFixed(16)}\0`;
const escPeriod = `\0PERIOD${Math.random().toFixed(16)}\0`;
const escSlashPattern = new RegExp(escSlash, "g");
const escOpenPattern = new RegExp(escOpen, "g");
const escClosePattern = new RegExp(escClose, "g");
const escCommaPattern = new RegExp(escComma, "g");
const escPeriodPattern = new RegExp(escPeriod, "g");
const slashPattern = /\\\\/g;
const openPattern = /\\{/g;
const closePattern = /\\}/g;
const commaPattern = /\\,/g;
const periodPattern = /\\\./g;

const numeric = (str: string): number => (Number.isNaN(Number(str)) ? str.charCodeAt(0) : Number.parseInt(str, 10));

const escapeBraces = (str: string): string =>
	str
		.replace(slashPattern, escSlash)
		.replace(openPattern, escOpen)
		.replace(closePattern, escClose)
		.replace(commaPattern, escComma)
		.replace(periodPattern, escPeriod);

const unescapeBraces = (str: string): string =>
	str
		.replace(escSlashPattern, "\\")
		.replace(escOpenPattern, "{")
		.replace(escClosePattern, "}")
		.replace(escCommaPattern, ",")
		.replace(escPeriodPattern, ".");

interface BudgetedMatch {
	readonly end: number;
	readonly pre: string;
	readonly body: string;
	readonly post: string;
	readonly unmatched: boolean;
}

// `balanced`, run on `masked` (see maskUnmatchedOpens), sliced from `str` and
// charged for the characters it walks: up to the group's `}`, or the whole
// string when there is no match or an unmatched `{` comes first, which
// `unmatched` then flags for masking. Once a call overdraws the budget, it and
// every later one answer undefined, so the rest stays literal.
const balancedWithBudget = (str: string, masked: string, budget: Budget): BudgetedMatch | undefined => {
	if (budget.remaining < 0) {
		return undefined;
	}
	const r = range("{", "}", masked);
	const unmatched = r !== undefined && masked.indexOf("{") < r[0];
	budget.remaining -= r && !unmatched ? r[1] + 1 : str.length;
	if (!r || budget.remaining < 0) {
		return undefined;
	}
	return {
		end: r[1],
		pre: str.slice(0, r[0]),
		body: str.slice(r[0] + 1, r[1]),
		post: str.slice(r[1] + 1),
		unmatched,
	};
};

// `masked` with every `{` that has no matching `}` swapped for a `\0`, which
// keeps the length, so a scan of it still lines up with the string it came
// from. Such a `{` is literal either way, but a scan only learns it is
// unmatched by reading to the end of the string, so with one heading every
// group (`'{a,{b,c}'.repeat(n)`) each scan read the rest of the input:
// quadratic. A scan of the masked copy stops at the group's `}`. One pass,
// charged as one.
const maskUnmatchedOpens = (masked: string, budget: Budget): string => {
	budget.remaining -= masked.length;
	const open: Array<number> = [];
	for (let i = 0; i < masked.length; i++) {
		const c = masked.charCodeAt(i);
		if (c === 0x7b) {
			open.push(i);
		} else if (c === 0x7d && open.length) {
			open.pop();
		}
	}
	let out = "";
	let last = 0;
	for (const at of open) {
		out += `${masked.slice(last, at)}\0`;
		last = at + 1;
	}
	return out + masked.slice(last);
};

// Whether `str` has a `,` not followed by another `,`, with a `}` after it on
// the same line: what `/,(?!,).*\}/.test(str)` asks, answered in one pass from
// the end. The regex backtracks through the rest of the line from every `,`,
// which is quadratic, and the {a},b} rewrite asks again on every pass. Charged
// for the whole string, and refused if that overdraws the budget.
const commaSetFollows = (str: string, budget: Budget): boolean => {
	budget.remaining -= str.length;
	if (budget.remaining < 0) {
		return false;
	}
	// Whether a `}` follows the current position before the line ends
	let close = false;
	for (let i = str.length - 1; i >= 0; i--) {
		const c = str.charCodeAt(i);
		if (c === 0x7d) {
			close = true;
		} else if (c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029) {
			// A line terminator, which `.` does not match
			close = false;
		} else if (c === 0x2c && close && str.charCodeAt(i + 1) !== 0x2c) {
			return true;
		}
	}
	return false;
};

/**
 * Basically just str.split(","), but handling cases where we have nested
 * braced sections, which should be treated as individual members, like
 * {a,{b,c},d}.
 *
 * Answers `undefined` when the step budget runs out before the whole set is
 * split, since splitting what is left on every comma would tear apart the
 * nested sets it still holds.
 */
const parseCommaParts = (str: string, depth: number, budget: Budget): Array<string> | undefined => {
	if (depth > MAX_NESTING_DEPTH) {
		throw new GuardExceeded("NestingDepthExceeded", MAX_NESTING_DEPTH, depth);
	}
	if (!str) {
		return [""];
	}

	// A set's body holds no unmatched `{`, so there is nothing to mask.
	const m = balancedWithBudget(str, str, budget);
	if (budget.remaining < 0) {
		return undefined;
	}

	if (!m) {
		return str.split(",");
	}

	const { pre, body, post } = m;
	const p = pre.split(",");

	p[p.length - 1] += `{${body}}`;
	if (post.length) {
		const postParts = parseCommaParts(post, depth + 1, budget);
		if (postParts === undefined) {
			return undefined;
		}
		p[p.length - 1] += postParts.shift() ?? "";
		p.push(...postParts);
	}

	return p;
};

export interface BraceExpansionOptions {
	readonly max?: number;
}

/**
 * Expand a brace pattern into its alternatives, Bash 4.3 style.
 *
 * Guard behavior (see the port notes above): over-deep nesting and results-budget
 * exhaustion throw {@link GuardExceeded}; a pattern past the step budget stays
 * literal, as upstream; an invalid `max` dies as a `TypeError` defect.
 */
export const expand = (str: string, options: BraceExpansionOptions = {}): Array<string> => {
	if (!str) {
		return [];
	}

	const max = assertCap("braceExpandMax", options.max ?? EXPANSION_MAX);

	// I don't know why Bash 4.3 does this, but it does.
	// Anything starting with {} will have the first two bytes preserved
	// but *only* at the top level, so {},a}b will not expand to anything,
	// but a{},b}c will be expanded to [a}c,abc].
	// One could argue that this is a bug in Bash, but since the goal of
	// this module is to match Bash's rules, we escape a leading {}
	let input = str;
	if (input.slice(0, 2) === "{}") {
		input = `\\{\\}${input.slice(2)}`;
	}

	return expand_(escapeBraces(input), max, true, 0, { remaining: EXPANSION_MAX_STEPS }).map(unescapeBraces);
};

const embrace = (str: string): string => `{${str}}`;

const isPadded = (el: string): boolean => /^-?0\d/.test(el);

const lte = (i: number, y: number): boolean => i <= y;

const gte = (i: number, y: number): boolean => i >= y;

// Every `acc[a] + pre + values[v]`, in order. Upstream's `combine` stops at
// `max` results or EXPANSION_MAX_LENGTH characters and returns what it has;
// here the first result that would be kept past either bound fails typed
// (deviation 3). Empty results are dropped (when `dropEmpties`) before they
// count, as upstream drops them: only an empty `acc[a] + pre` can make one, so
// for those the set's empty values are skipped without being visited. Each
// result built is a step, charged once the combination is built.
const combine = (
	acc: ReadonlyArray<string>,
	pre: string,
	values: ReadonlyArray<string>,
	max: number,
	dropEmpties: boolean,
	budget: Budget,
): Array<string> => {
	const out: Array<string> = [];
	let length = 0;
	let nonEmpty: ReadonlyArray<string> | undefined;
	for (let a = 0; a < acc.length; a++) {
		const prefix = acc[a] + pre;
		let vs = values;
		if (dropEmpties && !prefix) {
			nonEmpty ??= values.filter((v) => v);
			vs = nonEmpty;
		}
		for (let v = 0; v < vs.length; v++) {
			const expansion = prefix + vs[v];
			if (out.length >= max) {
				// A lower bound on the full expansion size: what is kept plus what
				// remains of this combination.
				throw new GuardExceeded("ExpansionBudgetExceeded", max, out.length + (acc.length - a) * values.length - v);
			}
			if (length + expansion.length > EXPANSION_MAX_LENGTH) {
				throw new GuardExceeded("ExpansionBudgetExceeded", EXPANSION_MAX_LENGTH, length + expansion.length);
			}
			out.push(expansion);
			length += expansion.length;
		}
	}
	budget.remaining -= out.length;
	return out;
};

// The values of one numeric (`1..5`) or alphabetic (`a..e..2`) sequence body,
// or `undefined` when the step budget runs out generating them.
const expandSequence = (
	body: string,
	isAlphaSequence: boolean,
	max: number,
	budget: Budget,
): Array<string> | undefined => {
	const n = body.split(/\.\./);
	const N: Array<string> = [];
	const n0 = n[0];
	const n1 = n[1];
	// A sequence body always splits into two or three parts.
	if (n0 === undefined || n1 === undefined) return N;
	const x = numeric(n0);
	const y = numeric(n1);
	const width = Math.max(n0.length, n1.length);
	const n2 = n[2];
	let incr = n.length === 3 && n2 !== undefined ? Math.max(Math.abs(numeric(n2)), 1) : 1;
	let test = lte;
	const reverse = y < x;
	if (reverse) {
		incr *= -1;
		test = gte;
	}
	const pad = n.some(isPadded);

	// Budget check up front: the member count is exactly computable, so an
	// over-budget sequence trips before any work is done (upstream truncates the
	// loop at max instead).
	const total = Math.floor(Math.abs(y - x) / Math.abs(incr)) + 1;
	if (total > max) {
		throw new GuardExceeded("ExpansionBudgetExceeded", max, total);
	}

	// Each value is a step; a padded one is built to `width`, which the input
	// sets, so it costs a step per character.
	const cost = pad ? width : 1;
	let length = 0;
	for (let i = x; test(i, y); i += incr) {
		budget.remaining -= cost;
		if (budget.remaining < 0) {
			return undefined;
		}
		let c: string;
		if (isAlphaSequence) {
			c = String.fromCharCode(i);
			if (c === "\\") {
				c = "";
			}
		} else {
			c = String(i);
			if (pad) {
				const need = width - c.length;
				if (need > 0) {
					const z = "0".repeat(need);
					c = i < 0 ? `-${z}${c.slice(1)}` : `${z}${c}`;
				}
			}
		}
		if (length + c.length > EXPANSION_MAX_LENGTH) {
			throw new GuardExceeded("ExpansionBudgetExceeded", EXPANSION_MAX_LENGTH, length + c.length);
		}
		N.push(c);
		length += c.length;
	}
	return N;
};

// Consume the string's top-level brace groups left to right, threading the
// running set of combined prefixes (`acc`), as brace-expansion 5.0.13 does. The
// scan is one loop, so the {a},b} rewrite count and the choice to drop empty
// results are held once for the whole chain; recursion happens only into a
// group's own body (its comma parts, or a {{...}} body), each a fresh scan on
// the one shared step budget.
// oxlint-disable-next-line func-style
function expand_(str: string, max: number, isTopInput: boolean, depth: number, budget: Budget): Array<string> {
	// An overdraft here makes the first scan refuse, so `str` stays literal.
	budget.remaining -= CALL_STEPS;
	if (depth > MAX_NESTING_DEPTH) {
		throw new GuardExceeded("NestingDepthExceeded", MAX_NESTING_DEPTH, depth);
	}

	let acc: Array<string> = [""];
	let current = str;
	// `current` with its unmatched `{` masked, once a scan has run into them
	let masked = str;
	let isTop = isTopInput;
	// How many times the `{a},b}` rewrite below has restarted the scan. Each
	// pass re-reads the whole string, so leaving this unbounded is quadratic.
	let rewrites = 0;
	// Bash drops empty results, but only when the *first* top-level group is a
	// comma set: a sequence like `{a..\}` may legitimately yield ''. The drop is
	// on the final strings, so it applies to the `combine` that produces them
	// (the one with no brace set left in the tail).
	let dropEmpties = false;
	let firstGroup = true;

	for (;;) {
		const m = balancedWithBudget(current, masked, budget);
		// No brace set left, or no step budget left to look for one: the rest of
		// the string is literal.
		if (!m) {
			return combine(acc, current, [""], max, dropEmpties, budget);
		}
		if (m.unmatched) {
			masked = maskUnmatchedOpens(masked, budget);
		}

		// no need to expand pre, since it is guaranteed to be free of brace-sets
		const pre = m.pre;

		// This set and the rest of the string, literal: for a set that cannot
		// expand, and for one the step budget runs out on. Once the budget is
		// overdrawn every set still being expanded, at every level, stays literal
		// like this, so no level above goes on combining what it could not pay for.
		const literal = (): Array<string> => combine(acc, `${pre}{${m.body}}${m.post}`, [""], max, dropEmpties, budget);

		if (/\$$/.test(pre)) {
			acc = combine(acc, `${pre}{${m.body}}`, [""], max, dropEmpties && !m.post.length, budget);
			firstGroup = false;
			if (!m.post.length) break;
			current = m.post;
			masked = masked.slice(m.end + 1);
			continue;
		}

		const isNumericSequence = /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(m.body);
		const isAlphaSequence = /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/.test(m.body);
		const isSequence = isNumericSequence || isAlphaSequence;
		const isOptions = m.body.indexOf(",") >= 0;
		if (!isSequence && !isOptions) {
			// {a},b}
			if (rewrites < EXPANSION_MAX_REWRITES && commaSetFollows(m.post, budget)) {
				rewrites++;
				current = `${m.pre}{${m.body}${escClose}${m.post}`;
				// Taking a `}` away never gives an unmatched `{` a partner, so what is
				// masked stays unmatched; the `{` it closed may be left without one,
				// and the next scan masks it.
				masked = masked.slice(0, m.end) + escClose + masked.slice(m.end + 1);
				isTop = true;
				continue;
			}
			// Nothing here expands, so the whole remaining string is literal.
			return literal();
		}

		if (firstGroup) {
			dropEmpties = isTop && !isSequence;
			firstGroup = false;
		}

		let values: Array<string>;
		if (isSequence) {
			const sequence = expandSequence(m.body, isAlphaSequence, max, budget);
			if (sequence === undefined) {
				return literal();
			}
			values = sequence;
		} else {
			let n = parseCommaParts(m.body, depth + 1, budget);
			// The step budget ran out partway through the set.
			if (n === undefined) {
				return literal();
			}
			const first = n[0];
			if (n.length === 1 && first !== undefined) {
				// x{{a,b}}y ==> x{a}y x{b}y
				n = expand_(first, max, false, depth + 1, budget).map(embrace);
				// The step budget ran out expanding the set's only part.
				if (budget.remaining < 0) {
					return literal();
				}
				if (n.length === 1) {
					const next = combine(acc, pre + n[0], [""], max, dropEmpties && !m.post.length, budget);
					if (budget.remaining < 0) {
						return literal();
					}
					acc = next;
					if (!m.post.length) break;
					current = m.post;
					masked = masked.slice(m.end + 1);
					continue;
				}
			}
			// Values `combine` is going to drop as empty produce no result, so they
			// must not count against `max`: skip them outright.
			let dropsEmpties = dropEmpties && !m.post.length && !pre;
			for (let d = 0; dropsEmpties && d < acc.length; d++) {
				if (acc[d]) dropsEmpties = false;
			}
			// The alternatives are bounded together, not only each one by itself.
			values = [];
			let valuesLength = 0;
			for (const part of n) {
				const expanded = expand_(part, max, false, depth + 1, budget);
				// The step budget ran out expanding a member.
				if (budget.remaining < 0) {
					return literal();
				}
				for (const v of expanded) {
					if (dropsEmpties && !v) continue;
					if (values.length >= max) {
						throw new GuardExceeded("ExpansionBudgetExceeded", max, values.length + 1);
					}
					if (valuesLength + v.length > EXPANSION_MAX_LENGTH) {
						throw new GuardExceeded("ExpansionBudgetExceeded", EXPANSION_MAX_LENGTH, valuesLength + v.length);
					}
					values.push(v);
					valuesLength += v.length;
				}
			}
		}

		const next = combine(acc, pre, values, max, dropEmpties && !m.post.length, budget);
		// The step budget ran out combining the set's values in.
		if (budget.remaining < 0) {
			return literal();
		}
		acc = next;
		if (!m.post.length) break;
		current = m.post;
		masked = masked.slice(m.end + 1);
	}
	return acc;
}
