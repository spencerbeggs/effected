// How far down a pattern can reach, and whether it can reach into a hidden
// directory — the two bounds the downward walk uses to decide which
// directories are worth READING. Neither changes what matches: a directory the
// bounds rule out can hold no match, so skipping it only saves reads (and the
// failures an unreadable one would raise).
//
// `@effected/glob` exposes neither the compiled segments nor the `dot` option,
// so both bounds are computed from what it does expose: the pattern source,
// `matches`, and `matchesByBasename`. Each errs towards reading: an answer this
// module cannot prove is "no bound".

import type { GlobPattern } from "@effected/glob";

/** Characters whose glob meaning the probe below does not model: classes, braces, extglobs, escapes, a comment. */
const UNMODELLED = /[[\]{}()!+@\\#]/;

/** The source with one trailing `/` (the directory-only form, which adds no segment) removed. */
const withoutTrailingSlash = (source: string): string =>
	source.endsWith("/") && !source.endsWith("\\/") ? source.slice(0, -1) : source;

/**
 * Whether some alternative of `pattern` matches a path by its basename, at
 * any depth below the walk base, so neither a literal stat nor a depth or
 * hidden-directory bound holds. glob answers it from the compiled
 * alternatives (`matchBase` on and an alternative of one path portion), so
 * it is exact however the source is spelled: `x/../*.js` counts, and
 * `src/[ab]/*.ts` does not.
 */
export const matchesByBasename = (pattern: GlobPattern): boolean => pattern.matchesByBasename;

/**
 * An upper bound on the number of path segments any match of `pattern` has,
 * or `undefined` when matches can lie at any depth (a globstar, a negated
 * pattern, whose matches land anywhere, or a pattern `matchBase` matches by
 * basename: {@link matchesByBasename}).
 *
 * A glob segment never matches across a `/` — only a globstar does — and
 * brace expansion only ever selects characters of the source, so the
 * separators in the source bound the separators of every alternative. A
 * backslash counts as one too, because under `windowsPathsNoEscape` it is one;
 * escapes only make the bound looser. A trailing `/` (the directory-only form)
 * adds no segment, and a leading `./`, which every alternative shares, names
 * no directory of the walk. Any `**` — even one that is not a whole segment,
 * or one `noglobstar` reads as `*` — means no bound.
 */
export const segmentBound = (pattern: GlobPattern): number | undefined => {
	if (pattern.negated || matchesByBasename(pattern)) return undefined;
	let source = pattern.source;
	if (source.includes("**")) return undefined;
	while (source.startsWith("./")) source = source.slice(2);
	source = withoutTrailingSlash(source);
	let separators = 0;
	for (const character of source) if (character === "/" || character === "\\") separators += 1;
	return separators + 1;
};

/**
 * Whether no match of `pattern` can lie inside a hidden directory (one whose
 * name starts with `.`), so the walk need never read one.
 *
 * Under `dot: false` a wildcard never matches a leading `.` and a globstar
 * never crosses a hidden segment, so only a segment that itself starts with a
 * literal `.` can name a hidden directory. Under `dot: true` wildcards do. The
 * compiled pattern does not say which it was compiled with, so a differential
 * probe asks it: two candidates built from the pattern, identical except that
 * the second turns its leading wildcards into hidden names. When the first
 * matches and the second does not, the pattern is `dot: false`. A pattern
 * whose syntax the probe does not model (classes, braces, extglobs, escapes,
 * a leading `?`, empty segments, negation) is never pruned.
 *
 * Nor is any pattern that matches by basename ({@link matchesByBasename}):
 * under `matchBase` a one-portion alternative matches a path by its basename,
 * so `**` matches `.a/f.js` even with `dot` off, and the probe cannot see
 * that, because its hidden candidate fails either way. glob answers that
 * exactly, so only such a pattern pays: without `matchBase`, or when every
 * alternative has more than one portion, `matchBase` changes no answer and a
 * bare `**` prunes like any other. `__test__/PatternBoundsSweep.test.ts`
 * compiles every pattern of up to three segments over a fixed alphabet,
 * under every optimization level, `matchBase` and `noglobstar`, and pins
 * that nothing this bound prunes matches a path inside a hidden directory.
 */
export const skipsHiddenDirectories = (pattern: GlobPattern): boolean => {
	if (pattern.negated || matchesByBasename(pattern)) return false;
	let source = pattern.source;
	const trailing = source.endsWith("/");
	if (trailing) source = source.slice(0, -1);
	if (source === "" || UNMODELLED.test(source)) return false;
	const segments = source.split("/");
	let wildcardLed = false;
	for (const segment of segments) {
		if (segment === "") return false;
		// `.` names the walk's own directory, never a hidden one.
		if (segment === ".") continue;
		// A segment that starts with a literal dot names a hidden entry (`..` included).
		if (segment.startsWith(".")) return false;
		if (segment.startsWith("?")) return false;
		if (segment.startsWith("*")) wildcardLed = true;
	}
	// Every segment starts with a literal other than `.`: none can match a hidden name, whatever `dot` is.
	if (!wildcardLed) return true;
	const spell = (hidden: boolean): string =>
		segments
			.map((segment) => {
				const rest = (text: string): string => text.replace(/\*+/g, "x").replace(/\?/g, "x");
				if (!segment.startsWith("*")) return rest(segment);
				return (hidden ? ".x" : "x") + rest(segment.replace(/^\*+/, ""));
			})
			.join("/") + (trailing ? "/" : "");
	return pattern.matches(spell(false)) && !pattern.matches(spell(true));
};
