// Ported from minimatch@10.2.5 (https://github.com/isaacs/minimatch)
// Copyright: Isaac Z. Schlueter and Contributors
// License: BlueOak-1.0.0 (https://blueoakcouncil.org/license/1.0.0)
// Port notes: verbatim modulo house strictness (indexed access narrowed with
// locals). Position-bounded iteration over one [...] class — no recursion, no
// guard. One change, from minimatch 11's literal(): a class is a literal
// character only when its body is that one character (`[x]`, `[\x]`), so a
// one-character range such as `[a-a]` stays magic. A scan that reaches a
// neutral state an earlier unclosed scan of the same glob reached stops as
// unclosed, and the posix table's entries are built once (a run of unclosed
// `[` was quadratic). The posix table takes minimatch 11.0.5's `[:punct:]`
// (`\p{P}\p{S}`, symbols included) and `[:print:]` (negated `\p{C}`, so
// every char but controls); 10 left out symbols and matched only controls.

// translate the various posix character classes into unicode properties
// this works across all unicode locales

// { <posix class>: [<translation>, /u flag required, negated]
const posixClasses: { [k: string]: [e: string, u: boolean, n?: boolean] } = {
	"[:alnum:]": ["\\p{L}\\p{Nl}\\p{Nd}", true],
	"[:alpha:]": ["\\p{L}\\p{Nl}", true],
	"[:ascii:]": ["\\x00-\\x7f", false],
	"[:blank:]": ["\\p{Zs}\\t", true],
	"[:cntrl:]": ["\\p{Cc}", true],
	"[:digit:]": ["\\p{Nd}", true],
	"[:graph:]": ["\\p{Z}\\p{C}", true, true],
	"[:lower:]": ["\\p{Ll}", true],
	"[:print:]": ["\\p{C}", true, true],
	"[:punct:]": ["\\p{P}\\p{S}", true],
	"[:space:]": ["\\p{Z}\\t\\r\\n\\v\\f", true],
	"[:upper:]": ["\\p{Lu}", true],
	"[:word:]": ["\\p{L}\\p{Nl}\\p{Nd}\\p{Pc}", true],
	"[:xdigit:]": ["A-Fa-f0-9", false],
};

// The table as entries, built once: parseClass walks it at every inner `[`.
const posixClassEntries = Object.entries(posixClasses);

// A caller scanning one glob passes one `deadEnds` set for it, so a run of
// `[` costs linear time, not n^2 (each `[` scanned to the end): the indices a
// scan that never closed reached in a neutral state (past the first
// character, not escaping, no range pending). From a neutral state at an index
// the rest of the scan is the same whatever `[` it started at, so a later scan
// that reaches one never closes either, and stops there. The set belongs to
// the caller, not to this module: telling one glob from another here would
// compare their contents on every call, itself n^2 for equal globs.

// only need to escape a few things inside of brace expressions
// escapes: [ \ ] -
const braceEscape = (s: string): string => s.replace(/[[\]\\-]/g, "\\$&");
// escape all regexp magic characters
const regexpEscape = (s: string): string => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");

// everything has already been escaped, we just have to join
const rangesToString = (ranges: Array<string>): string => ranges.join("");

export type ParseClassResult = [src: string, uFlag: boolean, consumed: number, hasMagic: boolean];

// takes a glob string at a posix brace expression, and returns
// an equivalent regular expression source, and boolean indicating
// whether the /u flag needs to be applied, and the number of chars
// consumed to parse the character class.
// This also removes out of order ranges, and returns ($.) if the
// entire class just no good.
export const parseClass = (glob: string, position: number, deadEnds: Set<number>): ParseClassResult => {
	const pos = position;
	if (glob.charAt(pos) !== "[") {
		throw new Error("not in a brace expression");
	}
	// the neutral indices this scan reaches, kept if it never closes
	const visited: Array<number> = [];
	const ranges: Array<string> = [];
	const negs: Array<string> = [];

	let i = pos + 1;
	let sawStart = false;
	let uflag = false;
	let escaping = false;
	let negate = false;
	let endPos = pos;
	let rangeStart = "";
	WHILE: while (i < glob.length) {
		if (sawStart && !escaping && !rangeStart) {
			if (deadEnds.has(i)) return ["", false, 0, false];
			visited.push(i);
		}
		const c = glob.charAt(i);
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
			for (const [cls, [unip, u, neg]] of posixClassEntries) {
				if (glob.startsWith(cls, i)) {
					// invalid, [a-[] is fine, but not [a-[:alpha]]
					if (rangeStart) {
						return ["$.", false, glob.length - pos, true];
					}
					i += cls.length;
					if (neg) negs.push(unip);
					else ranges.push(unip);
					uflag = uflag || u;
					continue WHILE;
				}
			}
		}

		// now it's just a normal character, effectively
		escaping = false;
		if (rangeStart) {
			// throw this range away if it's not valid, but others
			// can still match.
			if (c > rangeStart) {
				ranges.push(`${braceEscape(rangeStart)}-${braceEscape(c)}`);
			} else if (c === rangeStart) {
				ranges.push(braceEscape(c));
			}
			rangeStart = "";
			i++;
			continue;
		}

		// now might be the start of a range.
		// can be either c-d or c-] or c<more...>] or c] at this point
		if (glob.startsWith("-]", i + 1)) {
			ranges.push(braceEscape(`${c}-`));
			i += 2;
			continue;
		}
		if (glob.startsWith("-", i + 1)) {
			rangeStart = c;
			i += 2;
			continue;
		}

		// not the start of a range, just a single character
		ranges.push(braceEscape(c));
		i++;
	}

	if (endPos < i) {
		// didn't see the end of the class, not a valid class,
		// but might still be valid as a literal match.
		for (const v of visited) deadEnds.add(v);
		return ["", false, 0, false];
	}

	// if we got no ranges and no negates, then we have a range that
	// cannot possibly match anything, and that poisons the whole glob
	if (!ranges.length && !negs.length) {
		return ["$.", false, glob.length - pos, true];
	}

	// if we got one positive range, and it's a single character, then that's
	// not actually a magic pattern, it's just that one literal character.
	// we should not treat that as "magic", we should just return the literal
	// character. [_] is a perfectly valid way to escape glob magic chars.
	// A class whose body is one code point, or a `\` and one, is that
	// literal character, as minimatch 11's literal() reads it (by code point,
	// so `[😀]` is a literal too; 10 counted UTF-16 units).
	const body = glob.slice(pos + 1, endPos - 1);
	const bare = body.length > 1 && body.charAt(0) === "\\" ? body.slice(1) : body;
	if (!negate && negs.length === 0 && [...bare].length === 1) {
		return [regexpEscape(bare), false, endPos - pos, false];
	}

	const sranges = `[${negate ? "^" : ""}${rangesToString(ranges)}]`;
	const snegs = `[${negate ? "" : "^"}${rangesToString(negs)}]`;
	const comb = ranges.length && negs.length ? `(${sranges}|${snegs})` : ranges.length ? sranges : snegs;

	return [comb, uflag, endPos - pos, true];
};
