// Reads a file's text the way markdownlint does: its lines, its front matter
// and its masked comments, before anything is parsed. The comment mask and the
// front matter count are two linear scans mirroring markdownlint's own helpers
// (`clearHtmlCommentText`, `frontMatterRe` with `removeFrontMatter`) without
// its backtracking front-matter regular expression, which upstream only
// tolerates by running it under re2.

import { LINE_BREAK } from "./line-endings.js";

const commentOpen = "<!--";
const commentClose = "-->";

// markdownlint's `notSpaceCrLfRe`: everything but space, CR and LF is hidden.
const maskBody = (content: string): string => {
	const out: Array<string> = [];
	for (let index = 0; index < content.length; index++) {
		const char = content[index] as string;
		out.push(char === " " || char === "\r" || char === "\n" ? char : ".");
	}
	// markdownlint's `trailingSpaceRe`: a run of spaces preceded by the start or a
	// non-space and followed by a CR/LF is hidden too (the line break stays).
	let index = 0;
	while (index < out.length) {
		if (out[index] !== " ") {
			index++;
			continue;
		}
		let end = index;
		while (end < out.length && out[end] === " ") end++;
		const next = out[end];
		if (next === "\r" || next === "\n") for (let at = index; at < end; at++) out[at] = ".";
		index = end;
	}
	return out.join("");
};

/**
 * markdownlint's `clearHtmlCommentText`: the body of each well-formed HTML
 * comment becomes a run of `.` of the same length, line breaks and spaces kept,
 * so every offset and line is preserved. An unterminated comment is treated as
 * text and ends the scan.
 */
export const maskHtmlComments = (text: string): string => {
	const chars = text.split("");
	let from = 0;
	for (let open = text.indexOf(commentOpen, from); open !== -1; open = text.indexOf(commentOpen, from)) {
		const close = text.indexOf(commentClose, open + 2);
		if (close === -1) break;
		const bodyStart = open + commentOpen.length;
		if (close > open + commentOpen.length) {
			const content = text.slice(bodyStart, close);
			// preText is read from the already-masked characters, as upstream's is.
			const lineStart = chars.lastIndexOf("\n", open) + 1;
			const preText = chars.slice(lineStart, open).join("");
			const isBlock = preText.trim().length === 0;
			const couldBeTable = /^ *\|/.test(preText);
			const spansTableCells = couldBeTable && content.includes("\n");
			const valid =
				isBlock ||
				!(
					spansTableCells ||
					content.startsWith(">") ||
					content.startsWith("->") ||
					content.endsWith("-") ||
					content.includes("--")
				);
			if (valid) {
				const masked = maskBody(content);
				for (let at = 0; at < masked.length; at++) chars[bodyStart + at] = masked[at] as string;
			}
		}
		from = close + commentClose.length;
	}
	return chars.join("");
};

// markdownlint runs its front-matter pattern under re2js (a linear-time engine),
// whose `\s` is ASCII-only and whose multiline `^` and `$` see `\n` alone; the
// text has been normalized to `\n` line endings by then. U+2028, U+2029, U+000B
// and U+00A0 are therefore ordinary characters here, unlike under V8.
const isSpace = (char: string | undefined): boolean =>
	char === " " || char === "\t" || char === "\f" || char === "\n" || char === "\r";

const isHorizontalSpace = (char: string): boolean => char === " " || char === "\t" || char === "\f";

// `^<fence>[^\S\r\n]*$`: the opener line, ending at a newline or the end of the
// text. Returns the index of that newline (or the length), or -1.
const openerEnd = (text: string, fence: string): number => {
	if (!text.startsWith(fence)) return -1;
	let at = fence.length;
	while (at < text.length && isHorizontalSpace(text[at] as string)) at++;
	return at === text.length || text[at] === "\n" ? at : -1;
};

// `^<closer>\s*(\r\n|\r|\n|$)` at `at`: the index the match ends at, or -1. The
// greedy `\s*` backs off to the last newline inside the whitespace run, or takes
// the whole run when it reaches the end of the text.
const closerEnd = (text: string, at: number, closer: string): number => {
	if (!text.startsWith(closer, at)) return -1;
	const runStart = at + closer.length;
	let runEnd = runStart;
	while (runEnd < text.length && isSpace(text[runEnd])) runEnd++;
	if (runEnd === text.length) return runEnd;
	for (let probe = runEnd - 1; probe >= runStart; probe--) {
		if (text[probe] === "\n" || text[probe] === "\r") return probe + 1;
	}
	return -1;
};

const matchFrontMatter = (text: string): number => {
	const kinds: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
		["---", ["---"]],
		["+++", ["+++", "..."]],
		["{", ["}"]],
	];
	for (const [opener, closers] of kinds) {
		const lineEnd = openerEnd(text, opener);
		if (lineEnd === -1 || lineEnd === text.length) continue;
		// `[\s\S]+?` takes at least the terminator; a closer is any later line start.
		for (let at = lineEnd + 1; at < text.length; at++) {
			if (text[at - 1] !== "\n") continue;
			for (const closer of closers) {
				const end = closerEnd(text, at, closer);
				if (end !== -1) return end;
			}
		}
	}
	return -1;
};

/**
 * How many leading lines markdownlint's default front-matter pattern takes (a
 * `---`, `+++` or `{` block, with the blank lines trailing its closing fence);
 * 0 when the file has none. Line endings are normalized and a leading byte order
 * mark dropped first, as markdownlint does.
 */
export const frontMatterLineCount = (source: string): number => {
	const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	const end = matchFrontMatter(text);
	if (end === -1) return 0;
	const matched = text.slice(0, end);
	const lines = matched.split("\n");
	return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
};

/** markdownlint's line split: every line of `text` without its terminator. @internal */
export const splitLines = (text: string): Array<string> => text.split(LINE_BREAK);

/** The offset line `count + 1` starts at, or the length when there is no such line. @internal */
export const offsetAfterLines = (text: string, count: number): number => {
	if (count === 0) return 0;
	let seen = 0;
	for (const match of text.matchAll(LINE_BREAK)) {
		seen++;
		if (seen === count) return match.index + match[0].length;
	}
	return text.length;
};

/**
 * `text` as markdownlint hands it to rules: comment bodies masked in the
 * content after its `frontMatterLines`-line front matter, never inside it.
 * markdownlint masks `\n`-normalized text; a lone `\r` is read as the `\n`
 * it becomes there, and kept. @internal
 */
export const maskContent = (text: string, frontMatterLines: number): string => {
	const end = offsetAfterLines(text, frontMatterLines);
	const content = text.slice(end);
	if (!/\r(?!\n)/.test(content)) return text.slice(0, end) + maskHtmlComments(content);
	const masked = maskHtmlComments(content.replace(/\r(?!\n)/g, "\n")).split("");
	for (let at = 0; at < content.length; at++) if (content[at] === "\r") masked[at] = "\r";
	return text.slice(0, end) + masked.join("");
};
