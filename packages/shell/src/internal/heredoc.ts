// Heredoc delimiters and bodies, shared by the top-level lexer and the nested
// scanner so the two can never disagree about where a body ends.

import { decodeAnsiC } from "./ansiC.js";
import { skipContinuations } from "./raw.js";

/** @internal */
export interface HeredocDelimiter {
	/** The delimiter after quote removal. */
	readonly delimiter: string;
	/** Whether any part of the delimiter word was quoted or escaped. */
	readonly quoted: boolean;
	/** Offset just past the delimiter word, or the opener when `opaque`. */
	readonly end: number;
	/**
	 * Whether the word holds a `$(`, `$((`, `$[`, `${`, backtick, `<(` or `>(`.
	 * The delimiter cannot be known: bash reads such a word as a matched pair,
	 * and rebuilds a `$( … )` from its parse, so `<<$(  true  )` ends at the line
	 * `$(true)`. The caller reads no body, which can only over-report.
	 */
	readonly opaque: boolean;
}

/** @internal */
export interface HeredocBody {
	readonly start: number;
	readonly end: number;
	readonly terminated: boolean;
}

/**
 * Whether `source[i]` ends an unquoted word: a blank, a line break or a shell
 * metacharacter. A `\r` ends a word only as the first half of `\r\n`.
 *
 * @internal
 */
export const endsWord = (source: string, i: number): boolean => {
	const c = source[i];
	switch (c) {
		case " ":
		case "\t":
		case "\n":
		case ";":
		case "&":
		case "|":
		case "(":
		case ")":
		case "<":
		case ">":
			return true;
		case "\r":
			return source[i + 1] === "\n";
		default:
			return false;
	}
};

/**
 * Read the delimiter word after `<<` / `<<-` (blanks already skipped).
 *
 * @remarks
 * No expansion is performed on the word, matching bash: the delimiter is the
 * word after quote removal, and quoting any part of it makes the body
 * literal. A backslash-newline is removed, not quoted, outside single quotes.
 * Returns `undefined` when no word starts at `i`. It never scans a nested
 * body: a word holding an opener stops there, `opaque`.
 *
 * @internal
 */
export const readHeredocDelimiter = (source: string, i: number, limit: number): HeredocDelimiter | undefined => {
	let delimiter = "";
	let quoted = false;
	let j = skipContinuations(source, i, limit);
	const opaque = (): HeredocDelimiter => ({ delimiter, quoted, end: j, opaque: true });
	const opensProcess = (at: number): boolean => {
		const c = source[at];
		if (c !== "<" && c !== ">") return false;
		const open = skipContinuations(source, at + 1, limit);
		return open < limit && source[open] === "(";
	};
	const opensDollar = (at: number): boolean => {
		const open = skipContinuations(source, at + 1, limit);
		if (open >= limit) return false;
		const c = source[open];
		return c === "(" || c === "{" || c === "[";
	};
	while (j < limit && !endsWord(source, j)) {
		const c = source[j] as string;
		if (c === "`" || (c === "$" && opensDollar(j))) return opaque();
		if (c === "$") {
			const open = skipContinuations(source, j + 1, limit);
			if (open < limit && source[open] === "'") {
				// `$'…'` is the decoded text, quoted.
				quoted = true;
				let close = open + 1;
				while (close < limit && source[close] !== "'") close += source[close] === "\\" ? 2 : 1;
				const stop = Math.min(close, limit);
				delimiter += decodeAnsiC(source, open + 1, stop).value;
				j = stop === limit ? limit : stop + 1;
				continue;
			}
			if (open < limit && source[open] === '"') {
				// `$"…"` is the double-quoted text.
				j = open;
				continue;
			}
		}
		if (c === "'") {
			quoted = true;
			const close = source.indexOf("'", j + 1);
			const stop = close === -1 || close >= limit ? limit : close;
			delimiter += source.slice(j + 1, stop);
			j = stop === limit ? limit : stop + 1;
			continue;
		}
		if (c === '"') {
			quoted = true;
			j += 1;
			while (j < limit && source[j] !== '"') {
				const d = source[j] as string;
				const next = source[j + 1];
				if (d === "`" || (d === "$" && opensDollar(j))) return opaque();
				if (d === "\\" && j + 1 < limit && next === "\n") {
					j += 2;
					continue;
				}
				if (d === "\\" && j + 1 < limit && (next === '"' || next === "\\" || next === "$" || next === "`")) {
					delimiter += next;
					j += 2;
					continue;
				}
				delimiter += d;
				j += 1;
			}
			if (j < limit) j += 1;
			continue;
		}
		if (c === "\\") {
			if (source[j + 1] === "\n" && j + 1 < limit) {
				j += 2;
				continue;
			}
			quoted = true;
			if (j + 1 < limit) delimiter += source[j + 1];
			j += 2;
			continue;
		}
		delimiter += c;
		j += 1;
	}
	if (j < limit && opensProcess(j)) return opaque();
	if (delimiter === "" && !quoted) return undefined;
	return { delimiter, quoted, end: Math.min(j, limit), opaque: false };
};

const stripLeadingTabs = (line: string): string => {
	let k = 0;
	while (k < line.length && line.charCodeAt(k) === 9) k += 1;
	return k === 0 ? line : line.slice(k);
};

/**
 * Whether the line ending just before `lineEnd` ends in an odd run of
 * backslashes, so its newline is a continuation.
 */
const endsInContinuation = (source: string, lineStart: number, lineEnd: number): boolean => {
	let count = 0;
	for (let k = lineEnd - 1; k >= lineStart && source[k] === "\\"; k -= 1) count += 1;
	return count % 2 === 1;
};

/**
 * Consume the bodies of the pending heredocs, in order, starting at `p` (the
 * offset just after the newline that ended their command line).
 *
 * @remarks
 * Each body runs to the first line equal to its delimiter; for `<<-`, leading
 * tabs are stripped from the line before comparing. A trailing `\r` is
 * stripped too, so a CRLF delimiter line ends the body. Under an unquoted
 * delimiter a backslash-newline joins two lines before the comparison, as
 * bash's `read_secondary_line` does, so `E\⏎ND` ends a `<<END` body; under a
 * quoted one it does not. A body with no delimiter line runs to `limit`,
 * unterminated. Linear: every line is visited once.
 *
 * @internal
 */
export const consumeHeredocBodies = (
	source: string,
	p: number,
	limit: number,
	pending: ReadonlyArray<{ readonly delimiter: string; readonly stripTabs: boolean; readonly quoted: boolean }>,
): { readonly next: number; readonly bodies: ReadonlyArray<HeredocBody> } => {
	const bodies: Array<HeredocBody> = [];
	let position = p;
	for (const { delimiter, stripTabs, quoted } of pending) {
		const bodyStart = position;
		let lineStart = position;
		let found = false;
		while (lineStart < limit) {
			let newline = source.indexOf("\n", lineStart);
			let lineEnd = newline === -1 || newline >= limit ? limit : newline;
			let line = source.slice(lineStart, lineEnd);
			// Join a line that ends in a continuation, unless the body is literal.
			if (!quoted && lineEnd < limit && endsInContinuation(source, lineStart, lineEnd)) {
				const pieces: Array<string> = [];
				let physicalStart = lineStart;
				while (lineEnd < limit && endsInContinuation(source, physicalStart, lineEnd)) {
					pieces.push(source.slice(physicalStart, lineEnd - 1));
					physicalStart = lineEnd + 1;
					newline = source.indexOf("\n", physicalStart);
					lineEnd = newline === -1 || newline >= limit ? limit : newline;
				}
				pieces.push(source.slice(physicalStart, lineEnd));
				line = pieces.join("");
			}
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (stripTabs) line = stripLeadingTabs(line);
			if (line === delimiter) {
				bodies.push({ start: bodyStart, end: lineStart, terminated: true });
				position = lineEnd === limit ? limit : lineEnd + 1;
				found = true;
				break;
			}
			lineStart = lineEnd === limit ? limit : lineEnd + 1;
		}
		if (!found) {
			bodies.push({ start: bodyStart, end: limit, terminated: false });
			position = limit;
		}
	}
	return { next: position, bodies };
};
