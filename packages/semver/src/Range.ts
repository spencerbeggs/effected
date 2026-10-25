import { Effect, Function as Fn, Option, Result, Schema, SchemaIssue, SchemaTransformation } from "effect";
import { Comparator } from "./Comparator.js";
import { formatRange, parseRange } from "./internal/grammar.js";
import { normalizeSets } from "./internal/normalize.js";
import { SemVer } from "./SemVer.js";

/**
 * Indicates that a string could not be parsed as a range expression.
 *
 * Raised by {@link Range.parse} and `VersionCache.resolveString` (which
 * parses through it). The decode direction of {@link Range.FromString}
 * reports the same failure through a generic `Schema` parse error instead of
 * this class, carrying the same message.
 *
 * @public
 */
export class InvalidRangeError extends Schema.TaggedError<InvalidRangeError>()("InvalidRangeError", {
	/** The raw input string that failed to parse. */
	input: Schema.String,
	/** The character position where parsing failed, if available. */
	position: Schema.optionalKey(Schema.Number),
}) {
	override get message(): string {
		const base = `Invalid range expression: "${this.input}"`;
		return this.position !== undefined ? `${base} at position ${this.position}` : base;
	}
}

/**
 * A comparator set: comparators combined with AND semantics. A version must
 * satisfy every comparator in the set to match.
 *
 * @public
 */
export type ComparatorSet = ReadonlyArray<Comparator>;

/**
 * Options accepted by {@link Range.parse}, {@link Range.parseResult} and
 * `VersionCache.resolveString`, deciding how the parsed range treats
 * prerelease versions.
 *
 * @remarks
 * `includePrerelease` is node-semver's and core `SemVerRange`'s option of the
 * same name. It is a **parse** option because it changes what the sugar
 * means, not only how matching runs: a wildcard floor is lowered to its first
 * prerelease (`^1.2` desugars to `>=1.2.0-0 <2.0.0-0` instead of
 * `>=1.2.0 <2.0.0-0`), and a range parsed with it matches a prerelease
 * wherever its bounds contain one, with no tuple rule. The parsed
 * {@link Range} records the choice in its `includePrerelease` field, so every
 * matching entry point — {@link Range.test}, {@link Range.filter}, `satisfies`, `maxSatisfying`,
 * `minSatisfying` and the `VersionCache` lookups — honours it without being
 * told again.
 *
 * @public
 */
export interface RangeOptions {
	/**
	 * Let prerelease versions match any comparator set whose bounds contain
	 * them, and lower wildcard floors to include prereleases. Defaults to
	 * `false`: a prerelease only matches a set with a comparator carrying a
	 * prerelease on the same `major.minor.patch`.
	 */
	readonly includePrerelease?: boolean | undefined;
}

/**
 * A SemVer range expression: a union (OR) of {@link ComparatorSet}s.
 * Supports node-semver syntax — hyphen ranges (`1.0.0 - 2.0.0`), X-ranges
 * (`1.x`, `*`), tilde (`~1.2.3`), caret (`^1.2.3`) and `||` unions — which
 * parsing desugars into primitive comparators and normalizes.
 *
 * @remarks
 * The grammar follows node-semver and core `SemVerRange` at the edges:
 *
 * - any whitespace (a space, a tab, a newline) separates comparators, and
 *   whitespace may follow an operator — `>= 18` parses like `>=18`;
 * - a wildcard major bounds nothing: `^*`, `~*` and `^x` match every
 *   release, and beside another comparator they add no bound at all
 *   (`* <=0.0.0-1` matches `0.0.0-0`), while `>*` and `<*` match nothing
 *   (they desugar to the unsatisfiable `<0.0.0-0`);
 * - `<1.x` and `<1.2.x` desugar to `<1.0.0-0` and `<1.2.0-0`;
 * - a concrete component cannot follow a wildcard — `1.*.3` and `x.1.2`
 *   fail with a position;
 * - build metadata is accepted and dropped (SemVer §10), so `1.2.3+build`
 *   parses to the same range as `1.2.3` and prints without `+build`. Core
 *   rejects build metadata in a range; this package strips it, as npm does.
 *
 * Prerelease matching follows node-semver's default rule — a prerelease
 * version only satisfies a comparator set that carries a prerelease on the
 * same `major.minor.patch` — unless the range was parsed with
 * {@link RangeOptions.includePrerelease}, which the range records in its
 * `includePrerelease` field. Two ranges with the same comparator sets but
 * different `includePrerelease` are not `Equal`: they match different
 * versions.
 *
 * @example
 * ```ts
 * import { Range, SemVer } from "@effected/semver";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const range = yield* Range.parse("^1.0.0");
 *   const version = yield* SemVer.parse("1.5.0");
 *   return range.test(version);
 * });
 *
 * console.log(Effect.runSync(program));
 * // => true
 * ```
 *
 * @public
 */
export class Range extends Schema.Class<Range>("Range")({
	/** Comparator sets combined with OR semantics; a version matches when it satisfies any set. */
	sets: Schema.Array(Schema.Array(Comparator)),
	/**
	 * Whether prerelease versions match on bounds alone, with no tuple rule
	 * (see {@link RangeOptions.includePrerelease}). Defaults to `false` both
	 * when constructing and when decoding a struct that omits the key.
	 */
	includePrerelease: Schema.Boolean.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed(false)),
		Schema.withConstructorDefault(Effect.succeed(false)),
	),
}) {
	// ── Schema ──────────────────────────────────────────────────────────

	/**
	 * Schema transformation between the range expression string and
	 * {@link Range}: decoding parses, desugars and normalizes; encoding
	 * prints `a b || c d`.
	 *
	 * @remarks
	 * The string form cannot carry {@link RangeOptions.includePrerelease}, so
	 * decoding always produces the default matching rule, and a range parsed
	 * with `includePrerelease` does not survive an encode/decode round trip
	 * through this codec — only its comparator sets do. Embed the class
	 * itself (its struct form keeps the flag) where that matters.
	 */
	static readonly FromString: Schema.Codec<Range, string> = Schema.String.pipe(
		Schema.decodeTo(
			Range,
			SchemaTransformation.transformEffect({
				decode: (input: string) => {
					const result = parseRange(input);
					return result.ok
						? Effect.succeed({ sets: normalizeSets(result.value) })
						: Effect.fail(
								new SchemaIssue.InvalidValue(
									{ message: `Invalid range expression: "${result.input}" at position ${result.position}` },
									input,
								),
							);
				},
				encode: (parts) => Effect.succeed(formatRange(parts.sets)),
			}),
		),
	);

	// ── Construction ────────────────────────────────────────────────────

	/**
	 * Parse a range expression and normalize its comparator sets,
	 * synchronously, returning a `Result` instead of an `Effect`.
	 *
	 * @remarks
	 * {@link Range.parse} is defined in terms of this function; the two never
	 * diverge. Reach for the `Effect` variant inside Effect code — it carries
	 * the `Range.parse` tracing span — and for this one at synchronous
	 * boundaries.
	 *
	 * @example
	 * ```ts
	 * import { Range } from "@effected/semver";
	 * import { Result } from "effect";
	 *
	 * const ok = Range.parseResult("^1.0.0");
	 * if (Result.isSuccess(ok)) {
	 *   console.log(ok.success.toString()); // => ">=1.0.0 <2.0.0-0"
	 * }
	 * ```
	 *
	 * @param input - the range expression to parse
	 * @param options - how the range treats prereleases; see {@link RangeOptions}
	 * @returns a `Result` succeeding with the parsed {@link Range}, or failing
	 * with {@link InvalidRangeError}.
	 */
	static parseResult(input: string, options?: RangeOptions): Result.Result<Range, InvalidRangeError> {
		const includePrerelease = options?.includePrerelease === true;
		const result = parseRange(input, { includePrerelease });
		if (!result.ok) {
			return Result.fail(new InvalidRangeError({ input: result.input, position: result.position }));
		}
		return Result.succeed(
			Range.make({
				sets: normalizeSets(result.value).map((set) =>
					set.map((c) => Comparator.make({ operator: c.operator, version: SemVer.make(c.version) })),
				),
				includePrerelease,
			}),
		);
	}

	/**
	 * Parse a range expression and normalize its comparator sets. Defined in
	 * terms of {@link Range.parseResult} — synchronous callers can use that
	 * variant directly.
	 *
	 * @example
	 * ```ts
	 * import { Range, SemVer } from "@effected/semver";
	 * import { Effect } from "effect";
	 *
	 * const program = Effect.gen(function* () {
	 *   const strict = yield* Range.parse("^1.2");
	 *   const loose = yield* Range.parse("^1.2", { includePrerelease: true });
	 *   const candidate = yield* SemVer.parse("1.2.5-beta.1");
	 *   return [strict.test(candidate), loose.test(candidate)] as const;
	 * });
	 *
	 * console.log(Effect.runSync(program));
	 * // => [false, true]
	 * ```
	 *
	 * @param input - the range expression to parse
	 * @param options - how the range treats prereleases; see {@link RangeOptions}
	 * @returns the parsed {@link Range}. Fails with {@link InvalidRangeError}.
	 */
	static readonly parse = Effect.fn("Range.parse")((input: string, options?: RangeOptions) =>
		Effect.fromResult(Range.parseResult(input, options)),
	);

	// ── Matching statics (dual) ─────────────────────────────────────────

	/**
	 * Test whether a version satisfies a range; see {@link Range.test} for the
	 * prerelease matching rule. Dual API.
	 *
	 * @remarks
	 * **Data-first order is `(version, range)`** — the version being tested
	 * comes first, the range it is tested against second. The data-last form
	 * takes the range: `Range.satisfies(range)` applied to a version.
	 *
	 * The two parameters are distinct classes and the order is not recoverable
	 * from the call site. TypeScript rejects a flipped call outright, so this
	 * only bites callers without type checking (untyped scripts, REPL probes).
	 * There, `Range.satisfies(range, version)` dispatches data-first, binds the
	 * `Range` to `version`, and dies with
	 * `TypeError: range.test is not a function` — a message that reads as a
	 * defect inside this package rather than a caller error.
	 *
	 * The same order and the same hazard apply to {@link Range.maxSatisfying}
	 * and {@link Range.minSatisfying}: subject first, range second.
	 */
	static readonly satisfies: {
		(range: Range): (version: SemVer) => boolean;
		(version: SemVer, range: Range): boolean;
	} = Fn.dual(2, (version: SemVer, range: Range): boolean => range.test(version));

	/**
	 * Highest satisfying version, or `Option.none()`. Dual API.
	 *
	 * @remarks
	 * Data-first order is `(versions, range)` — see {@link Range.satisfies}
	 * for why the order is spelled out.
	 */
	static readonly maxSatisfying: {
		(range: Range): (versions: ReadonlyArray<SemVer>) => Option.Option<SemVer>;
		(versions: ReadonlyArray<SemVer>, range: Range): Option.Option<SemVer>;
	} = Fn.dual(2, (versions: ReadonlyArray<SemVer>, range: Range): Option.Option<SemVer> => {
		let best: SemVer | undefined;
		for (const v of versions) {
			if (range.test(v) && (best === undefined || v.gt(best))) best = v;
		}
		return best === undefined ? Option.none() : Option.some(best);
	});

	/**
	 * Lowest satisfying version, or `Option.none()`. Dual API.
	 *
	 * @remarks
	 * Data-first order is `(versions, range)` — see {@link Range.satisfies}
	 * for why the order is spelled out.
	 */
	static readonly minSatisfying: {
		(range: Range): (versions: ReadonlyArray<SemVer>) => Option.Option<SemVer>;
		(versions: ReadonlyArray<SemVer>, range: Range): Option.Option<SemVer>;
	} = Fn.dual(2, (versions: ReadonlyArray<SemVer>, range: Range): Option.Option<SemVer> => {
		let best: SemVer | undefined;
		for (const v of versions) {
			if (range.test(v) && (best === undefined || v.lt(best))) best = v;
		}
		return best === undefined ? Option.none() : Option.some(best);
	});

	// ── Algebra statics ─────────────────────────────────────────────────

	/**
	 * Combine two ranges with OR semantics: the union of their comparator
	 * sets. Dual API.
	 *
	 * @remarks
	 * The result matches prereleases the way `self` does: its
	 * `includePrerelease` is `self`'s. Combine ranges parsed with the same
	 * option; a mixed pair has no single matching rule that is right for
	 * both operands' sets.
	 */
	static readonly union: {
		(that: Range): (self: Range) => Range;
		(self: Range, that: Range): Range;
	} = Fn.dual(
		2,
		(self: Range, that: Range): Range =>
			Range.make({ sets: [...self.sets, ...that.sets], includePrerelease: self.includePrerelease }),
	);

	/**
	 * Intersect two ranges via a cross-product of their comparator sets,
	 * keeping only satisfiable combinations, synchronously, returning a
	 * `Result` instead of an `Effect`. Fails with
	 * {@link UnsatisfiableConstraintError} when no satisfiable set remains —
	 * an honest typed failure instead of an unsatisfiable range. Dual API.
	 *
	 * @remarks
	 * {@link Range.intersect} is defined in terms of this function; the two
	 * never diverge. Reach for the `Effect` variant inside Effect code — it
	 * carries the `Range.intersect` tracing span — and for this one at
	 * synchronous boundaries.
	 *
	 * The result's `includePrerelease` is `self`'s, as for {@link Range.union}.
	 *
	 * @example
	 * ```ts
	 * import { Range } from "@effected/semver";
	 * import { Result } from "effect";
	 *
	 * const a = Result.getOrThrow(Range.parseResult("^1.0.0"));
	 * const b = Result.getOrThrow(Range.parseResult(">=1.5.0"));
	 * const merged = Range.intersectResult(a, b);
	 * if (Result.isSuccess(merged)) {
	 *   console.log(merged.success.toString()); // => ">=1.0.0 <2.0.0-0 >=1.5.0"
	 * }
	 * ```
	 */
	static readonly intersectResult: {
		(that: Range): (self: Range) => Result.Result<Range, UnsatisfiableConstraintError>;
		(self: Range, that: Range): Result.Result<Range, UnsatisfiableConstraintError>;
	} = Fn.dual(2, (self: Range, that: Range): Result.Result<Range, UnsatisfiableConstraintError> => {
		const candidates: Array<ComparatorSet> = [];

		for (const setA of self.sets) {
			for (const setB of that.sets) {
				const merged = [...setA, ...setB];
				if (isSetSatisfiable(merged)) {
					candidates.push(merged);
				}
			}
		}

		if (candidates.length === 0) {
			return Result.fail(new UnsatisfiableConstraintError({ constraints: [self, that] }));
		}

		return Result.succeed(Range.make({ sets: candidates, includePrerelease: self.includePrerelease }));
	});

	/**
	 * Intersect two ranges via a cross-product of their comparator sets,
	 * keeping only satisfiable combinations. Fails with
	 * {@link UnsatisfiableConstraintError} when no satisfiable set remains —
	 * an honest typed failure instead of an unsatisfiable range. Dual API.
	 *
	 * Defined in terms of {@link Range.intersectResult} — synchronous callers
	 * can use that variant directly.
	 */
	static readonly intersect: {
		(that: Range): (self: Range) => Effect.Effect<Range, UnsatisfiableConstraintError>;
		(self: Range, that: Range): Effect.Effect<Range, UnsatisfiableConstraintError>;
	} = Fn.dual(
		2,
		Effect.fn("Range.intersect")((self: Range, that: Range) => Effect.fromResult(Range.intersectResult(self, that))),
	);

	/**
	 * Check whether every version matched by `sub` is also matched by `sup`.
	 * Dual API. A comparator set that matches nothing (`>*`, `<*`, or any
	 * contradictory set) is a subset of every range.
	 *
	 * @remarks
	 * This check is a conservative approximation: it may return `false` for
	 * ranges that are technically subsets when the sub-range straddles
	 * comparator-set boundaries in the sup-range. For example,
	 * `>=1.0.0 <3.0.0` is a subset of `>=1.0.0 <2.0.0 || >=2.0.0 <3.0.0`,
	 * but `isSubset` returns `false` because no single sup-set fully implies
	 * the sub-set. This is a known limitation; false negatives are safe
	 * (they prevent incorrect simplification).
	 *
	 * A range parsed with `includePrerelease` is never a subset of one parsed
	 * without it: it may match prereleases the other's tuple rule rejects.
	 * The other direction compares comparator sets as usual.
	 */
	static readonly isSubset: {
		(sup: Range): (sub: Range) => boolean;
		(sub: Range, sup: Range): boolean;
	} = Fn.dual(2, (sub: Range, sup: Range): boolean => {
		if (sub.includePrerelease && !sup.includePrerelease) return false;
		for (const subSet of sub.sets) {
			const contained = sup.sets.some((supSet) => isComparatorSetSubset(subSet, supSet));
			if (!contained) return false;
		}
		return true;
	});

	/**
	 * Test whether two ranges are semantically equivalent: each is a
	 * {@link Range.isSubset | subset} of the other. Dual API.
	 */
	static readonly equivalent: {
		(that: Range): (self: Range) => boolean;
		(self: Range, that: Range): boolean;
	} = Fn.dual(2, (self: Range, that: Range): boolean => Range.isSubset(self, that) && Range.isSubset(that, self));

	/**
	 * Remove redundant comparator sets: a set is redundant when it is a
	 * subset of another set in the range (every version it matches already
	 * matches that broader set, so the union gains nothing by keeping it).
	 *
	 * @remarks
	 * Sets that are subsets of each other (duplicates, or two spellings of
	 * one set) keep their FIRST occurrence: dropping every member of such a
	 * group would lose the versions they match, so `^1 || ^1 || ^2` keeps
	 * `^1`. A set that matches nothing is a subset of every set, so it is
	 * dropped when another set remains: `>* || ^1.0.0` simplifies to
	 * `>=1.0.0 <2.0.0-0`, while `>* || <*` keeps one match-nothing set.
	 */
	static simplify(range: Range): Range {
		const sets = range.sets.filter((set, i) => {
			return !range.sets.some(
				(other, j) => i !== j && isComparatorSetSubset(set, other) && (j < i || !isComparatorSetSubset(other, set)),
			);
		});

		if (sets.length === 0) return range;
		return Range.make({ sets, includePrerelease: range.includePrerelease });
	}

	// ── Instance ────────────────────────────────────────────────────────

	/**
	 * Test whether a version satisfies this range.
	 *
	 * @remarks
	 * Matches node-semver's prerelease restriction: a prerelease version only
	 * satisfies the range when at least one comparator in the matching set
	 * carries a prerelease on the same `major.minor.patch` tuple. This keeps
	 * `^1.2.3` from unexpectedly matching `1.2.4-alpha`. A range parsed with
	 * {@link RangeOptions.includePrerelease} drops that rule and matches a
	 * prerelease wherever its bounds contain one.
	 */
	test(version: SemVer): boolean {
		return this.sets.some((set) => satisfiesSet(version, set, this.includePrerelease));
	}

	/** Filter versions that satisfy this range, preserving order. */
	filter(versions: ReadonlyArray<SemVer>): ReadonlyArray<SemVer> {
		return versions.filter((v) => this.test(v));
	}

	/** The range expression string, `a b || c d`. */
	override toString(): string {
		return formatRange(this.sets);
	}

	/** @internal */
	[Symbol.for("nodejs.util.inspect.custom")](): string {
		return this.toString();
	}
}

/**
 * Indicates that intersecting ranges produced no satisfiable comparator set.
 *
 * Raised by {@link Range.intersect} when the constraints are mutually
 * exclusive. Carries the conflicting ranges.
 *
 * @public
 */
export class UnsatisfiableConstraintError extends Schema.TaggedError<UnsatisfiableConstraintError>()(
	"UnsatisfiableConstraintError",
	{
		/** The ranges whose intersection is empty. */
		constraints: Schema.Array(Range),
	},
) {
	override get message(): string {
		const count = this.constraints.length;
		return `No version satisfies all ${count} constraint${count === 1 ? "" : "s"}`;
	}
}

// ── Matching internals ───────────────────────────────────────────────────

// Prerelease tuple restriction (node-semver semantics): a prerelease version
// only matches a set when some comparator in the set carries a prerelease on
// the same major.minor.patch tuple — unless the range includes prereleases,
// in which case the bounds alone decide.
const satisfiesSet = (version: SemVer, set: ComparatorSet, includePrerelease: boolean): boolean => {
	if (set.length === 0) return true;

	if (!includePrerelease && version.prerelease.length > 0) {
		const hasTupleMatch = set.some(
			(c) =>
				c.version.prerelease.length > 0 &&
				c.version.major === version.major &&
				c.version.minor === version.minor &&
				c.version.patch === version.patch,
		);
		if (!hasTupleMatch) return false;
	}

	return set.every((c) => c.test(version));
};

// ── Algebra internals ────────────────────────────────────────────────────

// `0.0.0-0`: major, minor and patch at zero with the single lowest prerelease
// identifier — the minimum of SemVer 2.0.0 precedence.
const isLowestVersion = (v: SemVer): boolean =>
	v.major === 0 && v.minor === 0 && v.patch === 0 && v.prerelease.length === 1 && v.prerelease[0] === 0;

const isSetSatisfiable = (set: ComparatorSet): boolean => {
	const lowers: Array<Comparator> = [];
	const uppers: Array<Comparator> = [];
	const equals: Array<Comparator> = [];

	for (const c of set) {
		// `<0.0.0-0` admits nothing: no version sorts below the lowest one
		// SemVer can express. `>*` and `<*` desugar to exactly this.
		if (c.operator === "<" && isLowestVersion(c.version)) return false;
		if (c.operator === "=") equals.push(c);
		else if (c.operator === ">" || c.operator === ">=") lowers.push(c);
		else uppers.push(c);
	}

	for (const eq of equals) {
		for (const c of set) {
			if (c === eq) continue;
			const cmp = eq.version.compare(c.version);
			switch (c.operator) {
				case ">":
					if (cmp <= 0) return false;
					break;
				case ">=":
					if (cmp < 0) return false;
					break;
				case "<":
					if (cmp >= 0) return false;
					break;
				case "<=":
					if (cmp > 0) return false;
					break;
				case "=":
					if (cmp !== 0) return false;
					break;
			}
		}
	}

	for (const lo of lowers) {
		for (const hi of uppers) {
			const cmp = lo.version.compare(hi.version);
			if (lo.operator === ">=" && hi.operator === "<") {
				if (cmp >= 0) return false;
			} else if (lo.operator === ">=" && hi.operator === "<=") {
				if (cmp > 0) return false;
			} else if (lo.operator === ">" && hi.operator === "<") {
				if (cmp >= 0) return false;
			} else if (lo.operator === ">" && hi.operator === "<=") {
				if (cmp >= 0) return false;
			}
		}
	}

	return true;
};

const isComparatorImplied = (set: ComparatorSet, comp: Comparator): boolean => {
	for (const s of set) {
		const cmp = s.version.compare(comp.version);
		switch (comp.operator) {
			case ">=":
				if ((s.operator === ">=" && cmp >= 0) || (s.operator === ">" && cmp >= 0)) return true;
				if (s.operator === "=" && cmp >= 0) return true;
				break;
			case ">":
				if (s.operator === ">" && cmp >= 0) return true;
				if (s.operator === ">=" && cmp > 0) return true;
				if (s.operator === "=" && cmp > 0) return true;
				break;
			case "<=":
				if ((s.operator === "<=" && cmp <= 0) || (s.operator === "<" && cmp <= 0)) return true;
				if (s.operator === "=" && cmp <= 0) return true;
				break;
			case "<":
				if (s.operator === "<" && cmp <= 0) return true;
				if (s.operator === "<=" && cmp < 0) return true;
				if (s.operator === "=" && cmp < 0) return true;
				break;
			case "=":
				if (s.operator === "=" && cmp === 0) return true;
				break;
		}
	}
	return false;
};

const isComparatorSetSubset = (sub: ComparatorSet, sup: ComparatorSet): boolean => {
	// An unsatisfiable set matches no version, so it is a subset of anything.
	if (!isSetSatisfiable(sub)) return true;
	for (const supComp of sup) {
		if (!isComparatorImplied(sub, supComp)) return false;
	}
	return true;
};
