// The zero-dependency leaf every guard imports — no import cycle is possible
// through here (jsonc/yaml precedent).

/** Hard cap on pattern length. Upstream minimatch's MAX_PATTERN_LENGTH (64KB). */
export const MAX_PATTERN_LENGTH = 1024 * 64;

/** Default brace-expansion output budget. Upstream brace-expansion's EXPANSION_MAX. */
export const EXPANSION_MAX = 100_000;

/**
 * Bound on the path portions the optimizationLevel 2 `**` + `..` split may add
 * across all the rows it copies. Upstream minimatch 11's maxSplitCells.
 */
export const MAX_SPLIT_CELLS = 1_000_000;

/**
 * Bound on the characters one brace expansion may hold: its results, and the
 * alternatives of a comma set before they are combined. The count budget alone
 * let a short pattern build very long results (CVE-2026-14257). Upstream
 * brace-expansion's EXPANSION_MAX_LENGTH; there it truncates, here it fails
 * typed.
 */
export const EXPANSION_MAX_LENGTH = 4_000_000;

/**
 * Bound on the restarts of the `{a},b}` rewrite in one expansion. Each restart
 * reads the whole string again, so the rewrite is quadratic in the trailing
 * braces. Upstream brace-expansion's EXPANSION_MAX_REWRITES: past it the rest
 * of the string stays literal, as upstream leaves it.
 */
export const EXPANSION_MAX_REWRITES = 1_000;

/** Default bound on non-adjacent globstar backtracking. Upstream minimatch. */
export const MAX_GLOBSTAR_RECURSION = 200;

/**
 * Ceiling on a caller-raised maxGlobstarRecursion. The body-section walk
 * recurses once per `**` section it descends, so the cap is a stack depth. On
 * Node 26's default stack the walk first overflowed at about 3,250 sections
 * with nothing else on the stack, 2,100 with 5,000 frames of the caller's own
 * recursion beneath it, and 1,600 under `--stack-size=500` (half the default).
 * A walk at 1,000 uses under a third of the default stack and about 62% of the
 * halved one, so it leaves a margin in every measured case.
 * GlobPattern.matches still absorbs an overflow as the cap's false negative,
 * for callers whose stack is deeper or smaller than measured.
 */
export const MAX_GLOBSTAR_RECURSION_CEILING = 1000;

/** Default extglob parse depth; over-nesting degrades to literal. Upstream minimatch. */
export const MAX_EXTGLOB_RECURSION = 2;

/** House parity constant for the NEW depth guards (yaml/jsonc precedent). */
export const MAX_NESTING_DEPTH = 256;

/** The reasons a compile-time guard can trip; mirrors GlobPatternError's reason union. */
export type GuardReason =
	| "PatternTooLong"
	| "ExpansionBudgetExceeded"
	| "NestingDepthExceeded"
	| "InvalidRegExp"
	| "CompileBudgetExceeded";

/**
 * The work one compile may do: the regexps it builds and the matcher graphs.
 * A regexp costs its source length (about four bytes of compiled code each),
 * plus
 * REGEXP_PROPERTY_WEIGHT for each `\p{...}` or `\P{...}` escape (a POSIX class
 * turns into one or two of them, and V8 expands each into its full Unicode
 * set: measured about 10 KB and 300 us to build, against about 4 bytes and
 * 0.23 us for a literal character). A brace expansion multiplies the portions
 * that need a regexp, so `[[:alpha:]]{0..99}{0..99}{0..9}` (100,000
 * alternatives, each with its own class regexp) ran the process out of memory
 * at about 1 GB. A matcher graph costs GRAPH_ITEM_WEIGHT per item, before it
 * is built: a numeric range kept whole is 684 items for the widest ends, and
 * brace alternatives around it give each alternative its own copy, so `{$,a}`
 * and a range twelve times over built 4,096 graphs of 8,200 items, 4.2 GB. Past the budget the compile fails typed, before
 * the regexp or graph that would pass it is built. 8,000,000 units is about
 * 4,000 property escapes (about 1.5 s and 40 MB), 8,000,000 literal
 * characters, or 2,000,000 graph items (about 100 MB).
 */
export const MAX_REGEXP_WORK = 8_000_000;

/** The work units one `\p{...}` property escape counts for. */
export const REGEXP_PROPERTY_WEIGHT = 2048;

/**
 * The work units one matcher graph item counts for: a built item holds about
 * 50 bytes (`{$,a}` and a widest range nine times over, 512 graphs of 6,700
 * items, kept 181 MB), so the budget holds about 2,000,000 items.
 */
export const GRAPH_ITEM_WEIGHT = 4;

/**
 * Raw compile-time guard-trip signal. The engine throws it; ONLY the facade
 * (GlobPattern.compile / the schema check) catches it and materializes the
 * typed GlobPatternError. Match-time code paths never throw it — matches() is
 * total.
 */
export class GuardExceeded extends Error {
	readonly _tag = "GuardExceeded";
	constructor(
		readonly reason: GuardReason,
		readonly limit: number,
		readonly actual: number,
	) {
		super(`${reason}: limit ${limit}, actual ${actual}`);
	}
}

export const isGuardExceeded = (u: unknown): u is GuardExceeded => u instanceof GuardExceeded;

/**
 * Internal caps are programmer-supplied. A NaN or non-integer reaching a guard
 * can only come from code, is a wiring bug, and dies as a defect (walker
 * maxDepth rule) — it must never be coerced or clamped.
 */
export const assertCap = (name: string, value: number): number => {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError(`@effected/glob internal cap ${name} must be a positive integer, received ${value}`);
	}
	return value;
};
