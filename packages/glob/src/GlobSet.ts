// The GlobSet facade: multi-pattern include/exclude sets with glob-core's SET
// semantics — a leading bang marks an exclusion filter applied after positive
// matching. This is deliberately distinct from minimatch's whole-pattern
// negation: both exist, at different levels, on purpose.
//
// GlobSet pins DEFAULT options internally: it is the drift-free workspaces
// contract and takes no options surface of its own. Braced patterns classify
// per expanded alternative (the pinned implementation decision), so
// {tools/cli,packages/*} contributes a literal AND a wildcard.

import { Effect, Schema } from "effect";
import { GlobPattern, GlobPatternError } from "./GlobPattern.js";
import { isGuardExceeded } from "./internal/limits.js";
import { Minimatch, braceExpand } from "./internal/minimatch.js";

// Strip exactly ONE leading bang: the set-level exclusion marker. A remaining
// bang is then ordinary minimatch whole-pattern negation inside the exclude —
// degenerate, permitted, not specially cased.
const exclusionTarget = (pattern: string): string | undefined =>
	pattern.startsWith("!") ? pattern.slice(1) : undefined;

// The schema check: every member (exclusion bang stripped) must compile under
// default options. Returning the guard message string makes it the thrown
// validation message.
const allCompileUnderDefaults = (patterns: ReadonlyArray<string>): true | string => {
	for (const pattern of patterns) {
		const target = exclusionTarget(pattern) ?? pattern;
		try {
			new Minimatch(target, {});
		} catch (e) {
			if (isGuardExceeded(e)) return `pattern ${JSON.stringify(pattern.slice(0, 64))}: ${e.message}`;
			throw e;
		}
	}
	return true;
};

interface Classified {
	readonly literals: ReadonlyArray<string>;
	readonly wildcards: ReadonlyArray<GlobPattern>;
	readonly excludes: ReadonlyArray<GlobPattern>;
}

/**
 * A compiled multi-pattern include/exclude set: `matches(candidate)` is true
 * when some include accepts it and no exclude does. One encoded field,
 * `patterns` — the source text of every member, preserved verbatim; the
 * classified indexes live in a private field the schema never encodes.
 *
 * The structural accessors ({@link GlobSet.literals},
 * {@link GlobSet.wildcards}, {@link GlobSet.excludes}) serve the workspaces
 * enumerator: literals fast-path an exact lookup, wildcards drive directory
 * reads from their `enumerationPrefix`, and `crossesSegments` triggers the
 * bounded recursive descent — the issue-#62 fix end to end.
 *
 * @public
 */
export class GlobSet extends Schema.Class<GlobSet>("GlobSet")(
	Schema.Struct({ patterns: Schema.Array(Schema.String) }).check(
		Schema.makeFilter((v) => allCompileUnderDefaults(v.patterns), { title: "compilable glob pattern set" }),
	),
) {
	#classified: Classified | undefined;
	#literalSet: ReadonlySet<string> | undefined;

	// Lazy: the schema check guarantees every member is defaults-compilable, so
	// classification cannot fail for constructed instances. Classification is
	// per expanded alternative: brace-expand each include under default options
	// and route each alternative by its own magic.
	//
	// The literal bucket keys on the engine's UNESCAPED single row, never the
	// raw alternative source — the engine matches candidates in unescaped form,
	// so keying on an escaped-magic source (foo\*bar) would silently drop every
	// match its member pattern accepts. Comments match nothing and contribute
	// nothing; anything else an exact-string key cannot represent (negation, a
	// row the engine did not reduce to plain strings) is engine-matched instead.
	#classify(): Classified {
		if (this.#classified !== undefined) return this.#classified;
		const literals: Array<string> = [];
		const seenLiterals = new Set<string>();
		const wildcards: Array<GlobPattern> = [];
		const excludes: Array<GlobPattern> = [];
		for (const pattern of this.patterns) {
			const target = exclusionTarget(pattern);
			if (target !== undefined) {
				excludes.push(GlobPattern.make({ source: target }));
				continue;
			}
			for (const alternative of braceExpand(pattern, {})) {
				const engine = new Minimatch(alternative, {});
				if (engine.hasMagic()) {
					wildcards.push(GlobPattern.make({ source: alternative }));
					continue;
				}
				if (engine.comment) continue;
				const row = engine.set.length === 1 ? engine.set[0] : undefined;
				if (engine.negate || row === undefined || !row.every((part) => typeof part === "string")) {
					wildcards.push(GlobPattern.make({ source: alternative }));
					continue;
				}
				const key = row.join("/");
				if (!seenLiterals.has(key)) {
					seenLiterals.add(key);
					literals.push(key);
				}
			}
		}
		this.#classified = { literals, wildcards, excludes };
		this.#literalSet = seenLiterals;
		return this.#classified;
	}

	#literals(): ReadonlySet<string> {
		if (this.#literalSet === undefined) this.#classify();
		return this.#literalSet as ReadonlySet<string>;
	}

	/**
	 * Compile a pattern set — with {@link GlobPattern.compile}, the package's
	 * only other fallible boundary. Fails typed on the FIRST uncompilable
	 * member, with the error's `pattern` field naming the offending source
	 * pattern (bang included for exclusions).
	 */
	static readonly compile = Effect.fn("GlobSet.compile")(function* (patterns: ReadonlyArray<string>) {
		for (const pattern of patterns) {
			const target = exclusionTarget(pattern) ?? pattern;
			try {
				new Minimatch(target, {});
			} catch (e) {
				if (isGuardExceeded(e)) {
					return yield* new GlobPatternError({ pattern, reason: e.reason, limit: e.limit, actual: e.actual });
				}
				throw e;
			}
		}
		return new GlobSet({ patterns });
	});

	/**
	 * Whether `candidate` matches the set: some include accepts it (literal
	 * exact-match fast path, then wildcards) and no exclude does. Total.
	 */
	matches(candidate: string): boolean {
		const { wildcards, excludes } = this.#classify();
		const included = this.#literals().has(candidate) || wildcards.some((w) => w.matches(candidate));
		if (!included) return false;
		return !excludes.some((e) => e.matches(candidate));
	}

	/** Whether `candidate` is caught by the exclusion filter, independently of inclusion. */
	isExcluded(candidate: string): boolean {
		return this.#classify().excludes.some((e) => e.matches(candidate));
	}

	/** The deduped effective literal include paths (unescaped), in first-seen order. */
	get literals(): ReadonlyArray<string> {
		return this.#classify().literals;
	}

	/**
	 * The include alternatives the engine must match, compiled: every magic
	 * alternative, plus the rare non-magic shapes an exact-string key cannot
	 * represent (whole-pattern negation from a brace alternative).
	 */
	get wildcards(): ReadonlyArray<GlobPattern> {
		return this.#classify().wildcards;
	}

	/** The exclusion patterns (leading bang stripped), compiled. */
	get excludes(): ReadonlyArray<GlobPattern> {
		return this.#classify().excludes;
	}
}
