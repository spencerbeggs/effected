// MD004 `ul-style`: a port of markdownlint's lib/md004.mjs over the kit tree.
// markdownlint walks its `listUnordered` tokens and each item's marker; the
// kit's unordered `list` nodes give the same lists, each item starting at its
// marker, and the lists the kit reads inside a math block are dropped, as
// micromark reads those lines as math.

import type { List, MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { inMathBlock, mathFlowBlocks } from "../internal/math-flow.js";
import { LintRule } from "../LintRule.js";

type Style = "asterisk" | "dash" | "plus";

const markerToStyle = (marker: string): Style => (marker === "-" ? "dash" : marker === "+" ? "plus" : "asterisk");
const styleToMarker = (style: string): string => (style === "dash" ? "-" : style === "plus" ? "+" : "*");
const differentItemStyle = (style: Style): Style =>
	style === "dash" ? "plus" : style === "plus" ? "asterisk" : "dash";
const validStyles = new Set(["asterisk", "consistent", "dash", "plus", "sublist"]);

// Every list node with how many lists (ordered or unordered) enclose it, in document order.
const listsWithNesting = (root: MarkdownNode): Array<{ readonly list: List; readonly nesting: number }> => {
	const found: Array<{ readonly list: List; readonly nesting: number }> = [];
	const visit = (node: MarkdownNode, nesting: number): void => {
		const isList = node.type === "list";
		if (isList) found.push({ list: node as List, nesting });
		if ("children" in node) {
			for (const child of node.children as ReadonlyArray<MarkdownNode>) visit(child, isList ? nesting + 1 : nesting);
		}
	};
	visit(root, 0);
	return found;
};

/**
 * MD004 `ul-style`: unordered list markers follow one style.
 *
 * @remarks
 * markdownlint's setting: `style` (default `consistent`; `asterisk`,
 * `dash`, `plus`, `consistent` or `sublist`). As in markdownlint, a falsy
 * value reads as `consistent` and any other value that names no style
 * reads as `dash`.
 *
 * @public
 */
export const MD004: Lint.LintRule = LintRule.make({
	names: ["MD004", "ul-style"],
	description: "Unordered list style",
	tags: ["bullet", "ul"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md004.md",
	check: (context, report) => {
		// markdownlint's `String(params.config.style || "consistent")`, an unknown name read as `dash`.
		const style = String(context.config.style || "consistent");
		let expectedStyle: string = validStyles.has(style) ? style : "dash";
		const nestingStyles: Array<Style> = [];
		const math = mathFlowBlocks(context);
		for (const { list, nesting } of listsWithNesting(context.root as MarkdownNode)) {
			// Strict: a list or fence starting on a math opener line holds the opener (see `inMathBlock`).
			if (list.ordered === true || inMathBlock(math, list.position.start.line)) continue;
			for (const item of list.children) {
				const offset = item.position.start.offset;
				const itemStyle = markerToStyle(context.source.charAt(offset));
				if (style === "sublist") {
					if (nestingStyles[nesting] === undefined) {
						nestingStyles[nesting] =
							itemStyle === nestingStyles[nesting - 1] ? differentItemStyle(itemStyle) : itemStyle;
					}
					expectedStyle = nestingStyles[nesting] as Style;
				} else if (expectedStyle === "consistent") {
					expectedStyle = itemStyle;
				}
				if (expectedStyle !== itemStyle) {
					report(
						context.diagnostic({
							at: { offset, length: 1 },
							detail: `Expected: ${expectedStyle}; Actual: ${itemStyle}`,
							range: true,
							fix: { offset, length: 1, content: styleToMarker(expectedStyle) },
						}),
					);
				}
			}
		}
	},
});
