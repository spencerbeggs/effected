// The GlobPattern facade: single-pattern compilation, total matching, the
// enumerator metadata getters, the schema-validated options surface, the
// FromString codec and the escape statics — plus GlobPatternError, the
// package's typed failure vocabulary (errors-near-domain rule).
//
// Cycle firewall: this module imports the engine; the engine never imports
// it. The engine throws raw GuardExceeded records at compile time; ONLY this
// facade materializes them into the typed GlobPatternError.

import { Effect, Result, Schema, SchemaTransformation } from "effect";
import { EXPANSION_MAX, isGuardExceeded } from "./internal/limits.js";
import type { EngineOptions } from "./internal/minimatch.js";
import { GLOBSTAR, Minimatch, escape as engineEscape, unescape as engineUnescape } from "./internal/minimatch.js";

/**
 * Typed failure raised when a glob pattern trips a compile-time guard:
 * over-length, brace-expansion budget exhaustion, or nesting past the depth
 * cap. Malformed input is never a defect — this is the only failure the
 * package's fallible boundaries ({@link GlobPattern.compile} and
 * `GlobSet.compile`) can produce.
 *
 * @public
 */
export class GlobPatternError extends Schema.TaggedError<GlobPatternError>()("GlobPatternError", {
	/** The pattern source that was rejected. */
	pattern: Schema.String,
	/** Which guard tripped: pattern length, brace-expansion budget, or nesting depth. */
	reason: Schema.Literals(["PatternTooLong", "ExpansionBudgetExceeded", "NestingDepthExceeded"]),
	/** The cap the pattern exceeded. */
	limit: Schema.Number,
	/** The measured value that exceeded `limit`. */
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
	/** Maximum number of non-adjacent `**` segments the matcher recursively walks down. */
	maxGlobstarRecursion: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
	/** Maximum depth to traverse for nested extglobs like `*(a|b|c)`. */
	maxExtglobRecursion: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
}) {}

// Conditional-spread bridge: a present-but-undefined optionalKey never happens
// through the schema, but the engine bag must not carry explicit undefined
// either (exactOptionalPropertyTypes).
const toEngineOptions = (o?: GlobPatternOptions): EngineOptions => ({
	...(o?.nobrace !== undefined && { nobrace: o.nobrace }),
	...(o?.nocomment !== undefined && { nocomment: o.nocomment }),
	...(o?.nonegate !== undefined && { nonegate: o.nonegate }),
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
	 * surfaces instead.
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
				// Defaults first (the value invariant), then the effective engine.
				new Minimatch(source, {});
				const engine = new Minimatch(source, engineOptions);
				const pattern = new GlobPattern({ source });
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
	 * (over-length, expansion budget, nesting depth) fail typed with
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
	 * Whether `candidate` matches this pattern. Total: never throws, never
	 * hangs. The globstar backtracking cap is a documented false negative
	 * (upstream's deliberate correctness-for-security trade), never an error.
	 */
	matches(candidate: string): boolean {
		return this.#engineOf().match(candidate);
	}

	/** Whether the pattern contains any magic (wildcards, classes, extglobs). */
	get hasMagic(): boolean {
		return this.#engineOf().hasMagic();
	}

	/** Whether the pattern is a leading-bang whole-pattern negation. */
	get negated(): boolean {
		return this.#engineOf().negate;
	}

	/**
	 * The longest literal directory prefix: the common run of leading literal
	 * segments across every brace alternative, joined and slash-terminated;
	 * `""` when the first segment carries magic. Designed for directory
	 * enumerators; well-defined for default-options patterns.
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
		const set = this.#engineOf().set;
		if (set.length === 0) return "";
		let common: Array<string> | undefined;
		for (const row of set) {
			const literals: Array<string> = [];
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
		if (common === undefined || common.length === 0) return "";
		return `${common.join("/")}/`;
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
	 * Like the other enumerator getters it reads the inner pattern and ignores
	 * whole-pattern negation: guard on {@link GlobPattern.negated}, and
	 * enumerate a negated pattern from `cwd`.
	 */
	get enumerationRoots(): ReadonlyArray<EnumerationRoot> {
		// Canonical prefix -> whether any alternative under it is deep, and the spellings that reach it.
		const merged = new Map<string, { deep: boolean; spellings: Set<string> }>();
		// Each spelling's first alternative, so a root lists its spellings in pattern order.
		const firstSeen = new Map<string, number>();
		for (const row of this.#engineOf().set) {
			const firstMagic = row.findIndex((part) => typeof part !== "string");
			const literals = (firstMagic === -1 ? row.slice(0, -1) : row.slice(0, firstMagic)) as Array<string>;
			const deep = row.includes(GLOBSTAR) || (firstMagic !== -1 && firstMagic < row.length - 1);
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
	 * a globstar, or a magic segment followed by more segments. The enumerator
	 * uses this to decide between a single-level read and a bounded recursive
	 * descent.
	 *
	 * @remarks
	 * Like {@link GlobPattern.enumerationPrefix}, this reads the inner pattern
	 * and does not account for whole-pattern negation; guard on
	 * {@link GlobPattern.negated} at the call site.
	 */
	get crossesSegments(): boolean {
		return this.#engineOf().set.some((row) => {
			if (row.includes(GLOBSTAR)) return true;
			const firstMagic = row.findIndex((part) => typeof part !== "string");
			return firstMagic !== -1 && firstMagic < row.length - 1;
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
