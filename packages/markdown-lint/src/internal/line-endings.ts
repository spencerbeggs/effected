// markdownlint's line breaks: the pattern it splits a file's lines on, and the
// line ending it writes when it fixes a file, shared by the fix policy and the
// rules whose fixes insert line breaks.

/**
 * markdownlint's line break, `\r\n?|\n`: a `\r\n`, a bare `\r` or a `\n`,
 * the split `PositionMapping`'s line index makes too. Global, for `matchAll`
 * and `replace`; `split` and `search` ignore the flag. Never `test` or `exec`
 * with it: they would carry `lastIndex` between calls.
 * @internal
 */
export const LINE_BREAK = /\r\n?|\n/g;

/**
 * The line ending markdownlint's `applyFixes` writes an inserted `\n` as: the
 * source's most common one, LF winning a tie, then CRLF; `\n` when the source
 * has none (markdownlint takes the platform's there).
 * @internal
 */
export const preferredLineEnding = (source: string): string => {
	let cr = 0;
	let lf = 0;
	let crlf = 0;
	for (const match of source.matchAll(LINE_BREAK)) {
		if (match[0] === "\r") cr++;
		else if (match[0] === "\n") lf++;
		else crlf++;
	}
	if (cr === 0 && lf === 0 && crlf === 0) return "\n";
	if (lf >= crlf && lf >= cr) return "\n";
	return crlf >= cr ? "\r\n" : "\r";
};
