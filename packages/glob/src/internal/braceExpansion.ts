// Ported from brace-expansion@5.0.12 (https://github.com/juliangruber/brace-expansion)
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
// Port notes. expand_ follows 5.0.12's iterative scan: one loop consumes a
// string's top-level groups left to right, so the {a},b} rewrite count
// (EXPANSION_MAX_REWRITES, past which the rest stays literal exactly as upstream
// leaves it) and the choice to drop empty results are held once per scan, and
// a chain never recurses. It takes EXPANSION_MAX_LENGTH (CVE-2026-14257) on the
// characters of the results and of a comma set's alternatives. parseCommaParts
// keeps 5.0.7's recursive shape behind guard 2; 5.0.12's nesting depth of
// 1,000 that degrades to literal is covered by guard 1. Three deliberate
// changes from upstream:
// 1. Depth guard on expand_ at MAX_NESTING_DEPTH — comma-bearing nesting
//    descends one frame per level; the guard throws GuardExceeded
//    ("NestingDepthExceeded") instead of overflowing the stack. The upstream
//    {a},b} for-loop rewrite and the lazy tail evaluation (a group's tail is
//    scanned only after the group, once; both load-bearing DoS fixes) are
//    kept exactly.
// 2. Depth guard on parseCommaParts — self-recursive on the post side;
//    upstream 5.0.12 made it iterative.
// 3. Budget exhaustion THROWS GuardExceeded("ExpansionBudgetExceeded") where
//    upstream silently truncates the expansion list at max or at
//    EXPANSION_MAX_LENGTH — silent truncation silently changes match semantics;
//    the typed signal is the honest surface.
//    The max cap itself is validated by assertCap: a NaN or non-integer max is
//    programmer error and dies as a TypeError defect.

import { balanced } from "./balancedMatch.js";
import {
	EXPANSION_MAX,
	EXPANSION_MAX_LENGTH,
	EXPANSION_MAX_REWRITES,
	GuardExceeded,
	MAX_NESTING_DEPTH,
	assertCap,
} from "./limits.js";

const escSlash = `\0SLASH${Math.random()}\0`;
const escOpen = `\0OPEN${Math.random()}\0`;
const escClose = `\0CLOSE${Math.random()}\0`;
const escComma = `\0COMMA${Math.random()}\0`;
const escPeriod = `\0PERIOD${Math.random()}\0`;
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

/**
 * Basically just str.split(","), but handling cases where we have nested
 * braced sections, which should be treated as individual members, like
 * {a,{b,c},d}.
 */
const parseCommaParts = (str: string, depth: number): Array<string> => {
	if (depth > MAX_NESTING_DEPTH) {
		throw new GuardExceeded("NestingDepthExceeded", MAX_NESTING_DEPTH, depth);
	}
	if (!str) {
		return [""];
	}

	const parts: Array<string> = [];
	const m = balanced("{", "}", str);

	if (!m) {
		return str.split(",");
	}

	const { pre, body, post } = m;
	const p = pre.split(",");

	p[p.length - 1] += `{${body}}`;
	const postParts = parseCommaParts(post, depth + 1);
	if (post.length) {
		p[p.length - 1] += postParts.shift() ?? "";
		p.push(...postParts);
	}

	parts.push(...p);

	return parts;
};

export interface BraceExpansionOptions {
	readonly max?: number;
}

/**
 * Expand a brace pattern into its alternatives, Bash 4.3 style.
 *
 * Guard behavior (see the port notes above): over-deep nesting and budget
 * exhaustion throw {@link GuardExceeded}; an invalid `max` dies as a
 * `TypeError` defect.
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

	return expand_(escapeBraces(input), max, true, 0).map(unescapeBraces);
};

const embrace = (str: string): string => `{${str}}`;

const isPadded = (el: string): boolean => /^-?0\d/.test(el);

const lte = (i: number, y: number): boolean => i <= y;

const gte = (i: number, y: number): boolean => i >= y;

// Every `acc[a] + pre + values[v]`, in order. Upstream's `combine` stops at
// `max` results or EXPANSION_MAX_LENGTH characters and returns what it has;
// here the first result that would be kept past either bound fails typed
// (deviation 3). Empty results are dropped (when `dropEmpties`) before they
// count, as upstream drops them.
const combine = (
	acc: ReadonlyArray<string>,
	pre: string,
	values: ReadonlyArray<string>,
	max: number,
	dropEmpties: boolean,
): Array<string> => {
	const out: Array<string> = [];
	let length = 0;
	for (let a = 0; a < acc.length; a++) {
		for (let v = 0; v < values.length; v++) {
			const expansion = acc[a] + pre + values[v];
			if (dropEmpties && !expansion) continue;
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
	return out;
};

// The values of one numeric (`1..5`) or alphabetic (`a..e..2`) sequence body.
const expandSequence = (body: string, isAlphaSequence: boolean, max: number): Array<string> => {
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

	let length = 0;
	for (let i = x; test(i, y); i += incr) {
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
// running set of combined prefixes (`acc`), as brace-expansion 5.0.12 does. The
// scan is one loop, so the {a},b} rewrite count and the choice to drop empty
// results are held once for the whole chain; recursion happens only into a
// group's own body (its comma parts, or a {{...}} body), each a fresh scan.
// oxlint-disable-next-line func-style
function expand_(str: string, max: number, isTopInput: boolean, depth: number): Array<string> {
	if (depth > MAX_NESTING_DEPTH) {
		throw new GuardExceeded("NestingDepthExceeded", MAX_NESTING_DEPTH, depth);
	}

	let acc: Array<string> = [""];
	let current = str;
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
		const m = balanced("{", "}", current);
		// No brace set left: the rest of the string is literal.
		if (!m) {
			return combine(acc, current, [""], max, dropEmpties);
		}

		// no need to expand pre, since it is guaranteed to be free of brace-sets
		const pre = m.pre;

		if (/\$$/.test(pre)) {
			acc = combine(acc, `${pre}{${m.body}}`, [""], max, dropEmpties && !m.post.length);
			firstGroup = false;
			if (!m.post.length) break;
			current = m.post;
			continue;
		}

		const isNumericSequence = /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(m.body);
		const isAlphaSequence = /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/.test(m.body);
		const isSequence = isNumericSequence || isAlphaSequence;
		const isOptions = m.body.indexOf(",") >= 0;
		if (!isSequence && !isOptions) {
			// {a},b}
			if (rewrites < EXPANSION_MAX_REWRITES && m.post.match(/,(?!,).*\}/)) {
				rewrites++;
				current = `${m.pre}{${m.body}${escClose}${m.post}`;
				isTop = true;
				continue;
			}
			// Nothing here expands, so the whole remaining string is literal.
			return combine(acc, `${pre}{${m.body}}${m.post}`, [""], max, dropEmpties);
		}

		if (firstGroup) {
			dropEmpties = isTop && !isSequence;
			firstGroup = false;
		}

		let values: Array<string>;
		if (isSequence) {
			values = expandSequence(m.body, isAlphaSequence, max);
		} else {
			let n = parseCommaParts(m.body, depth + 1);
			const first = n[0];
			if (n.length === 1 && first !== undefined) {
				// x{{a,b}}y ==> x{a}y x{b}y
				n = expand_(first, max, false, depth + 1).map(embrace);
				if (n.length === 1) {
					acc = combine(acc, pre + n[0], [""], max, dropEmpties && !m.post.length);
					if (!m.post.length) break;
					current = m.post;
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
				for (const v of expand_(part, max, false, depth + 1)) {
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

		acc = combine(acc, pre, values, max, dropEmpties && !m.post.length);
		if (!m.post.length) break;
		current = m.post;
	}
	return acc;
}
