// MD038 `no-space-in-code`: a port of markdownlint's lib/md038.mjs over the
// kit tree. markdownlint reads each `codeText` token's `codeTextData` and
// `codeTextPadding` children; the kit's code spans carry only their value, so
// the tokens are read back from the span's source as micromark tokenizes it:
// each space a token, each line ending a token (the next line's container
// prefix skipped, its leading whitespace kept), the
// first and last token padding when both are blank and there is data between,
// and the rest merged into data runs split at line endings.

import type { MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { contentInContainers } from "../internal/containers.js";
import { errorContext } from "../internal/lines.js";
import { mathFlowLines } from "../internal/math-flow.js";
import type { LintContext } from "../LintContext.js";
import { LintRule } from "../LintRule.js";

interface Token {
	readonly kind: "space" | "eol" | "data";
	readonly start: number;
	readonly end: number;
}

// A code span's content tokens, as micromark's code text tokenizer reads them before its resolver runs.
const contentTokens = (context: LintContext, start: number, end: number): Array<Token> => {
	const { source } = context;
	const tokens: Array<Token> = [];
	let at = start;
	while (at < end) {
		const char = source.charAt(at);
		if (char === " ") {
			tokens.push({ kind: "space", start: at, end: at + 1 });
			at++;
		} else if (char === "\n" || char === "\r") {
			const length = char === "\r" && source.charAt(at + 1) === "\n" ? 2 : 1;
			tokens.push({ kind: "eol", start: at, end: at + length });
			at += length;
			// The next line's container prefix is no part of the inline content; its leading whitespace is.
			const lineNumber = context.mapping.lineNumber(at);
			const line = context.lines[lineNumber - 1] ?? "";
			const content = contentInContainers(context, lineNumber) ?? line;
			at = Math.max(at, context.mapping.lineStart(lineNumber) + line.length - content.length);
		} else {
			const last = tokens.at(-1);
			if (last?.kind === "data" && last.end === at) tokens[tokens.length - 1] = { ...last, end: at + 1 };
			else tokens.push({ kind: "data", start: at, end: at + 1 });
			at++;
		}
	}
	return tokens;
};

/**
 * MD038 `no-space-in-code`: no extra space inside a code span's backticks.
 *
 * @remarks
 * No settings. One space each side is the padding CommonMark strips; a
 * space more on either side is reported, and the fix deletes it (the padding
 * too, when both sides have extra space and neither side's content is a
 * backtick).
 *
 * @public
 */
export const MD038: Lint.LintRule = LintRule.make({
	names: ["MD038", "no-space-in-code"],
	description: "Spaces inside code span elements",
	tags: ["whitespace", "code"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md038.md",
	check: (context, report) => {
		const math = mathFlowLines(context);
		for (const code of context.document.findAll("inlineCode") as ReadonlyArray<MarkdownNode>) {
			// Inclusive: on a math opener line, this is the fence's meta (see `mathFlowLines`).
			if (math.has(code.position.start.line)) continue;
			const spanStart = code.position.start.offset;
			const spanEnd = code.position.end.offset;
			const span = context.source.slice(spanStart, spanEnd);
			const sequence = (/^`+/.exec(span)?.[0] ?? "").length;
			const tokens = contentTokens(context, spanStart + sequence, spanEnd - sequence);
			const first = tokens[0];
			const last = tokens.at(-1);
			const blank = (token: Token | undefined) => token !== undefined && token.kind !== "data";
			let paddings: ReadonlyArray<Token> = [];
			let inner = tokens;
			if (blank(first) && blank(last) && tokens.slice(1, -1).some((token) => token.kind === "data")) {
				paddings = [first as Token, last as Token];
				inner = tokens.slice(1, -1);
			}
			// Everything between the paddings, merged into data runs split at line endings.
			const datas: Array<Token> = [];
			let open = false;
			for (const token of inner) {
				if (token.kind === "eol") {
					open = false;
					continue;
				}
				const run = datas.at(-1);
				if (open && run !== undefined) datas[datas.length - 1] = { ...run, end: token.end };
				else datas.push({ kind: "data", start: token.start, end: token.end });
				open = true;
			}
			const startData = datas[0];
			const endData = datas.at(-1);
			if (startData === undefined || endData === undefined) continue;
			const text = (token: Token) => context.source.slice(token.start, token.end);
			const startPadding = paddings[0];
			const endPadding = paddings.at(-1);
			const startMatch = /^(\s+)(\S)/.exec(text(startData)) ?? ["", "", ""];
			const startBacktick = startMatch[2] === "`";
			const startCount = (startMatch[1] as string).length - (startBacktick && startPadding === undefined ? 1 : 0);
			const endMatch = /(\S)(\s+)$/.exec(text(endData)) ?? ["", "", ""];
			const endBacktick = endMatch[1] === "`";
			const endCount = (endMatch[2] as string).length - (endBacktick && endPadding === undefined ? 1 : 0);
			const startSpaces = startCount > 0;
			const endSpaces = endCount > 0;
			const removePadding =
				startSpaces &&
				endSpaces &&
				startPadding !== undefined &&
				endPadding !== undefined &&
				!startBacktick &&
				!endBacktick;
			if (startSpaces) {
				const offset = removePadding ? (startPadding as Token).start : startData.start;
				const length = startCount + (removePadding ? text(startPadding as Token).length : 0);
				report(
					context.diagnostic({
						at: { offset: startData.start, length: 0 },
						context: errorContext(span, true, false),
						range: { offset, length },
						fix: { offset, length, content: "" },
					}),
				);
			}
			if (endSpaces) {
				const endOffset = removePadding ? (endPadding as Token).end : endData.end;
				const length = endCount + (removePadding ? text(endPadding as Token).length : 0);
				report(
					context.diagnostic({
						at: { offset: endData.end, length: 0 },
						context: errorContext(span, false, true),
						range: { offset: endOffset - length, length },
						fix: { offset: endOffset - length, length, content: "" },
					}),
				);
			}
		}
	},
});
