// The GlobPattern facade: single-pattern compilation, total matching, the
// enumerator metadata getters, the schema-validated options surface, the
// FromString codec and the escape statics — plus GlobPatternError, the
// package's typed failure vocabulary (errors-near-domain rule).
//
// Cycle firewall: this module imports the engine; the engine never imports
// it. The engine throws raw GuardExceeded records at compile time; ONLY this
// facade materializes them into the typed GlobPatternError.

import { Effect, Result, Schema, SchemaTransformation } from "effect";
import { compileBudget } from "./internal/ast.js";
import { EXPANSION_MAX, MAX_GLOBSTAR_RECURSION_CEILING, isGuardExceeded } from "./internal/limits.js";
import type { EngineOptions } from "./internal/minimatch.js";
import {
	GLOBSTAR,
	Minimatch,
	alternativeCount as engineAlternativeCount,
	escape as engineEscape,
	unescape as engineUnescape,
} from "./internal/minimatch.js";

/**
 * Typed failure raised when a glob pattern trips a compile-time guard:
 * over-length, brace-expansion budget exhaustion, nesting past the depth
 * cap, or a pattern portion whose regular expression the runtime rejects
 * (`InvalidRegExp`: one too large for the runtime's regexp engine, such as
 * about 32,000 literal characters and a wildcard in one portion; `limit` and
 * `actual` are both 0, since no cap was passed), or the work of one compile
 * past its budget (`CompileBudgetExceeded`, limit 8,000,000 units, its
 * regexps and matcher graphs together: a brace expansion that gives each of
 * thousands of alternatives its own POSIX class regexp, such as
 * `[[:alpha:]]{0..99}{0..99}`, which minimatch 11 compiles, or its own copy
 * of a numeric range kept whole; a `GlobSet` is one compile; or limit 256,
 * one portion holding more than 256 Unicode properties, such as
 * `[[:print:]]` 257 times). Options that change a regexp (`nocase`, `dot`)
 * share one budget with the default-options check, so such a compile fits
 * about half of what a default-options compile does. Malformed input is never a defect — this is the only failure the
 * package's fallible boundaries ({@link GlobPattern.compile} and
 * `GlobSet.compile`) can produce.
 *
 * @public
 */
export class GlobPatternError extends Schema.TaggedError<GlobPatternError>()("GlobPatternError", {
	/** The pattern source that was rejected. */
	pattern: Schema.String,
	/**
	 * Which guard tripped: pattern length, brace-expansion budget, nesting
	 * depth, an unbuildable regexp, or the regexp work of one compile.
	 */
	reason: Schema.Literals([
		"PatternTooLong",
		"ExpansionBudgetExceeded",
		"NestingDepthExceeded",
		"InvalidRegExp",
		"CompileBudgetExceeded",
	]),
	/** The cap the pattern exceeded (0 for `InvalidRegExp`). */
	limit: Schema.Number,
	/** The measured value that exceeded `limit` (0 for `InvalidRegExp`). */
	actual: Schema.Number,
}) {
	override get message(): string {
		const shown = this.pattern.length > 64 ? `${this.pattern.slice(0, 64)}…` : this.pattern;
		return `glob pattern ${JSON.stringify(shown)} rejected: ${this.reason} (limit ${this.limit}, actual ${this.actual})`;
	}
}

/**
 * Matching options for a glob pattern: the full minimatch options surface,
 * schema-validated. Invalid options are a
 * developer wiring error and throw at `make` — a defect at construction; the
 * typed channel stays reserved for malformed patterns.
 *
 * `platform` is explicit and defaults to `"posix"`: the engine never reads
 * ambient process state. `braceExpandMax` is bounded above by the stock
 * budget (100,000) — caps tighten, never raise — which is what keeps a
 * GlobPattern value always defaults-compilable (see {@link GlobPattern}).
 * `maxGlobstarRecursion` is bounded above at 1,000, a measured stack depth
 * with a margin, so no accepted value makes matching overflow on a default
 * stack.
 *
 * @public
 */
export class GlobPatternOptions extends Schema.Class<GlobPatternOptions>("GlobPatternOptions")({
	/** Do not expand `{x,y}` style braces. */
	nobrace: Schema.optionalKey(Schema.Boolean),
	/** Do not treat a pattern starting with `#` as a comment. */
	nocomment: Schema.optionalKey(Schema.Boolean),
	/** Do not treat a pattern starting with `!` as a negation. */
	nonegate: Schema.optionalKey(Schema.Boolean),
	/**
	 * Read a leading `!(` as the `!(…)` extglob instead of whole-pattern
	 * negation, as picomatch (and so Vitest) does. A plain `!a` still negates, and
	 * `!!(a)` negates once and then reads the extglob. Off by default, which keeps
	 * minimatch's reading. Inert under `noext`. This is parity at that one point,
	 * not with picomatch generally; set `dot` separately to agree with it.
	 * `nonegate: true` also gives picomatch's answer for `!(`, but turns off every
	 * `!` negation.
	 */
	extglobBang: Schema.optionalKey(Schema.Boolean),
	/** Treat `**` the same as `*`. */
	noglobstar: Schema.optionalKey(Schema.Boolean),
	/** Do not expand extglobs like `+(a|b)`. */
	noext: Schema.optionalKey(Schema.Boolean),
	/** Allow matches that start with `.` even if the pattern does not. */
	dot: Schema.optionalKey(Schema.Boolean),
	/** Match case-insensitively. */
	nocase: Schema.optionalKey(Schema.Boolean),
	/** Ignore case only in wildcard portions of the pattern. */
	nocaseMagicOnly: Schema.optionalKey(Schema.Boolean),
	/** Consider braces to be "magic" for the purpose of `hasMagic`. */
	magicalBraces: Schema.optionalKey(Schema.Boolean),
	/** Match a pattern without slashes against the basename of a path that contains slashes. */
	matchBase: Schema.optionalKey(Schema.Boolean),
	/** Invert the results of negated matches. */
	flipNegate: Schema.optionalKey(Schema.Boolean),
	/** Compare a partial path to the pattern: a path is a match as long as the parts present are not contradicted by the pattern. */
	partial: Schema.optionalKey(Schema.Boolean),
	/** Do not collapse multiple `/` into a single `/`. */
	preserveMultipleSlashes: Schema.optionalKey(Schema.Boolean),
	/** Treat `\\` as a path separator, not an escape character. */
	windowsPathsNoEscape: Schema.optionalKey(Schema.Boolean),
	/** For a pattern starting with a UNC path or drive letter in `nocase` mode, keep the root portions as strings instead of case-insensitive regular expressions. */
	windowsNoMagicRoot: Schema.optionalKey(Schema.Boolean),
	/** The level of pre-parse pattern optimization: `0`, `1` or `2`. */
	optimizationLevel: Schema.optionalKey(
		Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 2 })),
	),
	/** The operating system the pattern is interpreted for. Defaults to `"posix"`; only `"win32"` changes behavior, and it is never read from the ambient process. */
	platform: Schema.optionalKey(
		Schema.Literals([
			"posix",
			"aix",
			"android",
			"darwin",
			"freebsd",
			"haiku",
			"linux",
			"openbsd",
			"sunos",
			"win32",
			"cygwin",
			"netbsd",
		]),
	),
	/** Maximum number of `{...}` expansions, from `1` to `100000` (the default and ceiling). */
	braceExpandMax: Schema.optionalKey(
		Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: EXPANSION_MAX })),
	),
	/**
	 * Maximum number of non-adjacent `**` segments the matcher recursively walks
	 * down, from `1` to `1000`; the default is `200`. A walk past the cap is a
	 * documented false negative, never an error.
	 *
	 * @remarks
	 * The walk recurses once per `**` section, so this cap is a stack depth. On
	 * Node 26's default stack the walk first overflowed at about 3,250 sections
	 * with nothing else on the stack, at about 2,100 with 5,000 frames of the
	 * caller's own recursion beneath it, and at about 1,600 under
	 * `--stack-size=500`, half the default. A walk at the ceiling of 1,000 uses
	 * under a third of the default stack and about 62% of the halved one, so it
	 * leaves a margin in each of those cases. A caller running on a smaller
	 * stack still gets an answer, not a throw: {@link GlobPattern.matches} answers
	 * a stack overflow the way the cap does.
	 */
	maxGlobstarRecursion: Schema.optionalKey(
		Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: MAX_GLOBSTAR_RECURSION_CEILING })),
	),
	/**
	 * Accepted for compatibility, and validated as a positive integer, but it
	 * limits nothing: every extglob is matched by minimatch 11's own matcher,
	 * which has no such cap. Nesting deeper than 256 levels fails at compile
	 * with `NestingDepthExceeded` whatever this is set to.
	 */
	maxExtglobRecursion: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
}) {}

// Conditional-spread bridge: a present-but-undefined optionalKey never happens
// through the schema, but the engine bag must not carry explicit undefined
// either (exactOptionalPropertyTypes).
const toEngineOptions = (o?: GlobPatternOptions): EngineOptions => ({
	...(o?.nobrace !== undefined && { nobrace: o.nobrace }),
	...(o?.nocomment !== undefined && { nocomment: o.nocomment }),
	...(o?.nonegate !== undefined && { nonegate: o.nonegate }),
	...(o?.extglobBang !== undefined && { extglobBang: o.extglobBang }),
	...(o?.noglobstar !== undefined && { noglobstar: o.noglobstar }),
	...(o?.noext !== undefined && { noext: o.noext }),
	...(o?.dot !== undefined && { dot: o.dot }),
	...(o?.nocase !== undefined && { nocase: o.nocase }),
	...(o?.nocaseMagicOnly !== undefined && { nocaseMagicOnly: o.nocaseMagicOnly }),
	...(o?.magicalBraces !== undefined && { magicalBraces: o.magicalBraces }),
	...(o?.matchBase !== undefined && { matchBase: o.matchBase }),
	...(o?.flipNegate !== undefined && { flipNegate: o.flipNegate }),
	...(o?.partial !== undefined && { partial: o.partial }),
	...(o?.preserveMultipleSlashes !== undefined && { preserveMultipleSlashes: o.preserveMultipleSlashes }),
	...(o?.windowsPathsNoEscape !== undefined && { windowsPathsNoEscape: o.windowsPathsNoEscape }),
	...(o?.windowsNoMagicRoot !== undefined && { windowsNoMagicRoot: o.windowsNoMagicRoot }),
	...(o?.optimizationLevel !== undefined && { optimizationLevel: o.optimizationLevel }),
	...(o?.platform !== undefined && { platform: o.platform }),
	...(o?.braceExpandMax !== undefined && { braceExpandMax: o.braceExpandMax }),
	...(o?.maxGlobstarRecursion !== undefined && { maxGlobstarRecursion: o.maxGlobstarRecursion }),
	...(o?.maxExtglobRecursion !== undefined && { maxExtglobRecursion: o.maxExtglobRecursion }),
});

// The schema check: compilability under DEFAULT options. Returning the guard
// message string makes it the thrown validation message (a bare false would
// render as "Expected <filter>"). A non-guard throw is programmer error and
// stays a defect.
const compilesUnderDefaults = (source: string): true | string => {
	try {
		new Minimatch(source, {});
		return true;
	} catch (e) {
		if (isGuardExceeded(e)) return e.message;
		throw e;
	}
};

/**
 * One place a walker must read to enumerate a pattern: a directory prefix and
 * whether matches can lie more than one level below it. See
 * {@link GlobPattern.enumerationRoots}.
 *
 * @public
 */
export interface EnumerationRoot {
	/**
	 * The literal directory prefix in canonical form, slash-terminated: no `.` or
	 * empty segment, and a `..` resolved against the segment before it (a leading
	 * `..` stays). `""` for the walk's own base, so `./src/*.ts` and `src/*.ts`
	 * share the root `src/`.
	 */
	readonly prefix: string;
	/** Whether matches can lie deeper than one level below `prefix` — a globstar, or a magic segment followed by more. */
	readonly deep: boolean;
	/**
	 * Every literal prefix this root's walk covers, as the pattern's alternatives
	 * spell it: its own and those of the roots it absorbs. Matching is
	 * spelling-sensitive, since `./src/*.ts` does not match `src/a.ts`, so a walker
	 * tests a canonical path below `prefix` once per spelling whose canonical
	 * form the path lies in. The spelling replaces that canonical part of the
	 * path. Distinct, never empty, and in pattern order: ordered by the first
	 * brace alternative that spells each one.
	 */
	readonly spellings: ReadonlyArray<string>;
}

/**
 * A literal prefix's canonical form: `.` and empty segments dropped, and a `..`
 * popping the segment before it unless that is a `..` too. A climb above the
 * base keeps its leading `..` segments, so a walker can still refuse it.
 */
const canonicalPrefix = (literals: ReadonlyArray<string>): string => {
	const kept: Array<string> = [];
	for (const segment of literals) {
		if (segment === "" || segment === ".") continue;
		if (segment === ".." && kept.length > 0 && kept[kept.length - 1] !== "..") kept.pop();
		else kept.push(segment);
	}
	return kept.length === 0 ? "" : `${kept.join("/")}/`;
};

// Split on unescaped `/`. A backslash escapes the next character (the engine has
// already turned every `\\` into `/` under windowsPathsNoEscape). Empty segments
// collapse, as the engine collapses `//`, except a leading one, which marks the
// root. A trailing slash adds nothing.
const splitSegments = (pattern: string, preserveMultipleSlashes: boolean): Array<string> => {
	const parts: Array<string> = [];
	let current = "";
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern.charAt(i);
		if (c === "\\" && i + 1 < pattern.length) {
			current += c + pattern.charAt(i + 1);
			i++;
		} else if (c === "/") {
			parts.push(current);
			current = "";
		} else current += c;
	}
	parts.push(current);
	return parts.filter(
		(part, index) => part !== "" || index === 0 || (preserveMultipleSlashes && index < parts.length - 1),
	);
};

const hasUnescapedBrace = (segment: string): boolean => {
	for (let i = 0; i < segment.length; i++) {
		const c = segment.charAt(i);
		if (c === "\\") i++;
		else if (c === "{") return true;
	}
	return false;
};

// A segment's literal value (escapes undone), or undefined when it carries magic. The
// engine itself decides: one all-string part means no magic.
const literalSegment = (segment: string, options: EngineOptions): string | undefined => {
	if (segment === "") return "";
	let set: Minimatch["set"];
	try {
		set = new Minimatch(segment, { ...options, nobrace: true, nonegate: true, nocomment: true, nocase: false }).set;
	} catch (e) {
		// A segment compiled on its own can trip a guard the whole pattern did
		// not (a `..` drops it there): a guard trips only on magic, so it is not
		// a literal. A getter never throws.
		if (isGuardExceeded(e)) return undefined;
		throw e;
	}
	const only = set.length === 1 && set[0]?.length === 1 ? set[0][0] : undefined;
	return typeof only === "string" ? only : undefined;
};

// Under `matchBase` a compiled row of ONE portion matches a path by its basename, at any depth: a walker reads
// from the base, all the way down, to enumerate it. Only the compiled row decides it, never the source: glob pops
// `<p>/..` and merges adjacent globstars, so `x/../*.js` and `**/**` are one-portion rows too.
const isBasenameRow = (engine: Minimatch, row: ReadonlyArray<unknown>): boolean =>
	engine.options.matchBase === true && row.length === 1;

// Set by GlobPattern's static block, which can reach its private engine field.
let adoptEngine: (source: string, engine: Minimatch) => GlobPattern;

/**
 * A pattern whose default-options engine the caller already compiled (and so
 * checked): `GlobSet` compiles every member under one budget, and hands each
 * engine over instead of having it built again on the first match.
 *
 * @internal
 */
export const patternWithEngine = (source: string, engine: Minimatch): GlobPattern => adoptEngine(source, engine);

/**
 * A compiled glob pattern with a total `matches(candidate)` predicate, plus the
 * metadata a directory walker needs.
 *
 * @remarks
 * The schema IS the domain class. One encoded field, `source`; the compiled
 * matcher lives in a private field the schema never encodes, built lazily for
 * `make`/decode-constructed instances and pre-warmed by
 * {@link GlobPattern.compile}.
 *
 * A GlobPattern value is ALWAYS a pattern that compiles under default options
 * — the schema check enforces it on every construction path. Options refine
 * matching; they do not admit patterns that defaults reject.
 *
 * Matching options default to minimatch's, so `dot` is `false`: `*` and `**`
 * never match a dotfile or a dot-directory. Vitest matches its include and
 * exclude globs with `dot: true`; a pattern meant to agree with it must say
 * so — `GlobPatternOptions.make({ dot: true })`.
 *
 * @public
 */
export class GlobPattern extends Schema.Class<GlobPattern>("GlobPattern")(
	Schema.Struct({ source: Schema.String }).check(
		Schema.makeFilter((v) => compilesUnderDefaults(v.source), { title: "compilable glob pattern" }),
	),
) {
	#engine: Minimatch | undefined;
	#engineOptions: EngineOptions = {};

	static {
		adoptEngine = (source, engine) => {
			const pattern = new GlobPattern({ source }, { disableChecks: true });
			pattern.#engine = engine;
			return pattern;
		};
	}

	// Lazy for make/decode-built instances. The schema check guarantees this
	// cannot throw for them (defaults are the stored options); a throw here is
	// an invariant violation and correctly dies as a defect.
	#engineOf(): Minimatch {
		if (this.#engine === undefined) {
			this.#engine = new Minimatch(this.source, this.#engineOptions);
		}
		return this.#engine;
	}

	/**
	 * Compile a pattern under the given options, synchronously — the package's
	 * fallible boundary in its primitive form. Compilation is pure
	 * string→predicate work with no IO, no services and no async step, so the
	 * sync form is the real primitive and {@link GlobPattern.compile} is
	 * derived from it.
	 *
	 * Total: never throws for pattern input. Guard trips (over-length,
	 * expansion budget, nesting depth) come back as a `Result` failure holding
	 * {@link GlobPatternError}; invalid *options* never reach here (they throw
	 * at `GlobPatternOptions.make`, a wiring defect).
	 *
	 * The pattern must also compile under DEFAULT options, whatever the
	 * effective options are — permissive options (say `nobrace` over a brace
	 * bomb) do not admit a defaults-rejected pattern; the same typed error
	 * surfaces instead. Both compiles share one compile budget, so options that
	 * change a regexp (`nocase`, `dot`) fit about half of what a default-options
	 * compile does before failing typed with `CompileBudgetExceeded`.
	 *
	 * @remarks
	 * For synchronous call sites that cannot host an Effect — a lint-staged
	 * handler, a config predicate — this removes the
	 * `Effect.runSync(Effect.result(...))` escape hatch: pair it with
	 * `Result.isSuccess` and read `.success` directly. Effect call sites should
	 * prefer {@link GlobPattern.compile}, which carries the tracing span.
	 *
	 * @example
	 * ```ts
	 * import { GlobPattern } from "@effected/glob";
	 * import { Result } from "effect";
	 *
	 * const compiled = GlobPattern.compileResult("src/*.ts");
	 * if (Result.isSuccess(compiled)) {
	 * 	compiled.success.matches("src/index.ts"); // => true
	 * }
	 * ```
	 */
	static compileResult(source: string, options?: GlobPatternOptions): Result.Result<GlobPattern, GlobPatternError> {
		const engineOptions = toEngineOptions(options);
		return Result.try({
			try: () => {
				// Defaults first (the value invariant), then the effective engine;
				// with no options set the defaults engine is the effective one. Both
				// are one compile, on one budget: built on a budget each, a `nocase`
				// pattern did twice the work one budget allows (a validation source
				// both share is checked once). The defaults engine just ran the
				// schema check's own compile, so the class is built unchecked.
				const budget = compileBudget();
				const defaults = new Minimatch(source, {}, budget);
				const engine =
					Object.keys(engineOptions).length === 0 ? defaults : new Minimatch(source, engineOptions, budget);
				const pattern = new GlobPattern({ source }, { disableChecks: true });
				pattern.#engine = engine;
				pattern.#engineOptions = engineOptions;
				return pattern;
			},
			catch: (e) => {
				// Only a guard trip is a typed failure; anything else rethrows as a defect.
				if (isGuardExceeded(e)) {
					return new GlobPatternError({ pattern: source, reason: e.reason, limit: e.limit, actual: e.actual });
				}
				throw e;
			},
		});
	}

	/**
	 * Compile a pattern under the given options — the package's fallible
	 * boundary, and the form Effect call sites should reach for. Guard trips
	 * (over-length, expansion budget, nesting depth, an unbuildable regexp) fail typed with
	 * {@link GlobPatternError}; invalid options never reach here (they throw at
	 * `GlobPatternOptions.make`, a wiring defect).
	 *
	 * Defined in terms of {@link GlobPattern.compileResult} — synchronous
	 * callers can use that variant directly. Same semantics, same errors; this
	 * form adds only the `GlobPattern.compile` tracing span.
	 */
	static readonly compile = Effect.fn("GlobPattern.compile")(function* (source: string, options?: GlobPatternOptions) {
		return yield* Effect.fromResult(GlobPattern.compileResult(source, options));
	});

	/**
	 * Whether `candidate` matches this pattern. Total: never throws. Time is
	 * polynomial, bounded by the recursion cap, so a hostile pattern against a
	 * long candidate can still be slow. The globstar backtracking cap is a
	 * documented false negative (upstream's deliberate correctness-for-security
	 * trade), never an error.
	 *
	 * @remarks
	 * A stack overflow inside the matcher, possible only when a raised
	 * `maxGlobstarRecursion` meets a caller already deep in its own stack or a
	 * runtime with a small one, is answered the way the cap answers: as though
	 * no alternative matched. That is `false` for an ordinary pattern and `true`
	 * for a negated one, which is also what a negated pattern answers when the
	 * cap cuts its walk short. Only a `RangeError` is absorbed; anything else
	 * the engine throws is a defect and propagates.
	 *
	 * Hostile input: matching stays polynomial, and this package does not bound
	 * its total work. A literal segment between two globstars, matched against
	 * a path of 50,000 portions, takes seconds (the package README spells the
	 * pattern out), and brace expansion multiplies the work of compiling and
	 * matching by its alternatives. Matching is synchronous and blocks the
	 * calling thread until it returns, so an in-process timeout cannot cut it
	 * short: wrapped in `Effect.sync` and raced by `Effect.timeout`, a slow match
	 * still runs to completion before the timer can fire. A caller matching a
	 * pattern or a path taken from untrusted input bounds the input before
	 * matching: limit the pattern's length and where it may come from, limit the
	 * candidate's length or portion count, and lower `braceExpandMax` in
	 * {@link GlobPatternOptions}, which turns a brace product past it (such as
	 * `**\/a/**\/*{a,b}{a,b}…*`, ten groups and 1,024 alternatives, against a
	 * `braceExpandMax` of 100) into a compile-time `ExpansionBudgetExceeded`
	 * failure. A numeric range of 100 or more values (`{0..999}`) is not
	 * expanded, so the budget does not apply to it. A deadline, where one is
	 * enforced off the calling thread: a worker that is terminated when it
	 * expires, a subprocess, or the host's own request deadline.
	 */
	matches(candidate: string): boolean {
		const engine = this.#engineOf();
		try {
			return engine.match(candidate);
		} catch (e) {
			if (!(e instanceof RangeError)) throw e;
			// The cap's own answer when no alternative is allowed to match.
			return engine.options.flipNegate ? false : engine.negate;
		}
	}

	/**
	 * Whether the pattern contains any magic (wildcards, classes, extglobs, or
	 * a numeric brace range of 100 or more values, which is matched as one
	 * portion rather than expanded, as minimatch 11 does).
	 */
	get hasMagic(): boolean {
		return this.#engineOf().hasMagic();
	}

	/** Whether the pattern is a leading-bang whole-pattern negation. */
	get negated(): boolean {
		return this.#engineOf().negate;
	}

	/**
	 * Whether some brace alternative matches a path by its basename, at any
	 * depth: the pattern was compiled with `matchBase` and that alternative
	 * compiles to one path portion. `*.js` then matches `b/d/f/g.js`, and so does
	 * `x/../*.js`, which compiles to `*.js`; `src/*.ts` does not, since it is two
	 * portions and `matchBase` changes nothing about it. Always `false` without
	 * `matchBase`, so for a pattern built by `make`, decode or `FromString`.
	 *
	 * @remarks
	 * Read off the compiled alternatives, the same test matching applies, so it
	 * is exact however the source is spelled. {@link GlobPattern.enumerationPrefix},
	 * {@link GlobPattern.enumerationRoots}, {@link GlobPattern.crossesSegments}
	 * and {@link GlobPattern.literalPrefix} already account for it. A directory
	 * walker that bounds its reads by the pattern's depth or by hidden names
	 * reads it to know that no such bound holds.
	 */
	get matchesByBasename(): boolean {
		const engine = this.#engineOf();
		return engine.set.some((row) => isBasenameRow(engine, row));
	}

	/**
	 * The longest literal directory prefix: the common run of leading literal
	 * segments across every brace alternative, joined and slash-terminated;
	 * `""` when the first segment carries magic, or when an alternative
	 * matches by basename ({@link GlobPattern.matchesByBasename}), since its
	 * matches lie anywhere below the base. Designed for directory enumerators.
	 *
	 * @remarks
	 * Meaningful for **non-negated** patterns only. For a negated pattern
	 * ({@link GlobPattern.negated}), the prefix is still computed from the inner
	 * pattern, but {@link GlobPattern.matches} inverts the result — so the
	 * pattern can match paths *outside* this prefix. A consumer that bounds
	 * traversal to `enumerationPrefix` (e.g. a walker's descent) will
	 * under-enumerate against a negated pattern; guard on `negated` and do not
	 * use `enumerationPrefix` as the traversal root there — enumerate from `cwd`
	 * or another encompassing root instead. The inversion is not the getter's
	 * semantics to express — check `negated` at the call site.
	 */
	get enumerationPrefix(): string {
		const common = this.#commonLiterals();
		return common.length === 0 ? "" : `${common.join("/")}/`;
	}

	// The common run of leading literal portions across every compiled row: the portions `enumerationPrefix` joins.
	#commonLiterals(): ReadonlyArray<string> {
		const engine = this.#engineOf();
		let common: Array<string> | undefined;
		for (const row of engine.set) {
			const literals: Array<string> = [];
			// A row matched by basename lies anywhere below the base: it has no literal prefix.
			if (!isBasenameRow(engine, row))
				for (const part of row) {
					if (typeof part !== "string") break;
					literals.push(part);
				}
			if (common === undefined) {
				common = literals;
			} else {
				let i = 0;
				while (i < common.length && i < literals.length && common[i] === literals[i]) i++;
				common = common.slice(0, i);
			}
		}
		return common ?? [];
	}

	/**
	 * The literal leading directory segments before the first segment that
	 * carries magic, unescaped, joined with `/` and with no trailing slash. `""`
	 * when the first segment is magic (the base, as for
	 * {@link GlobPattern.enumerationPrefix}).
	 *
	 * @remarks
	 * Braces are not expanded: an unescaped `{` makes its segment magic, so
	 * `src/{a,b}/*.ts` gives `src` (unless `nobrace` is on). A pattern with no
	 * magic at all gives the whole pattern, so `src/a.ts` gives `src/a.ts`. The
	 * spelling is kept (`./src/**` gives `./src`, `../x/*.ts` gives `../x`), a
	 * root stays (`/*.ts` gives `/`), and an escape is undone (`a\*b/c/*` gives
	 * `a*b/c`). Extglobs, classes and `?` are magic. A comment gives `""`.
	 * Computed under this pattern's options. When an alternative matches by
	 * basename ({@link GlobPattern.matchesByBasename}) it gives `""`, as
	 * {@link GlobPattern.enumerationPrefix} does: under `matchBase` a slash-less
	 * `src` also matches `a/src`.
	 *
	 * It returns the pattern's spelling and never folds case: under `nocase`,
	 * `SRC/Lib/**` gives `SRC/Lib`, though the pattern also matches `src/lib/a.ts`.
	 * It is not a safe walk root there on a case-sensitive filesystem.
	 * {@link GlobPattern.enumerationPrefix} is more conservative: `nocase` turns a
	 * letter segment into a case-insensitive matcher, so it stops there.
	 *
	 * Like {@link GlobPattern.enumerationPrefix} it reads the inner pattern of a
	 * negated one: guard on {@link GlobPattern.negated} at the call site.
	 */
	get literalPrefix(): string {
		const engine = this.#engineOf();
		if (engine.comment || engine.empty || this.matchesByBasename) return "";
		const options = engine.options;
		const braces = !options.nobrace;
		const literals: Array<string> = [];
		const segments = splitSegments(engine.pattern, engine.preserveMultipleSlashes);
		for (const segment of segments) {
			if (braces && hasUnescapedBrace(segment)) break;
			const literal = literalSegment(segment, options);
			if (literal === undefined) break;
			literals.push(literal);
		}
		if (literals.length === 1 && literals[0] === "") return "/";
		return literals.join("/");
	}

	/**
	 * Where a walker must read to enumerate this pattern: one root per brace
	 * alternative, each with its own literal directory prefix and its own depth.
	 *
	 * @remarks
	 * Where {@link GlobPattern.enumerationPrefix} and
	 * {@link GlobPattern.crossesSegments} fold every alternative into one answer
	 * (the shared prefix, "deep if any is"), this keeps them apart, so
	 * `packages/{a,b}/src/*.ts` reads `packages/a/src/` and `packages/b/src/` —
	 * one level each — rather than all of `packages/`. A root's `prefix`
	 * excludes the final segment of an all-literal alternative (a file name),
	 * so `src/{a,b}.ts` has the single root `src/`. Prefixes are canonical, so
	 * `{src,./src}/*.ts` has the single root `src/` too. Roots are distinct; one
	 * whose prefix lies inside a `deep` root's is dropped, since that root
	 * already reads it, and its spellings join that root's. A prefix that climbs
	 * above the base (a leading `..`) never lies inside the base's own root, so
	 * `{**,../x/*}` keeps `../x/` as a root of its own. Two kept roots never
	 * yield the same file: a shallow root's files lie exactly one level below
	 * it, and no root lies inside a deep one.
	 *
	 * Under `matchBase` an alternative that compiles to one path portion
	 * matches by basename at any depth, so its root is the base `""`, `deep`,
	 * with the spelling `""`: `{*.js,src/*.ts}` has the roots `""` (deep) and
	 * `src/` folded into it.
	 *
	 * Like the other enumerator getters it reads the inner pattern and ignores
	 * whole-pattern negation: guard on {@link GlobPattern.negated}, and
	 * enumerate a negated pattern from `cwd`.
	 */
	get enumerationRoots(): ReadonlyArray<EnumerationRoot> {
		// Canonical prefix -> whether any alternative under it is deep, and the spellings that reach it.
		const merged = new Map<string, { deep: boolean; spellings: Set<string> }>();
		// Each spelling's first alternative, so a root lists its spellings in pattern order.
		const firstSeen = new Map<string, number>();
		const engine = this.#engineOf();
		for (const row of engine.set) {
			const byBasename = isBasenameRow(engine, row);
			const firstMagic = row.findIndex((part) => typeof part !== "string");
			const literals = (
				byBasename ? [] : firstMagic === -1 ? row.slice(0, -1) : row.slice(0, firstMagic)
			) as Array<string>;
			const deep = byBasename || row.includes(GLOBSTAR) || (firstMagic !== -1 && firstMagic < row.length - 1);
			const prefix = canonicalPrefix(literals);
			const spelling = literals.length === 0 ? "" : `${literals.join("/")}/`;
			if (!firstSeen.has(spelling)) firstSeen.set(spelling, firstSeen.size);
			const entry = merged.get(prefix);
			if (entry === undefined) merged.set(prefix, { deep, spellings: new Set([spelling]) });
			else {
				entry.deep ||= deep;
				entry.spellings.add(spelling);
			}
		}
		// The base's own root holds every prefix below it, but not a climb: `../x/` lies outside the base, so it stays
		// a root of its own, one a walker refuses, and never lends its spelling to the base's walk.
		const inside = (prefix: string, deepPrefix: string): boolean =>
			deepPrefix === "" ? !prefix.startsWith("../") : prefix.startsWith(deepPrefix);
		const kept = [...merged].filter(
			([prefix]) => ![...merged].some(([other, { deep }]) => other !== prefix && deep && inside(prefix, other)),
		);
		// A kept deep root walks every root it absorbed, so it matches under their spellings too.
		return kept.map(([prefix, { deep, spellings: own }]): EnumerationRoot => {
			const all = new Set(own);
			if (deep)
				for (const [other, absorbed] of merged)
					if (other !== prefix && inside(other, prefix)) for (const spelling of absorbed.spellings) all.add(spelling);
			const spellings = [...all].sort((a, b) => (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0));
			return { prefix, deep, spellings };
		});
	}

	/**
	 * Whether the pattern can match more than one level below
	 * {@link GlobPattern.enumerationPrefix}: true iff any alternative contains
	 * a globstar, or has more than one segment past that shared prefix, or
	 * (under `matchBase`) compiles to one path portion, which matches by
	 * basename at any depth. The enumerator
	 * uses this to decide between a single-level read and a bounded recursive
	 * descent.
	 *
	 * @remarks
	 * The depth is measured from the prefix every alternative shares, not from
	 * each alternative's own: `{apps,packages}/*` shares the prefix `""` and
	 * matches `apps/a`, two levels below it, so it crosses segments, though
	 * `apps/*` alone does not. {@link GlobPattern.enumerationRoots} keeps the
	 * alternatives apart instead, for a walker that reads each one's own root.
	 *
	 * Like {@link GlobPattern.enumerationPrefix}, this reads the inner pattern
	 * and does not account for whole-pattern negation; guard on
	 * {@link GlobPattern.negated} at the call site.
	 */
	get crossesSegments(): boolean {
		const engine = this.#engineOf();
		// Measured against the SHARED prefix: `{apps,packages}/*` shares `""`, so its matches lie two levels below it,
		// though each alternative alone is one level below its own literal run.
		const shared = this.#commonLiterals().length;
		return engine.set.some((row) => isBasenameRow(engine, row) || row.includes(GLOBSTAR) || row.length > shared + 1);
	}

	/**
	 * How many alternatives a compile of `source` under `options` matches, counted
	 * without compiling it: the distinct results of its brace expansion, after
	 * a leading `!` is read, so `{a,b}/{c,d}` is 4 and `{a,b}{c,d}{e,f}{g,h}{i,j}`
	 * is 32. A numeric range of 100 or more values is matched as one portion,
	 * not expanded, so `{0..999}` is 1, while `{1..99}{a,b}` is 198. A comment or
	 * an empty pattern is 0. It runs the compile's own expansion and stops
	 * before any portion is built, so a count it answers is exact.
	 *
	 * @remarks
	 * Bounded, and total for pattern input: the work is the brace expansion's,
	 * and every guard that bounds it fails typed with {@link GlobPatternError},
	 * as {@link GlobPattern.compileResult} would: past 64 KB (`PatternTooLong`),
	 * nesting past 256 levels (`NestingDepthExceeded`), or more alternatives
	 * than `braceExpandMax` (`ExpansionBudgetExceeded`). The cap applies to the
	 * expansion before duplicates are dropped, as it does in a compile, so a
	 * pattern whose distinct count is under the cap can still fail it
	 * (`"{,}".repeat(10)` counts 0, yet expands 1,024 results first), and the
	 * failure's `actual` is where the expansion stopped, a lower bound, not the
	 * size. A caller weighing a pattern against a ceiling of its own passes that
	 * ceiling as `braceExpandMax`, so the expansion stops there instead of at
	 * 100,000, and reads a failure as "more than the ceiling". It does not check that the pattern compiles:
	 * a compile can still fail where the count succeeds (a compile budget, an
	 * unbuildable regexp). Invalid options throw at `GlobPatternOptions.make`.
	 *
	 * @example
	 * ```ts
	 * import { GlobPattern, GlobPatternOptions } from "@effected/glob";
	 * import { Result } from "effect";
	 *
	 * GlobPattern.alternativeCount("packages/{a,b}/{src,lib}/*.ts"); // => Result.succeed(4)
	 * const capped = GlobPattern.alternativeCount("{a,b}".repeat(9), GlobPatternOptions.make({ braceExpandMax: 256 }));
	 * Result.isFailure(capped); // => true, ExpansionBudgetExceeded (512 alternatives)
	 * ```
	 */
	static alternativeCount(source: string, options?: GlobPatternOptions): Result.Result<number, GlobPatternError> {
		return Result.try({
			try: () => engineAlternativeCount(source, toEngineOptions(options)),
			catch: (e) => {
				// Only a guard trip is a typed failure; anything else rethrows as a defect.
				if (isGuardExceeded(e)) {
					return new GlobPatternError({ pattern: source, reason: e.reason, limit: e.limit, actual: e.actual });
				}
				throw e;
			},
		});
	}

	/** Escape every magic character in `literal` so it matches only itself. */
	static escape(literal: string, options?: GlobPatternOptions): string {
		return engineEscape(literal, toEngineOptions(options));
	}

	/** Undo {@link GlobPattern.escape}. */
	static unescape(pattern: string, options?: GlobPatternOptions): string {
		return engineUnescape(pattern, toEngineOptions(options));
	}

	/**
	 * `Schema.Codec<GlobPattern, string>` — decode a bare pattern string into
	 * a compiled default-options GlobPattern; encode back to its source. The
	 * house FromString-static idiom for embedding patterns in config schemas;
	 * decode failures surface as `SchemaError` for the embedding boundary to
	 * normalize.
	 */
	static readonly FromString: Schema.Codec<GlobPattern, string> = Schema.String.pipe(
		Schema.decodeTo(
			GlobPattern,
			// The transformation bridges string <-> GlobPattern's ENCODED side;
			// the class decode then runs the compilability check and constructs
			// the instance, so uncompilable input fails as SchemaError there.
			SchemaTransformation.transform({
				decode: (input: string) => ({ source: input }),
				encode: (encoded: { readonly source: string }) => encoded.source,
			}),
		),
	);
}
