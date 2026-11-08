// Ported from @isaacs/nonrecursive-glob-match@1.1.0 (https://github.com/isaacs/nonrecursive-glob-match)
// Copyright: Isaac Z. Schlueter and Contributors
// License: BlueOak-1.0.0 (https://blueoakcouncil.org/license/1.0.0)
// Port notes: src/parse-class.ts, the class parser of the matcher minimatch
// 11.0.5 runs. Changes from upstream:
// 1. No `form` (Unicode normalization) parameter: the kit has no `normalize`
//    option.
// 2. A memo the caller passes, one per glob, makes a run of unclosed `[`
//    linear, as in braceExpressions.ts:
//    the indices a scan that never closed reached in a neutral state (past
//    the first character, not escaping, no range pending). From such an
//    index the rest of the scan is the same whatever `[` it started at, so a
//    later scan that reaches one never closes either. Upstream scanned to the
//    end from every `[`.
// 3. The posix table's entries are built once.
// 4. The class regexp is built by the caller's compileOrFail (typed failure,
//    forced first exec) instead of `new RegExp` here.

// translate the various posix character classes into unicode properties
// this works across all unicode locales

// { <posix class>: [<translation>, negated]
const posixClasses: { [k: string]: [e: string, n?: boolean] } = {
	"[:alnum:]": ["\\p{L}\\p{Nl}\\p{Nd}"],
	"[:alpha:]": ["\\p{L}\\p{Nl}"],
	"[:ascii:]": ["\\x00-\\x7f"],
	"[:blank:]": ["\\p{Zs}\\t"],
	"[:cntrl:]": ["\\p{Cc}"],
	"[:digit:]": ["\\p{Nd}"],
	"[:graph:]": ["\\p{Z}\\p{C}", true],
	"[:lower:]": ["\\p{Ll}"],
	"[:print:]": ["\\p{C}", true],
	"[:punct:]": ["\\p{P}\\p{S}"],
	"[:space:]": ["\\p{Z}\\t\\r\\n\\v\\f"],
	"[:upper:]": ["\\p{Lu}"],
	"[:word:]": ["\\p{L}\\p{Nl}\\p{Nd}\\p{Pc}"],
	"[:xdigit:]": ["A-Fa-f0-9"],
};
const posixClassEntries = Object.entries(posixClasses);

// only need to escape a few things inside of brace expressions
// escapes: [ \ ] -
const braceEscape = (s: string): string => s.replace(/[[\]\\-]/g, "\\$&");

/** A class's regexp source (null when the `[` never closes), and the glob characters it takes. */
export type MatcherClassResult = readonly [source: string | null, consumed: number];

// matches nothing
const noMatch = "$.";

// Takes a glob string at a posix brace expression. Returns the regexp source
// that tests one character, and the number of glob chars consumed. If the
// class is not closed, consumed is 0, and the `[` must be treated as a
// literal character. Out of order ranges are removed. If nothing is left,
// the source is `$.`, and the rest of the glob is consumed, so that the
// whole glob cannot match.
export const parseMatcherClass = (glob: string, position: number, deadEnds: Set<number>): MatcherClassResult => {
	const pos = position;
	if (glob.charAt(pos) !== "[") {
		throw new Error("not in a brace expression");
	}
	const visited: Array<number> = [];
	const ranges: Array<string> = [];
	const negs: Array<string> = [];

	let i = pos + 1;
	let sawStart = false;
	let escaping = false;
	let negate = false;
	let endPos = pos;
	let rangeStart = "";
	WHILE: while (i < glob.length) {
		if (sawStart && !escaping && !rangeStart) {
			if (deadEnds.has(i)) return [null, 0];
			visited.push(i);
		}
		const c = String.fromCodePoint(glob.codePointAt(i) as number);
		if ((c === "!" || c === "^") && i === pos + 1) {
			negate = true;
			i++;
			continue;
		}

		if (c === "]" && sawStart && !escaping) {
			endPos = i + 1;
			break;
		}

		sawStart = true;
		if (c === "\\") {
			if (!escaping) {
				escaping = true;
				i++;
				continue;
			}
			// escaped \ char, fall through and treat like normal char
		}
		if (c === "[" && !escaping) {
			// either a posix class, a collation equivalent, or just a [
			for (const [cls, [unip, neg]] of posixClassEntries) {
				if (glob.startsWith(cls, i)) {
					// invalid, [a-[] is fine, but not [a-[:alpha]]
					if (rangeStart) {
						return [noMatch, glob.length - pos];
					}
					i += cls.length;
					if (neg) negs.push(unip);
					else ranges.push(unip);
					continue WHILE;
				}
			}
		}

		// now it's just a normal character, effectively
		escaping = false;
		const n = c;
		if (rangeStart) {
			// throw this range away if it's not valid, but others
			// can still match.
			if ((n.codePointAt(0) as number) > (rangeStart.codePointAt(0) as number)) {
				ranges.push(`${braceEscape(rangeStart)}-${braceEscape(n)}`);
			} else if (n === rangeStart) {
				ranges.push(braceEscape(n));
			}
			rangeStart = "";
			i += c.length;
			continue;
		}

		// now might be the start of a range.
		// can be either c-d or c-] or c<more...>] or c] at this point
		if (glob.startsWith("-]", i + c.length)) {
			ranges.push(braceEscape(`${n}-`));
			i += c.length + 1;
			continue;
		}
		if (glob.startsWith("-", i + c.length)) {
			rangeStart = n;
			i += c.length + 1;
			continue;
		}

		// not the start of a range, just a single character
		ranges.push(braceEscape(n));
		i += c.length;
	}

	if (endPos < i) {
		// didn't see the end of the class, not a valid class,
		// but might still be valid as a literal match.
		for (const v of visited) deadEnds.add(v);
		return [null, 0];
	}

	// if we got no ranges and no negates, then we have a range that
	// cannot possibly match anything, and that poisons the whole glob
	if (!ranges.length && !negs.length) {
		return [noMatch, glob.length - pos];
	}

	const sranges = `[${negate ? "^" : ""}${ranges.join("")}]`;
	const snegs = `[${negate ? "" : "^"}${negs.join("")}]`;
	const comb = `^${ranges.length && negs.length ? `(${sranges}|${snegs})` : ranges.length ? sranges : snegs}`;

	return [comb, endPos - pos];
};
