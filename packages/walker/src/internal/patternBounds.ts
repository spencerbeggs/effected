// How far down a pattern can reach, and whether it can reach into a hidden
// directory — the two bounds the downward walk uses to decide which
// directories are worth READING. Neither changes what matches: a directory the
// bounds rule out can hold no match, so skipping it only saves reads (and the
// failures an unreadable one would raise).
//
// `@effected/glob` exposes neither the compiled segments nor the `dot` option,
// so both bounds are computed from what it does expose: the pattern source and
// `matches`. Each errs towards reading: an answer this module cannot prove is
// "no bound".

import type { GlobPattern } from "@effected/glob";

/**
 * An upper bound on the number of path segments any match of `pattern` has,
 * or `undefined` when matches can lie at any depth (a globstar, or a negated
 * pattern, whose matches land anywhere).
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
	if (pattern.negated) return undefined;
	let source = pattern.source;
	if (source.includes("**")) return undefined;
	while (source.startsWith("./")) source = source.slice(2);
	if (source.endsWith("/") && !source.endsWith("\\/")) source = source.slice(0, -1);
	let separators = 0;
	for (const character of source) if (character === "/" || character === "\\") separators += 1;
	return separators + 1;
};

/** Characters whose glob meaning the probe below does not model: classes, braces, extglobs, escapes, a comment. */
const UNMODELLED = /[[\]{}()!+@\\#]/;

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
 * Nor is any pattern `matchBase` could apply to. Under `matchBase` a compiled
 * row with ONE segment matches a path by its basename, so `**` matches
 * `.a/f.js` even with `dot` off. The probe cannot see `matchBase`, because
 * glob does not expose it and the probe's hidden candidate fails either way.
 * A slash-less pattern compiles to one segment, so it is never pruned. A
 * pattern with a slash can collapse to one too: at the default optimization
 * level glob pops `<p>/..`, so `x/../**` compiles to the row `**`. A `..`
 * segment therefore refuses to prune. glob also merges a run of adjacent
 * globstars at every optimization level, and at level 2 drops a middle `.`
 * first, so two or three globstar segments in a row, or (at level 2) a
 * globstar, a `.` and a globstar, compile to the one row `**` (the sources
 * are spelled out in the tests; a comment cannot hold them). A pattern whose
 * every segment is a globstar or a `.` therefore refuses to prune, with one
 * deliberate exception: a FIRST segment of `.`. glob keeps a leading (and a
 * trailing) `.`, so `./**` stays the two-segment row `.`, `**`, `matchBase`
 * does not apply, and `./**` keeps its pruning. `./.` collapsing to `.`
 * names no entry a walk returns. `__test__/PatternBoundsSweep.test.ts`
 * compiles every pattern of up to three segments over a fixed alphabet,
 * under every optimization level, `matchBase` and `noglobstar`, and pins
 * that nothing this bound prunes matches a path inside a hidden directory;
 * a new collapse route in glob fails there. A slash-less pattern without a
 * globstar never reads a subdirectory anyway, so these refusals cost only
 * the hidden-directory reads of a bare `**` and of globstar-only runs.
 */
export const skipsHiddenDirectories = (pattern: GlobPattern): boolean => {
	if (pattern.negated) return false;
	let source = pattern.source;
	const trailing = source.endsWith("/");
	if (trailing) source = source.slice(0, -1);
	if (source === "" || !source.includes("/") || UNMODELLED.test(source)) return false;
	const segments = source.split("/");
	let wildcardLed = false;
	for (const segment of segments) {
		if (segment === "") return false;
		// glob collapses `<p>/..`, which can leave a one-segment row that `matchBase` matches by basename.
		if (segment === "..") return false;
		// `.` names the walk's own directory, never a hidden one.
		if (segment === ".") continue;
		// A segment that starts with a literal dot names a hidden entry.
		if (segment.startsWith(".")) return false;
		if (segment.startsWith("?")) return false;
		if (segment.startsWith("*")) wildcardLed = true;
	}
	// glob merges adjacent globstars (and, at level 2, drops a middle `.`), so a row made only of globstars and `.`
	// can collapse to the one segment `**` that `matchBase` matches by basename. A leading `.` is kept, so `./**` is not.
	if (segments[0] !== "." && segments.every((segment) => segment === "**" || segment === ".")) return false;
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
