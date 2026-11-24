// MD038 `no-space-in-code`: a port of markdownlint's lib/md038.mjs over the
// kit tree. markdownlint reads each `codeText` token's `codeTextData` and
// `codeTextPadding` children; the kit's code spans carry only their value, so
// the tokens are read back from the span's source (see `codeSpanParts`).

import type * as Lint from "@effected/markdown-lint";
import type { CodeSpanToken as Token } from "../internal/inline.js";
import { codeSpanParts, inlineNodes } from "../internal/inline.js";
import { errorContext } from "../internal/lines.js";
import { LintRule } from "../LintRule.js";

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
		for (const code of inlineNodes(context, "inlineCode")) {
			const { span, paddings, datas } = codeSpanParts(context, code);
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
