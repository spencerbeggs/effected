// Ported from minimatch@10.2.5 (https://github.com/isaacs/minimatch)
// Copyright: Isaac Z. Schlueter and Contributors
// License: BlueOak-1.0.0 (https://blueoakcouncil.org/license/1.0.0)
// Port notes: verbatim except the options type now comes from the extracted
// types leaf. Takes minimatch 11.0.8's leading `#` and `!` rule.

import type { EngineOptions } from "./types.js";

/**
 * Escape all magic characters in a glob pattern.
 *
 * If the `windowsPathsNoEscape` option is used, then characters are escaped
 * by wrapping in `[]`, because a magic character wrapped in a character class
 * can only be satisfied by that exact character. In this mode, `\` is _not_
 * escaped, because it is not interpreted as a magic character, but instead as
 * a path separator.
 *
 * If the `magicalBraces` option is used, then braces (`{` and `}`) will be
 * escaped.
 *
 * A leading `#` or `!` is escaped as well, so that the result is never a
 * comment or a negated pattern. In `windowsPathsNoEscape` mode, a leading
 * `!` is written as `@(!)`, because `[!` starts a negated class.
 */
const escapePattern = (
	s: string,
	{
		windowsPathsNoEscape = false,
		magicalBraces = false,
	}: Pick<EngineOptions, "windowsPathsNoEscape" | "magicalBraces"> = {},
): string => {
	// don't need to escape +@! because we escape the parens
	// that make those magic, and escaping ! as [!] isn't valid,
	// because [!]] is a valid glob class meaning not ']'.
	// However, at the start of the pattern, '!' negates the pattern and
	// '#' makes it a comment, so the first character is handled below.
	const e = magicalBraces
		? windowsPathsNoEscape
			? s.replace(/[?*()[\]{}]/g, "[$&]")
			: s.replace(/[?*()[\]\\{}]/g, "\\$&")
		: windowsPathsNoEscape
			? s.replace(/[?*()[\]]/g, "[$&]")
			: s.replace(/[?*()[\]\\]/g, "\\$&");
	const c = e.charAt(0);
	if (c === "#") {
		return (windowsPathsNoEscape ? "[#]" : "\\#") + e.slice(1);
	}
	if (c === "!") {
		// '[!]' can not be used, because '[!' starts a negated class, and
		// '\' is a path separator in windowsPathsNoEscape mode. '@(!)'
		// matches only '!'. If extglobs are disabled with `noext`, it
		// matches nothing, rather than everything.
		return (windowsPathsNoEscape ? "@(!)" : "\\!") + e.slice(1);
	}
	return e;
};

// Exported under the upstream name; the internal binding avoids shadowing the
// deprecated global escape().
export { escapePattern as escape };
