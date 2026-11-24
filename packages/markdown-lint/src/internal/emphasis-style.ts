// MD049 and MD050, as markdownlint's lib/md049-md050.mjs shares them: each
// emphasis (or strong) in document order, its opening and closing sequence
// in one style, `consistent` taking the first's. The kit's emphasis and
// strong nodes start at their opening sequence and end past their closing
// one; those micromark reads as math are dropped (see `inlineNodes`), and
// those of image descriptions are read from source (see `imageLabelNodes`).

import type { LintContext, LintReport } from "../LintContext.js";
import { imageLabelNodes, inlineNodes } from "./inline.js";
import { coercedText } from "./settings.js";

const intraword = /^\w$/;

/**
 * markdownlint's MD049/MD050 `impl` over the kit's `type` nodes. `style` is
 * the raw setting, read as `style || undefined`, so a falsy value is
 * `consistent` and any other is compared as it is.
 * @internal
 */
export const emphasisStyleReports = (
	context: LintContext,
	type: "emphasis" | "strong",
	asterisk: string,
	underline: string,
): ReadonlyArray<LintReport> => {
	const raw = context.config.style;
	let style: unknown = raw || "consistent";
	const width = asterisk.length;
	const reports: Array<LintReport> = [];
	// The tree's nodes and those of image descriptions, in document order (an outer node before one it holds).
	const spans = [
		...inlineNodes(context, type).map((node) => ({ start: node.position.start.offset, end: node.position.end.offset })),
		...imageLabelNodes(context).filter((node) => node.type === type),
	].sort((a, b) => a.start - b.start);
	for (const node of spans) {
		const start = node.start;
		const end = node.end - width;
		const markupStyle = context.source.charAt(start) === "*" ? "asterisk" : "underscore";
		if (style === "consistent") style = markupStyle;
		if (style === markupStyle) continue;
		const before =
			start > context.mapping.lineStart(context.mapping.lineNumber(start)) ? context.source.charAt(start - 1) : "";
		const endLine = context.mapping.lineNumber(end);
		const lineEnd = context.mapping.lineStart(endLine) + (context.lines[endLine - 1] ?? "").length;
		const after = end + width < lineEnd ? context.source.charAt(end + width) : "";
		if (style === "underscore" && (intraword.test(before) || intraword.test(after))) continue;
		for (const offset of [start, end]) {
			reports.push({
				at: { offset, length: 0 },
				detail: `Expected: ${coercedText(style)}; Actual: ${markupStyle}`,
				range: { offset, length: width },
				fix: { offset, length: width, content: style === "asterisk" ? asterisk : underline },
			});
		}
	}
	return reports;
};
