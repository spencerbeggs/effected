// MD030 `list-marker-space`: a port of markdownlint's lib/md030.mjs over the
// kit tree. markdownlint reads each list's `listItemPrefix` tokens and their
// `listItemPrefixWhitespace`, the spaces after the marker; the kit reads the
// same through the shared prefix reading.

import type { List, ListItem } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { flowNodesWithAncestors, listItemPrefix, listTokenEndLine } from "../internal/containers.js";
import { inMathBlock, mathFlowBlocks } from "../internal/math-flow.js";
import { REPEAT_CAP, numberSetting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

/**
 * MD030 `list-marker-space`: a set number of spaces follows each list
 * marker.
 *
 * @remarks
 * markdownlint's settings: `ul_single`, `ol_single`, `ul_multi` and
 * `ol_multi` (each default 1), the spaces after an unordered or ordered
 * marker in a list whose items each fit on one line, or not; read as
 * `Number(x ?? 1)`. A fix pads to at most 1,000 spaces, where markdownlint
 * pads to any setting.
 *
 * @public
 */
export const MD030: Lint.LintRule = LintRule.make({
	names: ["MD030", "list-marker-space"],
	description: "Spaces after list markers",
	tags: ["ol", "ul", "whitespace"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md030.md",
	check: (context, report) => {
		const ulSingle = numberSetting(context.config, "ul_single", 1);
		const olSingle = numberSetting(context.config, "ol_single", 1);
		const ulMulti = numberSetting(context.config, "ul_multi", 1);
		const olMulti = numberSetting(context.config, "ol_multi", 1);
		const math = mathFlowBlocks(context);
		for (const { node, ancestors } of flowNodesWithAncestors(context, new Set(["list"]))) {
			const list = node as List;
			// Strict: a list starting on a math opener line holds the opener (see `inMathBlock`).
			if (inMathBlock(math, list.position.start.line)) continue;
			const items = list.children as ReadonlyArray<ListItem>;
			// The list's last line as micromark's token ends it (see `listTokenEndLine`).
			const endLine = listTokenEndLine(context, list, ancestors);
			const allSingleLine = endLine - list.position.start.line + 1 === items.length;
			const expectedSpaces =
				list.ordered === true ? (allSingleLine ? olSingle : olMulti) : allSingleLine ? ulSingle : ulMulti;
			// `padEnd` truncates its length and reads `NaN` or a negative one as none.
			const padding = " ".repeat(Math.min(REPEAT_CAP, Math.max(0, Math.trunc(expectedSpaces) || 0)));
			for (const item of items) {
				const prefix = listItemPrefix(context, item);
				const actualSpaces = prefix.whitespace;
				if (actualSpaces === 0 || actualSpaces === expectedSpaces) continue;
				const whitespace = prefix.offset + prefix.marker;
				report(
					context.diagnostic({
						at: { offset: prefix.offset, length: 0 },
						detail: `Expected: ${expectedSpaces}; Actual: ${actualSpaces}`,
						range: { offset: prefix.offset, length: prefix.marker + actualSpaces },
						fix: { offset: whitespace, length: actualSpaces, content: padding },
					}),
				);
			}
		}
	},
});
