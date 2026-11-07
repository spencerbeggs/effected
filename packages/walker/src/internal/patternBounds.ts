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
 */
export const skipsHiddenDirectories = (pattern: GlobPattern): boolean => {
	if (pattern.negated) return false;
	let source = pattern.source;
	const trailing = source.endsWith("/");
	if (trailing) source = source.slice(0, -1);
	if (source === "" || UNMODELLED.test(source)) return false;
	const segments = source.split("/");
	let wildcardLed = false;
	for (const segment of segments) {
		if (segment === "") return false;
		// `.` and `..` name the walk's own directories, never a hidden one.
		if (segment === "." || segment === "..") continue;
		// A segment that starts with a literal dot names a hidden entry.
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
