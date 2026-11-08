// Ported from minimatch@10.2.5 (https://github.com/isaacs/minimatch)
// Copyright: Isaac Z. Schlueter and Contributors
// License: BlueOak-1.0.0 (https://blueoakcouncil.org/license/1.0.0)
//
// Port notes:
// 1. #parseAST gains a STRUCTURAL depth backstop at MAX_NESTING_DEPTH,
//    independent of maxExtglobRecursion. Upstream increments its extDepth
//    counter only for non-coalescible nestings (depthAdd = 0 on adoption),
//    so a long @(@(@(... chain recurses unboundedly at DEFAULT options —
//    verified: real minimatch 10.2.5 dies with RangeError (stack overflow)
//    on "@(".repeat(20000) + "a" + ")".repeat(20000), which is under its own
//    64KB cap. The backstop throws GuardExceeded("NestingDepthExceeded").
//    The maxExtglobRecursion cap and its degrade-to-literal on-limit
//    behavior are otherwise kept exactly.
// 2. toRegExpSource / #partsToRegExp thread a depth counter through their
//    mutual recursion, guarded at MAX_NESTING_DEPTH (defensive: reachable
//    only if construction produced a deeper tree than the parse backstop
//    permits, i.e. programmer error, but the guard keeps it typed).
// 3. #flatten gains a tree-depth guard alongside the kept 10-pass width cap.
// 4. clone/copyIn thread a depth counter (they run during #fillNegs for `!`
//    extglobs), guarded at MAX_NESTING_DEPTH.
// 5. maxExtglobRecursion is validated by assertCap at fromGlob — a NaN or
//    non-integer cap is a wiring bug and dies as a TypeError defect.
// 6. toMMPattern catches a SyntaxError from new RegExp (and only that) and
//    throws GuardExceeded("InvalidRegExp", 0, 0): upstream 10 let it escape.
// 7. Only a portion that is exactly an empty extglob (`?()`, `*()`, `+()`,
//    `@()`) is read with extglobs off, so `*()` is a `*` and a literal `()`,
//    from minimatch 11; 10 made such a portion literal text, and `+(|)` and
//    the like too.
// 8. An extglob opener that is never closed is literal text, and what follows
//    it reads as at the enclosing level, from minimatch 11; 10 kept the rest
//    as one string, so the `*` of an unclosed `*(` stayed a wildcard.
// 9. Every regexp the walk needs compiles with the pattern (PortionPlan), so
//    matching builds none; a portion with an extglob builds no regexp of its
//    own at all, since only the walk answers it. #parseGlob escapes an escaped
//    character only if it is regexp syntax (11's reEscape set).
// 10. #parseAST reads a class whole, as parseClass does, so a [ that never
//    closes is a literal and extglobs after it still parse (minimatch 11); 10
//    tracked an open class to the end of the portion, which turned off
//    extglob parsing after an unclosed [.
// Beside them, matchesPortion walks a portion under minimatch 11's matcher
// rules (from @isaacs/nonrecursive-glob-match's Sim, which 11 matches with)
// where the regexp would answer differently: a `.` or `..` path portion, a
// dotfile without dot:true, and a portion with a `!(...)`, which 11 negates
// exactly (the regexp negates it together with the rest of the portion). At a
// restricted index no `*`, `?` or class takes the character, and a `*` reached
// there ends that way of matching.
// The shared option types come from the extracted types leaf (upstream let
// ast.ts and index.ts import each other circularly; noImportCycles forbids
// it here). The debug/inspect id plumbing is kept for diffability.

import { parseClass } from "./braceExpressions.js";
import { GuardExceeded, MAX_EXTGLOB_RECURSION, MAX_NESTING_DEPTH, assertCap } from "./limits.js";
import { Matcher } from "./matcher.js";
import type { EngineOptions, MMRegExp } from "./types.js";
import { unescape as unescapePattern } from "./unescape.js";

// classes [] are handled by the parseClass method
// for positive extglobs, we sub-parse the contents, and combine,
// with the appropriate regexp close.
// for negative extglobs, we sub-parse the contents, but then
// have to include the rest of the pattern, then the parent, etc.,
// as the thing that cannot be because RegExp negative lookaheads
// are different from globs.
//
// So for example:
// a@(i|w!(x|y)z|j)b => ^a(i|w((!?(x|y)zb).*)z|j)b$
//   1   2 3   4 5 6      1   2    3   46      5 6
//
// Assembling the extglob requires not just the negated patterns themselves,
// but also anything following the negative patterns up to the boundary
// of the current pattern, plus anything following in the parent pattern.
//
// So, first, we parse the string into an AST of extglobs, without turning
// anything into regexps yet.
//
// ['a', {@ [['i'], ['w', {!['x', 'y']}, 'z'], ['j']]}, 'b']
//
// Then, for all the negative extglobs, we append whatever comes after in
// each parent as their tail
//
// ['a', {@ [['i'], ['w', {!['x', 'y'], 'z', 'b'}, 'z'], ['j']]}, 'b']
//
// Lastly, we turn each of these pieces into a regexp, and join
//
//                                 v----- .* because there's more following,
//                                 v    v  otherwise, .+ because it must be
//                                 v    v  *something* there.
// ['^a', {@ ['i', 'w(?:(!?(?:x|y).*zb$).*)z', 'j' ]}, 'b$']
//   copy what follows into here--^^^^^
// ['^a', '(?:i|w(?:(?!(?:x|y).*zb$).*)z|j)', 'b$']
// ['^a(?:i|w(?:(?!(?:x|y).*zb$).*)z|j)b$']

export type ExtglobType = "!" | "?" | "+" | "*" | "@";
const types = new Set<ExtglobType>(["!", "?", "+", "*", "@"]);
const isExtglobType = (c: string | null): c is ExtglobType => types.has(c as ExtglobType);
const isExtglobAST = (c: AST): c is AST & { type: ExtglobType } => isExtglobType(c.type);

// Map of which extglob types can adopt the children of a nested extglob
//
// anything but ! can adopt a matching type:
// +(a|+(b|c)|d) => +(a|b|c|d)
// *(a|*(b|c)|d) => *(a|b|c|d)
// @(a|@(b|c)|d) => @(a|b|c|d)
// ?(a|?(b|c)|d) => ?(a|b|c|d)
//
// * can adopt anything, because 0 or repetition is allowed
// + can adopt @, because 1 or repetition is allowed
// + and @ CANNOT adopt *, because 0 would be allowed
// + and @ CANNOT adopt ?, because 0 would be allowed
// ? can adopt @, because 0 or 1 is allowed
// ? and @ CANNOT adopt * or +, because >1 would be allowed
// ! CANNOT adopt ! (nothing else can either)
// ! can adopt @
// ! CANNOT adopt *, +, or ?
const adoptionMap = new Map<ExtglobType, Array<ExtglobType>>([
	["!", ["@"]],
	["?", ["?", "@"]],
	["@", ["@"]],
	["*", ["*", "+", "?", "@"]],
	["+", ["+", "@"]],
]);

// nested extglobs that can be adopted in, but with the addition of
// a blank '' element.
const adoptionWithSpaceMap = new Map<ExtglobType, Array<ExtglobType>>([
	["!", ["?"]],
	["@", ["?"]],
	["+", ["?", "*"]],
]);

// union of the previous two maps
const adoptionAnyMap = new Map<ExtglobType, Array<ExtglobType>>([
	["!", ["?", "@"]],
	["?", ["?", "@"]],
	["@", ["?", "@"]],
	["*", ["*", "+", "?", "@"]],
	["+", ["+", "@", "?", "*"]],
]);

// Extglobs that can take over their parent if they are the only child
// the key is parent, value maps child to resulting extglob parent type
// '@' is omitted because it's a special case. An `@` extglob with a single
// member can always be usurped by that subpattern.
const usurpMap = new Map<ExtglobType, Map<ExtglobType | null, ExtglobType | null>>([
	["!", new Map([["!", "@"]])],
	[
		"?",
		new Map([
			["*", "*"],
			["+", "*"],
		]),
	],
	[
		"@",
		new Map([
			["!", "!"],
			["?", "?"],
			["@", "@"],
			["*", "*"],
			["+", "+"],
		]),
	],
	[
		"+",
		new Map([
			["?", "*"],
			["*", "*"],
		]),
	],
]);

// Patterns that get prepended to bind to the start of either the
// entire string, or just a single path portion, to prevent dots
// and/or traversal patterns, when needed.
// Exts don't need the ^ or / bit, because the root binds that already.
const startNoTraversal = "(?!(?:^|/)\\.\\.?(?:$|/))";
const startNoDot = "(?!\\.)";

// characters that indicate a start of pattern needs the "no dots" bit,
// because a dot *might* be matched. ( is not in the list, because in
// the case of a child extglob, it will handle the prevention itself.
const addPatternStart = new Set(["[", "."]);
// cases where traversal is A-OK, no dot prevention needed
const justDots = new Set(["..", "."]);
// An escaped character is written escaped only if it is regexp syntax: the
// set of minimatch 11's reEscape. 10 missed `|`, so `\|` became an
// alternation, and escaped `!`, which the u flag rejects.
const reSpecials = new Set("\\^$.*+?()[]{}|/");
const regExpEscape = (s: string): string => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");

// any single thing other than /
const qmark = "[^/]";

// * => any number of characters
const star = `${qmark}*?`;
// use + when we need to ensure that *something* matches, because the * is
// the only thing in the path portion.
const starNoEmpty = `${qmark}+?`;

const guardDepth = (depth: number): void => {
	if (depth > MAX_NESTING_DEPTH) {
		throw new GuardExceeded("NestingDepthExceeded", MAX_NESTING_DEPTH, depth);
	}
};

// The characters a class starting at `at` takes, or 1 when the `[` never
// closes and is a literal.
const classLength = (str: string, at: number, deadEnds: Set<number>): number => {
	const [, , consumed] = parseClass(str, at, deadEnds);
	return consumed || 1;
};

// A portion that is exactly an empty extglob, read with extglobs off.
const isExactEmptyExt = (glob: string): boolean => /^[?*+@]\(\)$/.test(glob);

/**
 * What the matcher needs of one compiled magic portion, built when the
 * pattern compiles: minimatch 11.0.5's own portion matcher (port note 9),
 * every regexp in it already built. It answers every match of the portion.
 */
export interface PortionPlan {
	readonly matcher: Matcher;
}

// The plan of each compiled portion regexp, set by toMMPattern.
const plans = new WeakMap<object, PortionPlan>();
export const portionPlan = (p: object): PortionPlan | undefined => plans.get(p);

// A regexp the runtime rejects fails typed (port note 6); only a SyntaxError.
// `new RegExp` checks the syntax only: V8 builds the bytecode on the first
// exec, and a source too large for it throws there, and it builds a second
// one for a two-byte subject, which can be too large where the one-byte one
// was not. So the regexp runs once on each kind of subject here, inside the
// catch, and a match is never the first exec of either. The two-byte run is
// the live one: a search of 3,780 sources found none that fails only on a
// one-byte subject, so `test("")` has no known killing shape. Both stay,
// since nothing proves V8 never builds a one-byte program larger than the
// two-byte one.
const compileOrFail = (source: string, flags: string): RegExp => {
	try {
		const regexp = new RegExp(source, flags);
		regexp.test("");
		regexp.test("\u0100");
		return regexp;
	} catch (e) {
		if (e instanceof SyntaxError) throw new GuardExceeded("InvalidRegExp", 0, 0);
		throw e;
	}
};

let ID = 0;
export class AST {
	type: ExtglobType | null;
	readonly #root: AST;

	// #hasMagic and #toString are assigned undefined to reset them, so they are
	// declared `| undefined` rather than optional (exactOptionalPropertyTypes).
	#hasMagic: boolean | undefined;
	#uflag = false;
	#parts: Array<string | AST> = [];
	#parent: AST | undefined;
	#parentIndex: number;
	#negs: Array<AST>;
	#filledNegs = false;
	#options: EngineOptions;
	#toString: string | undefined;
	// the portion's glob as written, kept on the root by fromGlob
	#source = "";
	// set to true if it's an extglob with no children
	// (which really means one child of '')
	#emptyExt = false;
	id = ++ID;

	get depth(): number {
		return (this.#parent?.depth ?? -1) + 1;
	}

	[Symbol.for("nodejs.util.inspect.custom")]() {
		return {
			"@@type": "AST",
			id: this.id,
			type: this.type,
			root: this.#root.id,
			parent: this.#parent?.id,
			depth: this.depth,
			partsLength: this.#parts.length,
			parts: this.#parts,
		};
	}

	constructor(type: ExtglobType | null, parent?: AST, options: EngineOptions = {}) {
		this.type = type;
		// extglobs are inherently magical
		if (type) this.#hasMagic = true;
		this.#parent = parent;
		this.#root = this.#parent ? this.#parent.#root : this;
		this.#options = this.#root === this ? options : this.#root.#options;
		this.#negs = this.#root === this ? [] : this.#root.#negs;
		if (type === "!" && !this.#root.#filledNegs) this.#negs.push(this);
		this.#parentIndex = this.#parent ? this.#parent.#parts.length : 0;
	}

	get hasMagic(): boolean | undefined {
		if (this.#hasMagic !== undefined) return this.#hasMagic;
		for (const p of this.#parts) {
			if (typeof p === "string") continue;
			if (p.type || p.hasMagic) {
				this.#hasMagic = true;
				return this.#hasMagic;
			}
		}
		// note: will be undefined until we generate the regexp src and find out
		return this.#hasMagic;
	}

	// reconstructs the pattern
	toString(): string {
		if (this.#toString !== undefined) return this.#toString;
		if (!this.type) {
			this.#toString = this.#parts.map((p) => String(p)).join("");
		} else {
			this.#toString = `${this.type}(${this.#parts.map((p) => String(p)).join("|")})`;
		}
		return this.#toString;
	}

	#fillNegs() {
		if (this !== this.#root) throw new Error("should only call on root");
		if (this.#filledNegs) return this;

		// call toString() once to fill this out
		this.toString();
		this.#filledNegs = true;
		let n: AST | undefined = this.#negs.pop();
		while (n !== undefined) {
			if (n.type !== "!") {
				n = this.#negs.pop();
				continue;
			}
			// walk up the tree, appending everthing that comes AFTER parentIndex
			let p: AST | undefined = n;
			let pp = p.#parent;
			while (pp) {
				for (let i = p.#parentIndex + 1; !pp.type && i < pp.#parts.length; i++) {
					for (const part of n.#parts) {
						if (typeof part === "string") {
							throw new Error("string part in extglob AST??");
						}
						const source = pp.#parts[i];
						if (source !== undefined) part.copyIn(source);
					}
				}
				p = pp;
				pp = p.#parent;
			}
			n = this.#negs.pop();
		}
		return this;
	}

	push(...parts: Array<string | AST>) {
		for (const p of parts) {
			if (p === "") continue;
			if (typeof p !== "string" && !(p instanceof AST && p.#parent === this)) {
				throw new Error(`invalid part: ${p}`);
			}
			this.#parts.push(p);
		}
	}

	toJSON() {
		const ret: Array<unknown> =
			this.type === null
				? this.#parts.slice().map((p) => (typeof p === "string" ? p : p.toJSON()))
				: [this.type, ...this.#parts.map((p) => (p as AST).toJSON())];
		if (this.isStart() && !this.type) ret.unshift([]);
		if (this.isEnd() && (this === this.#root || (this.#root.#filledNegs && this.#parent?.type === "!"))) {
			ret.push({});
		}
		return ret;
	}

	isStart(): boolean {
		if (this.#root === this) return true;
		if (!this.#parent?.isStart()) return false;
		if (this.#parentIndex === 0) return true;
		// if everything AHEAD of this is a negation, then it's still the "start"
		const p = this.#parent;
		for (let i = 0; i < this.#parentIndex; i++) {
			const pp = p.#parts[i];
			if (!(pp instanceof AST && pp.type === "!")) {
				return false;
			}
		}
		return true;
	}

	isEnd(): boolean {
		if (this.#root === this) return true;
		if (this.#parent?.type === "!") return true;
		if (!this.#parent?.isEnd()) return false;
		// the parent is an end (just asked); asking again is 2^depth on a chain
		// of null-typed nodes, which unclosed openers make (port note 8)
		if (!this.type) return true;
		// if not root, it'll always have a parent
		const pl = this.#parent ? this.#parent.#parts.length : 0;
		return this.#parentIndex === pl - 1;
	}

	copyIn(part: AST | string, depth = 0) {
		guardDepth(depth);
		if (typeof part === "string") this.push(part);
		else this.push(part.clone(this, depth + 1));
	}

	clone(parent: AST, depth = 0): AST {
		guardDepth(depth);
		const c = new AST(this.type, parent);
		for (const p of this.#parts) {
			c.copyIn(p, depth + 1);
		}
		return c;
	}

	static #parseAST(
		str: string,
		ast: AST,
		pos: number,
		opt: EngineOptions,
		extDepth: number,
		structDepth: number,
		// one parseClass memo for this string, across the whole parse
		deadEnds: Set<number>,
	): number {
		// Structural backstop (port note 1): actual recursion depth, counted on
		// EVERY descent, unlike extDepth which adoption resets.
		guardDepth(structDepth);
		const maxDepth = opt.maxExtglobRecursion ?? MAX_EXTGLOB_RECURSION;
		let escaping = false;
		if (ast.type === null) {
			// outside of a extglob, append until we find a start
			let i = pos;
			let acc = "";
			while (i < str.length) {
				const c = str.charAt(i++);
				// still accumulate escapes at this point, but we do ignore
				// starts that are escaped
				if (escaping || c === "\\") {
					escaping = !escaping;
					acc += c;
					continue;
				}

				// Port note 10: a class is read whole, as parseClass reads it; a [
				// that never closes is a literal and parsing goes on (minimatch 11).
				if (c === "[") {
					const consumed = classLength(str, i - 1, deadEnds);
					acc += str.slice(i - 1, i - 1 + consumed);
					i += consumed - 1;
					continue;
				}

				// we don't have to check for adoption here, because that's
				// done at the other recursion point.
				const doRecurse = !opt.noext && isExtglobType(c) && str.charAt(i) === "(" && extDepth <= maxDepth;
				if (doRecurse) {
					ast.push(acc);
					acc = "";
					const ext = new AST(c, ast);
					i = AST.#parseAST(str, ext, i, opt, extDepth + 1, structDepth + 1, deadEnds);
					ast.push(ext);
					continue;
				}
				acc += c;
			}
			ast.push(acc);
			return i;
		}

		// some kind of extglob, pos is at the (
		// find the next | or )
		let i = pos + 1;
		let part = new AST(null, ast);
		const parts: Array<AST> = [];
		let acc = "";
		while (i < str.length) {
			const c = str.charAt(i++);
			// still accumulate escapes at this point, but we do ignore
			// starts that are escaped
			if (escaping || c === "\\") {
				escaping = !escaping;
				acc += c;
				continue;
			}

			if (c === "[") {
				const consumed = classLength(str, i - 1, deadEnds);
				acc += str.slice(i - 1, i - 1 + consumed);
				i += consumed - 1;
				continue;
			}

			const doRecurse =
				!opt.noext && isExtglobType(c) && str.charAt(i) === "(" && (extDepth <= maxDepth || ast.#canAdoptType(c));
			if (doRecurse) {
				const depthAdd = ast.#canAdoptType(c) ? 0 : 1;
				part.push(acc);
				acc = "";
				const ext = new AST(c, part);
				part.push(ext);
				i = AST.#parseAST(str, ext, i, opt, extDepth + depthAdd, structDepth + 1, deadEnds);
				continue;
			}
			if (c === "|") {
				part.push(acc);
				acc = "";
				parts.push(part);
				part = new AST(null, ast);
				continue;
			}
			if (c === ")") {
				if (acc === "" && ast.#parts.length === 0) {
					ast.#emptyExt = true;
				}
				part.push(acc);
				acc = "";
				ast.push(...parts, part);
				return i;
			}
			acc += c;
		}

		// unfinished extglob
		// Port note 8, minimatch 11: an opener that is never closed is literal
		// text (`*(` is a `*` and a `(`), and what follows it reads as it would
		// at the enclosing level: the alternatives already parsed (closed
		// extglobs in them stay extglobs) joined by literal `|`. Reusing them,
		// rather than parsing the rest again, keeps nested unclosed openers
		// linear. 10 kept the rest as one string, whose `*` and `?` stayed wild.
		// As 11's literal() does, the portion counts as magic for a `*` or `?`
		// opener, or when a `)` follows the opener anywhere.
		part.push(acc);
		parts.push(part);
		const type = ast.type;
		ast.type = null;
		ast.#hasMagic = type === "*" || type === "?" || str.includes(")", pos + 1) || undefined;
		ast.#parts = [];
		ast.push(type === "*" || type === "?" ? `\\${type}(` : `${type}(`);
		parts.forEach((alt, k) => {
			if (k > 0) ast.push("|");
			for (const c of alt.#parts) {
				if (typeof c === "string") {
					ast.push(c);
				} else {
					c.#parent = ast;
					c.#parentIndex = ast.#parts.length;
					ast.#parts.push(c);
				}
			}
		});
		return i;
	}

	#canAdoptWithSpace(child?: AST | string): child is AST & {
		type: null;
		parts: [AST & { type: ExtglobType }];
	} {
		return this.#canAdopt(child, adoptionWithSpaceMap);
	}

	#canAdopt(
		child?: AST | string,
		map: Map<ExtglobType, Array<ExtglobType>> = adoptionMap,
	): child is AST & {
		type: null;
		parts: [AST & { type: ExtglobType }];
	} {
		if (!child || typeof child !== "object" || child.type !== null || child.#parts.length !== 1 || this.type === null) {
			return false;
		}
		const gc = child.#parts[0];
		if (!gc || typeof gc !== "object" || gc.type === null) {
			return false;
		}
		return (this as AST & { type: ExtglobType }).#canAdoptType(gc.type, map);
	}

	#canAdoptType(c: string, map: Map<ExtglobType, Array<ExtglobType>> = adoptionAnyMap): c is ExtglobType {
		return !!map.get(this.type as ExtglobType)?.includes(c as ExtglobType);
	}

	#adoptWithSpace(
		this: AST & { type: ExtglobType },
		child: AST & {
			type: null;
		},
		index: number,
	) {
		const gc = child.#parts[0] as AST & { type: ExtglobType };
		const blank = new AST(null, gc, this.options);
		blank.#parts.push("");
		gc.push(blank);
		this.#adopt(child, index);
	}

	#adopt(
		child: AST & {
			type: null;
		},
		index: number,
	) {
		const gc = child.#parts[0] as AST & { type: ExtglobType };
		this.#parts.splice(index, 1, ...gc.#parts);
		for (const p of gc.#parts) {
			if (typeof p === "object") p.#parent = this;
		}
		this.#toString = undefined;
	}

	#canUsurpType(c: string): boolean {
		const m = usurpMap.get(this.type as ExtglobType);
		return !!m?.has(c as ExtglobType);
	}

	#canUsurp(child?: AST | string): child is AST & {
		type: null;
		parts: [AST & { type: ExtglobType }];
	} {
		if (
			!child ||
			typeof child !== "object" ||
			child.type !== null ||
			child.#parts.length !== 1 ||
			this.type === null ||
			this.#parts.length !== 1
		) {
			return false;
		}
		const gc = child.#parts[0];
		if (!gc || typeof gc !== "object" || gc.type === null) {
			return false;
		}
		return (this as AST & { type: ExtglobType }).#canUsurpType(gc.type);
	}

	#usurp(this: AST & { type: ExtglobType }, child: AST & { type: null }) {
		const m = usurpMap.get(this.type as ExtglobType);
		const gc = child.#parts[0] as AST & { type: ExtglobType };
		const nt = m?.get(gc.type);
		if (!nt) return;
		this.#parts = gc.#parts;
		for (const p of this.#parts) {
			if (typeof p === "object") {
				p.#parent = this;
			}
		}
		(this as AST).type = nt;
		this.#toString = undefined;
		this.#emptyExt = false;
	}

	// Whether this part holds an extglob anywhere.
	hasExtglob(): boolean {
		return this.type !== null || this.#parts.some((p) => typeof p !== "string" && p.hasExtglob());
	}

	// Port note 9: minimatch 11's matcher for this portion, built now; every
	// regexp in it goes through compileOrFail.
	#matcherPlan(): PortionPlan {
		const options = this.#options;
		const matcher = new Matcher(
			this.#source,
			{
				...(options.nocase !== undefined && { nocase: options.nocase }),
				...(options.dot !== undefined && { dot: options.dot }),
				...(options.noext !== undefined && { noext: options.noext }),
			},
			compileOrFail,
		);
		return { matcher };
	}

	static fromGlob(pattern: string, options: EngineOptions = {}): AST {
		if (options.maxExtglobRecursion !== undefined) {
			assertCap("maxExtglobRecursion", options.maxExtglobRecursion);
		}
		const ast = new AST(null, undefined, options);
		ast.#source = pattern;
		AST.#parseAST(pattern, ast, 0, options, 0, 0, new Set());
		return ast;
	}

	// returns the regular expression if there's magic, or the unescaped
	// string if not.
	toMMPattern(): MMRegExp | string {
		// should only be called on root
		if (this !== this.#root) return this.#root.toMMPattern();
		const glob = this.toString();
		const nocase = !!this.#options.nocase;
		// Port note 9: a portion with an extglob is answered only by minimatch
		// 11's own matcher (matcher.ts), so it builds no regexp. 11 negates
		// exactly the sub-pattern, which the regexp can not; filling a regexp's
		// negations copied the rest of the portion into each one, doubling per
		// negation; and 10's regexp for nested quantified extglobs
		// (`*(*(a|b)*)`) backtracks exponentially. A portion that is exactly an
		// empty extglob keeps its own rule (port note 7): `+()` and `@()` stay
		// text.
		if (this.hasExtglob() && !isExactEmptyExt(this.#source)) {
			const plan = this.#matcherPlan();
			const never = Object.assign(/(?!)/, { _src: "(?!)", _glob: glob });
			plans.set(never, plan);
			return never;
		}
		const [re, body, hasMagic, uflag] = this.toRegExpSource();
		// if we're in nocase mode, and not nocaseMagicOnly, then we do
		// still need a regular expression if we have to case-insensitively
		// match capital/lowercase characters.
		const anyMagic =
			hasMagic ||
			this.#hasMagic ||
			(this.#options.nocase && !this.#options.nocaseMagicOnly && glob.toUpperCase() !== glob.toLowerCase());
		if (!anyMagic) {
			return body;
		}

		const flags = (nocase ? "i" : "") + (uflag ? "u" : "");
		// Port note 6: a source the runtime rejects (under the u flag a POSIX
		// class turns on, the escapes written for `,`, `#`, a space or `-`)
		// fails typed.
		const regexp = Object.assign(compileOrFail(`^${re}$`, flags), {
			_src: re,
			_glob: glob,
		});
		// 11's matcher answers this portion; the regexp only validated it.
		plans.set(regexp, this.#matcherPlan());
		return regexp;
	}

	get options(): EngineOptions {
		return this.#options;
	}

	// returns the string match, the regexp source, whether there's magic
	// in the regexp (so a regular expression is required) and whether or
	// not the uflag is needed for the regular expression (for posix classes)
	toRegExpSource(allowDot?: boolean, depth = 0): [re: string, body: string, hasMagic: boolean, uflag: boolean] {
		// Port note 2: depth guard on the toRegExpSource <-> #partsToRegExp
		// mutual recursion.
		guardDepth(depth);
		const dot = allowDot ?? !!this.#options.dot;
		if (this.#root === this) {
			this.#flatten();
			this.#fillNegs();
		}
		if (!isExtglobAST(this)) {
			// A lone `*` portion does not match the empty string; only when that
			// `*` is the whole portion, not one string among several (an unclosed
			// opener's literal text and what follows it, port note 8).
			const noEmpty = this.isStart() && this.isEnd() && this.#parts.length === 1 && typeof this.#parts[0] === "string";
			const src = this.#parts
				.map((p) => {
					const [re, _, hasMagic, uflag] =
						typeof p === "string" ? AST.#parseGlob(p, this.#hasMagic, noEmpty) : p.toRegExpSource(allowDot, depth + 1);
					this.#hasMagic = this.#hasMagic || hasMagic;
					this.#uflag = this.#uflag || uflag;
					return re;
				})
				.join("");

			let start = "";
			if (this.isStart()) {
				if (typeof this.#parts[0] === "string") {
					// this is the string that will match the start of the pattern,
					// so we need to protect against dots and such.

					// '.' and '..' cannot match unless the pattern is that exactly,
					// even if it starts with . or dot:true is set.
					const dotTravAllowed = this.#parts.length === 1 && justDots.has(this.#parts[0]);
					if (!dotTravAllowed) {
						const aps = addPatternStart;
						// check if we have a possibility of matching . or ..,
						// and prevent that.
						const needNoTrav =
							// dots are allowed, and the pattern starts with [ or .
							(dot && aps.has(src.charAt(0))) ||
							// the pattern starts with \., and then [ or .
							(src.startsWith("\\.") && aps.has(src.charAt(2))) ||
							// the pattern starts with \.\., and then [ or .
							(src.startsWith("\\.\\.") && aps.has(src.charAt(4)));
						// no need to prevent dots if it can't match a dot, or if a
						// sub-pattern will be preventing it anyway.
						const needNoDot = !dot && !allowDot && aps.has(src.charAt(0));

						start = needNoTrav ? startNoTraversal : needNoDot ? startNoDot : "";
					}
				}
			}

			// append the "end of path portion" pattern to negation tails
			let end = "";
			if (this.isEnd() && this.#root.#filledNegs && this.#parent?.type === "!") {
				end = "(?:$|\\/)";
			}
			const final = start + src + end;
			this.#hasMagic = !!this.#hasMagic;
			return [final, unescapePattern(src), this.#hasMagic, this.#uflag];
		}

		// We need to calculate the body *twice* if it's a repeat pattern
		// at the start, once in nodot mode, then again in dot mode, so a
		// pattern like *(?) can match 'x.y'

		const repeated = this.type === "*" || this.type === "+";
		// some kind of extglob
		const start = this.type === "!" ? "(?:(?!(?:" : "(?:";
		let body = (this as AST & { type: ExtglobType }).#partsToRegExp(dot, depth);

		// Port note 7, minimatch 11: a portion that is exactly an empty extglob is
		// read with extglobs off. `+()` and `@()` are literal strings; `?()` and
		// `*()` are a `?` or `*` and then a literal `()`. Any other extglob with
		// an empty body (`+(|)`, `*(*())`) keeps its meaning: it matches only the
		// empty string, which no path portion is.
		if (this.isStart() && this.isEnd() && !body && this.type !== "!" && isExactEmptyExt(this.#root.#source)) {
			const s = this.toString();
			const me = this as AST;
			me.#parts = [s];
			const magic = me.type === "?" || me.type === "*";
			me.type = null;
			me.#hasMagic = magic || undefined;
			if (!magic) return [s, unescapePattern(s), false, false];
			const [re, , , uflag] = AST.#parseGlob(s, true);
			return [re, unescapePattern(s), true, uflag];
		}

		let bodyDotAllowed =
			!repeated || allowDot || dot || !startNoDot
				? ""
				: (this as AST & { type: ExtglobType }).#partsToRegExp(true, depth);
		if (bodyDotAllowed === body) {
			bodyDotAllowed = "";
		}
		if (bodyDotAllowed) {
			body = `(?:${body})(?:${bodyDotAllowed})*?`;
		}

		// an empty !() is exactly equivalent to a starNoEmpty
		let final = "";
		if (this.type === "!" && this.#emptyExt) {
			final = (this.isStart() && !dot ? startNoDot : "") + starNoEmpty;
		} else {
			const close =
				this.type === "!"
					? // !() must match something,but !(x) can match ''
						`))${this.isStart() && !dot && !allowDot ? startNoDot : ""}${star})`
					: this.type === "@"
						? ")"
						: this.type === "?"
							? ")?"
							: this.type === "+" && bodyDotAllowed
								? ")"
								: this.type === "*" && bodyDotAllowed
									? ")?"
									: `)${this.type}`;
			final = start + body + close;
		}
		this.#hasMagic = !!this.#hasMagic;
		return [final, unescapePattern(body), this.#hasMagic, this.#uflag];
	}

	#flatten(depth = 0) {
		// Port note 3: tree-depth guard alongside the kept 10-pass width cap.
		guardDepth(depth);
		if (!isExtglobAST(this)) {
			for (const p of this.#parts) {
				if (typeof p === "object") {
					p.#flatten(depth + 1);
				}
			}
		} else {
			// do up to 10 passes to flatten as much as possible
			let iterations = 0;
			let done = false;
			do {
				done = true;
				for (let i = 0; i < this.#parts.length; i++) {
					const c = this.#parts[i];
					if (typeof c === "object") {
						c.#flatten(depth + 1);
						if (this.#canAdopt(c)) {
							done = false;
							this.#adopt(c, i);
						} else if (this.#canAdoptWithSpace(c)) {
							done = false;
							(this as AST & { type: ExtglobType }).#adoptWithSpace(c, i);
						} else if (this.#canUsurp(c)) {
							done = false;
							(this as AST & { type: ExtglobType }).#usurp(c);
						}
					}
				}
			} while (!done && ++iterations < 10);
		}
		this.#toString = undefined;
	}

	#partsToRegExp(this: AST & { type: ExtglobType }, dot: boolean, depth: number) {
		return this.#parts
			.map((p) => {
				// extglob ASTs should only contain parent ASTs
				if (typeof p === "string") {
					throw new Error("string type in extglob ast??");
				}
				// can ignore hasMagic, because extglobs are already always magic
				const [re, _, _hasMagic, uflag] = p.toRegExpSource(dot, depth + 1);
				this.#uflag = this.#uflag || uflag;
				return re;
			})
			.filter((p) => !(this.isStart() && this.isEnd()) || !!p)
			.join("|");
	}

	static #parseGlob(
		glob: string,
		hasMagicInput: boolean | undefined,
		noEmpty = false,
	): [re: string, body: string, hasMagic: boolean, uflag: boolean] {
		let hasMagic = hasMagicInput;
		let escaping = false;
		let re = "";
		let uflag = false;
		// multiple stars that aren't globstars coalesce into one *
		let inStar = false;
		// one parseClass memo for this glob
		const deadEnds = new Set<number>();
		for (let i = 0; i < glob.length; i++) {
			const c = glob.charAt(i);
			if (escaping) {
				escaping = false;
				re += (reSpecials.has(c) ? "\\" : "") + c;
				continue;
			}
			if (c === "*") {
				if (inStar) continue;
				inStar = true;
				re += noEmpty && /^[*]+$/.test(glob) ? starNoEmpty : star;
				hasMagic = true;
				continue;
			}
			inStar = false;
			if (c === "\\") {
				if (i === glob.length - 1) {
					re += "\\\\";
				} else {
					escaping = true;
				}
				continue;
			}
			if (c === "[") {
				const [src, needUflag, consumed, magic] = parseClass(glob, i, deadEnds);
				if (consumed) {
					re += src;
					uflag = uflag || needUflag;
					i += consumed - 1;
					hasMagic = hasMagic || magic;
					continue;
				}
			}
			if (c === "?") {
				re += qmark;
				hasMagic = true;
				continue;
			}
			re += regExpEscape(c);
		}
		return [re, unescapePattern(glob), !!hasMagic, uflag];
	}
}
