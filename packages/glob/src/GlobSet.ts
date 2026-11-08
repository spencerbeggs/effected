// The GlobSet facade: multi-pattern include/exclude sets with glob-core's SET
// semantics — a leading bang marks an exclusion filter applied after positive
// matching. This is deliberately distinct from minimatch's whole-pattern
// negation: both exist, at different levels, on purpose.
//
// GlobSet pins DEFAULT options internally and takes no options surface of its
// own, so a set means the same thing everywhere. Braced patterns classify per
// expanded alternative, so {tools/cli,packages/*} contributes a literal AND a
// wildcard; a numeric range of 100 or more values stays one alternative, a
// wildcard, as minimatch 11 keeps it one portion.

import { Effect, Result, Schema } from "effect";
import type { GlobPattern } from "./GlobPattern.js";
import { GlobPatternError, patternWithEngine } from "./GlobPattern.js";
import type { CompileBudget } from "./internal/ast.js";
import { compileBudget, markBudget, rewindBudget } from "./internal/ast.js";
import { isGuardExceeded } from "./internal/limits.js";
import { Minimatch, braceAlternatives } from "./internal/minimatch.js";

// Strip exactly ONE leading bang: the set-level exclusion marker. A remaining
// bang is then ordinary minimatch whole-pattern negation inside the exclude —
// degenerate, permitted, not specially cased.
const exclusionTarget = (pattern: string): string | undefined =>
	pattern.startsWith("!") ? pattern.slice(1) : undefined;

interface Classified {
	readonly literals: ReadonlyArray<string>;
	readonly wildcards: ReadonlyArray<GlobPattern>;
	readonly excludes: ReadonlyArray<GlobPattern>;
	readonly literalSet: ReadonlySet<string>;
}

// The alternatives of one include, each routed by its own magic, or undefined
// when the include must stay whole: one alternative can not be written as
// text (braceAlternatives), or does not compile alone though the whole did.
// The whole is then one wildcard, whose answer is the union of them all, and
// the work its alternatives were charged is handed back first: the whole is
// charged for what it builds, so a set near the budget is not refused early.
const classifyInclude = (
	pattern: string,
	budget: CompileBudget,
	whole: Minimatch,
): { readonly literals: Array<string>; readonly wildcards: Array<GlobPattern> } | undefined => {
	const alternatives = braceAlternatives(pattern, {});
	if (alternatives === undefined) return undefined;
	const mark = markBudget(budget);
	const literals: Array<string> = [];
	const wildcards: Array<GlobPattern> = [];
	for (const alternative of alternatives) {
		let engine: Minimatch;
		try {
			// An include with no brace to split is its own one alternative: its engine is already built.
			engine = alternative === pattern ? whole : new Minimatch(alternative, {}, budget);
		} catch (e) {
			if (isGuardExceeded(e)) {
				rewindBudget(budget, mark);
				return undefined;
			}
			throw e;
		}
		if (engine.hasMagic()) {
			wildcards.push(patternWithEngine(alternative, engine));
			continue;
		}
		if (engine.comment) continue;
		const row = engine.set.length === 1 ? engine.set[0] : undefined;
		if (engine.negate || row === undefined || !row.every((part) => typeof part === "string")) {
			wildcards.push(patternWithEngine(alternative, engine));
			continue;
		}
		literals.push(row.join("/"));
	}
	return { literals, wildcards };
};

// Compile every member under default options and classify the set. A set is
// one compile: every engine it keeps is built under one budget
// (MAX_REGEXP_WORK) and handed to its pattern, so the set holds no more than
// one pattern could. Only a guard trip escapes, as a GuardExceeded naming no
// member; the caller knows which member it was compiling.
const classify = (patterns: ReadonlyArray<string>, onMember: (pattern: string) => void = () => {}): Classified => {
	const budget = compileBudget();
	const literals: Array<string> = [];
	const seenLiterals = new Set<string>();
	const wildcards: Array<GlobPattern> = [];
	const excludes: Array<GlobPattern> = [];
	for (const pattern of patterns) {
		onMember(pattern);
		const target = exclusionTarget(pattern);
		if (target !== undefined) {
			excludes.push(patternWithEngine(target, new Minimatch(target, {}, budget)));
			continue;
		}
		// The member must compile whole, on the set's budget: it is part of the
		// one compile, and its alternatives reuse every validation it made, so
		// only their graph items are charged again. The engine is kept when the
		// include stays whole, never built twice.
		const whole = new Minimatch(pattern, {}, budget);
		const routed = classifyInclude(pattern, budget, whole);
		if (routed === undefined) {
			wildcards.push(patternWithEngine(pattern, whole));
			continue;
		}
		wildcards.push(...routed.wildcards);
		for (const key of routed.literals) {
			if (!seenLiterals.has(key)) {
				seenLiterals.add(key);
				literals.push(key);
			}
		}
	}
	return { literals, wildcards, excludes, literalSet: seenLiterals };
};

// The schema check: every member (exclusion bang stripped) must compile under
// default options, and the set must classify, so a constructed set never
// fails later. Returning the guard message string makes it the thrown
// validation message.
const allCompileUnderDefaults = (patterns: ReadonlyArray<string>): true | string => {
	let current = "";
	try {
		classify(patterns, (pattern) => {
			current = pattern;
		});
	} catch (e) {
		if (isGuardExceeded(e)) return `pattern ${JSON.stringify(current.slice(0, 64))}: ${e.message}`;
		throw e;
	}
	return true;
};

/**
 * A compiled multi-pattern include/exclude set: `matches(candidate)` is true
 * when some include accepts it and no exclude does. One encoded field,
 * `patterns` — the source text of every member, preserved verbatim; the
 * classified indexes live in a private field the schema never encodes.
 *
 * @remarks
 * A member starting with `!` is an exclusion, applied after positive matching.
 * This is set-level exclusion, distinct from a single {@link GlobPattern}'s
 * whole-pattern negation. Exclusions are order-independent: an exclusion
 * removes what it matches whatever its place in `patterns`, before or after
 * the includes it filters, and no later include puts a path back. npm's
 * `workspaces` negations are ordered instead: there a `!` pattern removes only
 * what the patterns before it added, and a later positive adds a path again
 * (`["packages/*", "!packages/a", "packages/a"]` keeps `packages/a` in npm and
 * drops it here). A caller reproducing npm's rule applies its patterns in
 * order itself.
 *
 * The structural accessors ({@link GlobSet.literals},
 * {@link GlobSet.wildcards}, {@link GlobSet.excludes}) serve directory
 * enumerators: literals fast-path an exact lookup, wildcards drive directory
 * reads from their `enumerationPrefix`, and `crossesSegments` triggers a
 * bounded recursive descent.
 *
 * A set is one compile: its members share one compile budget, and past it
 * {@link GlobSet.compileResult} fails typed with reason
 * `CompileBudgetExceeded`. A portion's validation regexp costs 1,536 units
 * a Unicode property escape (`[[:alpha:]]` writes two, `[[:word:]]` four),
 * once for each distinct portion in the set: members sharing one
 * (`d1/[[:alpha:]]*.ts`, `d2/[[:alpha:]]*.ts`) are charged once and compile at
 * 20,000 members, while a set in which every member has its own
 * `[[:alpha:]]` portion tops out at about 2,550 members (about 1,280 for
 * `[[:word:]]`). Sets of plain, brace and numeric-range members compile at
 * 20,000 members.
 *
 * @example
 * ```ts
 * import { GlobSet } from "@effected/glob";
 * import { Result } from "effect";
 *
 * const compiled = GlobSet.compileResult(["packages/*", "!packages/legacy"]);
 * if (Result.isSuccess(compiled)) {
 * 	compiled.success.matches("packages/app"); // => true
 * 	compiled.success.matches("packages/legacy"); // => false
 * }
 * ```
 *
 * @public
 */
export class GlobSet extends Schema.Class<GlobSet>("GlobSet")(
	Schema.Struct({ patterns: Schema.Array(Schema.String) }).check(
		Schema.makeFilter((v) => allCompileUnderDefaults(v.patterns), { title: "compilable glob pattern set" }),
	),
) {
	#classified: Classified | undefined;

	// Lazy for `make`/decode-constructed sets: the schema check already
	// classified the same members, so this can not fail. `compileResult`
	// classifies eagerly and hands its result over. Classification is per
	// expanded alternative: brace-expand each include under default options and
	// route each alternative by its own magic. A numeric range of 100 or more
	// values is not expanded (minimatch 11 matches it as one portion), so its
	// alternative is a wildcard, and an include whose alternatives can not be
	// written alone as text stays one wildcard.
	//
	// The literal bucket keys on the engine's UNESCAPED single row, never the
	// raw alternative source — the engine matches candidates in unescaped form,
	// so keying on an escaped-magic source (foo\*bar) would silently drop every
	// match its member pattern accepts. Comments match nothing and contribute
	// nothing; anything else an exact-string key cannot represent (negation, a
	// row the engine did not reduce to plain strings) is engine-matched instead.
	#classify(): Classified {
		this.#classified ??= classify(this.patterns);
		return this.#classified;
	}

	#literals(): ReadonlySet<string> {
		return this.#classify().literalSet;
	}

	/**
	 * Compile a pattern set, synchronously — the primitive form, mirroring
	 * {@link GlobPattern.compileResult}. Set compilation is pure
	 * string→predicate work with no IO and no async step, so the sync form is
	 * the real primitive and {@link GlobSet.compile} is derived from it.
	 *
	 * Total: never throws for pattern input. Fails on the FIRST uncompilable
	 * member, coming back as a `Result` failure whose {@link GlobPatternError}
	 * names the offending source pattern in `pattern` (bang included for
	 * exclusions).
	 *
	 * @remarks
	 * For synchronous call sites that cannot host an Effect — a lint-staged
	 * handler, a config predicate — this removes the
	 * `Effect.runSync(Effect.result(...))` escape hatch: pair it with
	 * `Result.isSuccess` and read `.success` directly. Effect call sites should
	 * prefer {@link GlobSet.compile}, which carries the tracing span.
	 */
	static compileResult(patterns: ReadonlyArray<string>): Result.Result<GlobSet, GlobPatternError> {
		// Classified now, so every guard trips here, typed, and never in matches.
		let current = "";
		const classified = Result.try({
			try: () =>
				classify(patterns, (pattern) => {
					current = pattern;
				}),
			catch: (e) => {
				// Only a guard trip is a typed failure; anything else rethrows as a defect.
				if (isGuardExceeded(e)) {
					return new GlobPatternError({ pattern: current, reason: e.reason, limit: e.limit, actual: e.actual });
				}
				throw e;
			},
		});
		if (Result.isFailure(classified)) return Result.fail(classified.failure);
		const set = GlobSet.#unchecked(patterns);
		set.#classified = classified.success;
		return Result.succeed(set);
	}

	// A set whose members were just classified: the schema check would only
	// classify them again.
	static #unchecked(patterns: ReadonlyArray<string>): GlobSet {
		return new GlobSet({ patterns }, { disableChecks: true });
	}

	/**
	 * Compile a pattern set — with {@link GlobPattern.compile}, the package's
	 * only other fallible boundary, and the form Effect call sites should reach
	 * for. Fails typed on the FIRST uncompilable member, with the error's
	 * `pattern` field naming the offending source pattern (bang included for
	 * exclusions).
	 *
	 * Defined in terms of {@link GlobSet.compileResult} — synchronous callers
	 * can use that variant directly. Same semantics, same errors; this form
	 * adds only the `GlobSet.compile` tracing span.
	 */
	static readonly compile = Effect.fn("GlobSet.compile")(function* (patterns: ReadonlyArray<string>) {
		return yield* Effect.fromResult(GlobSet.compileResult(patterns));
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
