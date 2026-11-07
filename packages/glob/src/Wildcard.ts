// The Wildcard facade: a matcher for `*` and `?` alone, with no path,
// separator, brace, class or dotfile semantics. It is not a glob dialect and
// shares nothing with the vendored minimatch engine; it is here because it is
// the other pure string-to-predicate compiler a pattern consumer reaches for.
//
// Matching is a Thompson-style simulation over the pattern's tokens, never a
// regular expression built from the pattern: a backtracking regex such as
// /^\S*a\S*a\S*a…$/ is polynomial in the number of stars with a large
// exponent, while the simulation costs at most pattern tokens × candidate code
// points, and consecutive stars collapse to one token.

import { Schema } from "effect";

/**
 * Options for {@link Wildcard.compile}. Invalid options are a wiring error and
 * throw at `make`, as for `GlobPatternOptions`.
 *
 * @public
 */
export class WildcardOptions extends Schema.Class<WildcardOptions>("WildcardOptions")({
	/**
	 * Match case-insensitively. Literal characters compare under Unicode simple
	 * case folding, as a regular expression with the `i` and `u` flags compares
	 * them: `K` matches the Kelvin sign and `s` the long s, but `İ` does not
	 * match `i`, whose folding is not simple.
	 */
	nocase: Schema.optionalKey(Schema.Boolean),
}) {}

const STAR = 0;
const ANY = 1;
const LITERAL = 2;

type Token =
	| { readonly kind: typeof STAR }
	| { readonly kind: typeof ANY }
	| { readonly kind: typeof LITERAL; readonly char: string; readonly fold: RegExp | undefined };

const STAR_TOKEN: Token = { kind: STAR };
const ANY_TOKEN: Token = { kind: ANY };

// `\s` under the `u` flag: Unicode White_Space, the line terminators and U+FEFF.
const WHITESPACE = /^\s$/u;

const isWhitespace = (char: string): boolean => {
	const code = char.charCodeAt(0);
	// Printable ASCII other than the space: the common case, without a regex call.
	if (char.length === 1 && code > 0x20 && code < 0x7f) return false;
	return WHITESPACE.test(char);
};

// A one-character tester under simple case folding. The `\u{…}` escape is valid
// for every code point, lone surrogates included, so this never throws.
const foldTester = (char: string): RegExp => new RegExp(`^\\u{${(char.codePointAt(0) ?? 0).toString(16)}}$`, "iu");

const tokenize = (pattern: string, nocase: boolean): ReadonlyArray<Token> => {
	const tokens: Array<Token> = [];
	const testers = new Map<string, RegExp>();
	for (const char of pattern) {
		if (char === "*") {
			if (tokens[tokens.length - 1] !== STAR_TOKEN) tokens.push(STAR_TOKEN);
		} else if (char === "?") {
			tokens.push(ANY_TOKEN);
		} else {
			let fold: RegExp | undefined;
			if (nocase) {
				fold = testers.get(char);
				if (fold === undefined) {
					fold = foldTester(char);
					testers.set(char, fold);
				}
			}
			tokens.push({ kind: LITERAL, char, fold });
		}
	}
	return tokens;
};

const predicate = (tokens: ReadonlyArray<Token>): ((candidate: string) => boolean) => {
	const end = tokens.length;
	if (end === 0) return (candidate) => candidate === "";
	// Each non-star token consumes exactly one code point, and a code point is
	// at most two UTF-16 units, so a candidate shorter in units than this cannot match.
	const consuming = tokens.filter((token) => token.kind !== STAR).length;
	return (candidate) => {
		if (candidate.length < consuming) return false;
		let marks = new Uint8Array(end + 1);
		let nextMarks = new Uint8Array(end + 1);
		let active: Array<number> = [];
		let nextActive: Array<number> = [];
		// Enter a state, and the state after it when it is a star (a star may match nothing).
		const enter = (state: number, into: Array<number>, mark: Uint8Array): void => {
			if (mark[state] === 0) {
				mark[state] = 1;
				into.push(state);
			}
			if (state < end && tokens[state]?.kind === STAR && mark[state + 1] === 0) {
				mark[state + 1] = 1;
				into.push(state + 1);
			}
		};
		enter(0, active, marks);
		for (const char of candidate) {
			const whitespace = isWhitespace(char);
			for (const state of active) {
				const token = tokens[state];
				if (token === undefined) continue;
				if (token.kind === STAR) {
					if (!whitespace) enter(state, nextActive, nextMarks);
				} else if (token.kind === ANY) {
					if (!whitespace) enter(state + 1, nextActive, nextMarks);
				} else if (char === token.char || (token.fold?.test(char) ?? false)) {
					enter(state + 1, nextActive, nextMarks);
				}
			}
			if (nextActive.length === 0) return false;
			for (const state of active) marks[state] = 0;
			active.length = 0;
			[marks, nextMarks] = [nextMarks, marks];
			[active, nextActive] = [nextActive, active];
		}
		return marks[end] === 1;
	};
};

/**
 * Wildcard matching with `*` and `?` and nothing else: `*` matches any run of
 * zero or more characters other than whitespace, `?` matches exactly one
 * character other than whitespace, and every other character matches only
 * itself. It is not a glob dialect.
 *
 * @remarks
 * There is no separator: `*` crosses `/`, so `agent:*` matches
 * `agent:okfit/claude-code`. `[`, `]`, `{`, `}`, `!`, `\` and a leading `.` are
 * ordinary characters, with no classes, braces, negation, escapes or dotfile
 * rule, so there is no way to match a literal `*` or `?`. For path matching use
 * `GlobPattern`; for the minimatch dialect without separator semantics there
 * is nothing in this package.
 *
 * Characters are code points: `?` matches one emoji, and whitespace is what a
 * regular expression's `\s` matches under the `u` flag (Unicode White_Space,
 * the line terminators and U+FEFF). An empty pattern matches only the empty
 * string.
 *
 * Compilation and matching are pure, synchronous and total: neither throws, for
 * any pattern or candidate. Consecutive stars collapse to one, and matching
 * never backtracks: it costs at most the pattern's length times the
 * candidate's, so a pattern of 100,000 stars compiles to one token and a
 * pattern of many stars and literals stays polynomial.
 *
 * @example
 * ```ts
 * import { Wildcard, WildcardOptions } from "@effected/glob";
 *
 * const isAgent = Wildcard.compile("agent:*");
 * console.log(isAgent("agent:okfit/claude-code"), isAgent("agent: x"));
 * // => true false
 *
 * const loose = Wildcard.compile("HUMAN:?pencer", WildcardOptions.make({ nocase: true }));
 * console.log(loose("human:spencer"));
 * // => true
 * ```
 *
 * @public
 */
export class Wildcard {
	private constructor() {}

	/**
	 * Compile `pattern` to a predicate over candidate strings. Compile once and
	 * reuse the predicate: it holds the tokenized pattern, and with `nocase` the
	 * per-character folding testers.
	 */
	static compile(pattern: string, options?: WildcardOptions): (candidate: string) => boolean {
		return predicate(tokenize(pattern, options?.nocase === true));
	}

	/**
	 * Whether `candidate` matches `pattern`. Compiles the pattern on every call;
	 * use {@link Wildcard.compile} to match many candidates against one pattern.
	 */
	static matches(pattern: string, candidate: string, options?: WildcardOptions): boolean {
		return Wildcard.compile(pattern, options)(candidate);
	}
}
