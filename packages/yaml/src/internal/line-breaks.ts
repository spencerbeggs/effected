// Line-break normalization at the engine boundary.
//
// YAML 1.2 §5.4 makes `b-break` three spellings: `\r\n`, `\r` and `\n`. The
// vendored engine was written against `\n` and `\r\n` and read a bare `\r`
// as ordinary content almost everywhere: `"- x\r- y"` composed to one plain
// scalar and `"a: 1\r..."` to `{ a: "1 ..." }`. Rather than teach every scan
// in the lexer, CST parser and composer a third spelling, each engine entry
// point maps a bare `\r` to `\n` before it scans. The mapping is one code
// unit for one code unit, so every offset, length and column the engine
// reports is unchanged, and `\r\n` is left alone (the engine already treats
// it exactly as `\n`). Content is unaffected too: §5.4 normalizes every line
// break inside a scalar to `\n` anyway.
//
// Anything that hands SOURCE TEXT back to a caller (token `text`, verbatim
// regions of formatted output) slices the caller's original string, never
// this normalized one, so byte fidelity is kept.

const BARE_CR = /\r(?!\n)/g;

/**
 * `text` with every bare `\r` (one not followed by `\n`) replaced by `\n`.
 * Returns `text` itself when it holds no `\r`, so the common case allocates
 * nothing and reference-keyed caches downstream keep hitting.
 *
 * @internal
 */
export const normalizeLineBreaks = (text: string): string =>
	text.indexOf("\r") === -1 ? text : text.replace(BARE_CR, "\n");
