// Reads a file the way markdownlint does, as two linear scans. Both mirror
// markdownlint's own helpers (`clearHtmlCommentText`, `frontMatterRe` with
// `removeFrontMatter`) without its backtracking front-matter regular
// expression, which upstream only tolerates by running it under re2.

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
 * so every offset and line is preserved. An unterminated comment is text and
 * ends the scan, as does nothing else.
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

const isTerminator = (char: string | undefined): boolean =>
	char === "\n" || char === "\r" || char === "\u2028" || char === "\u2029";

const isHorizontalSpace = (char: string): boolean => !isTerminator(char) && /\s/.test(char);

// `^<fence>[^\S\r\n\u2028\u2029]*$`: the opener line, ending at a terminator or the
// end. Returns the index of that terminator (or the length), or -1.
const openerEnd = (text: string, fence: string): number => {
	if (!text.startsWith(fence)) return -1;
	let at = fence.length;
	while (at < text.length && isHorizontalSpace(text[at] as string)) at++;
	return at === text.length || isTerminator(text[at]) ? at : -1;
};

// `^<closer>\s*(\r\n|\r|\n|$)` at `at`: the index the match ends at, or -1. The
// greedy `\s*` backs off to the last line terminator inside the whitespace run,
// or takes the whole run when it reaches the end of the text.
const closerEnd = (text: string, at: number, closer: string): number => {
	if (!text.startsWith(closer, at)) return -1;
	const runStart = at + closer.length;
	let runEnd = runStart;
	while (runEnd < text.length && /\s/.test(text[runEnd] as string)) runEnd++;
	if (runEnd === text.length) return runEnd;
	for (let probe = runEnd - 1; probe >= runStart; probe--) {
		const char = text[probe];
		if (char === "\n" || char === "\r") return probe + 1;
		if (char === "\u2028" || char === "\u2029") return probe;
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
			if (!isTerminator(text[at - 1])) continue;
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
	const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
	const end = matchFrontMatter(text);
	if (end === -1) return 0;
	const matched = text.slice(0, end);
	const lines = matched.split("\n");
	return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
};
