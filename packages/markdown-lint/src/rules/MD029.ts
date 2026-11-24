// MD029 `ol-prefix`: a port of markdownlint's lib/md029.mjs over the kit
// tree. markdownlint reads each ordered list's `listItemPrefix` tokens and
// their `listItemValue`, the item's number as written; the kit reads the same
// from each item's line through the shared prefix reading.

import type { List, ListItem } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { listItemPrefix } from "../internal/containers.js";
import { inMathBlock, mathFlowBlocks } from "../internal/math-flow.js";
import { coercedText } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

const listStyleExamples: Readonly<Record<string, string>> = { one: "1/1/1", ordered: "1/2/3", zero: "0/0/0" };

/**
 * MD029 `ol-prefix`: ordered list numbers follow one style.
 *
 * @remarks
 * markdownlint's setting: `style` (default `one_or_ordered`; `one`,
 * `ordered` or `zero`), read as `String(style)`, so a value naming none of
 * the three reads as the style the list's first two numbers imply. The fix
 * renumbers the item, padded to its width in a right-aligned list.
 *
 * @public
 */
export const MD029: Lint.LintRule = LintRule.make({
	names: ["MD029", "ol-prefix"],
	description: "Ordered list item prefix",
	tags: ["ol"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md029.md",
	check: (context, report) => {
		const style = coercedText(context.config.style);
		const math = mathFlowBlocks(context);
		for (const list of context.document.findAll("list") as ReadonlyArray<List>) {
			// Strict: a list starting on a math opener line holds the opener (see `inMathBlock`).
			if (list.ordered !== true || inMathBlock(math, list.position.start.line)) continue;
			const items = (list.children as ReadonlyArray<ListItem>).map((item) => {
				const prefix = listItemPrefix(context, item);
				const digits = prefix.marker - 1;
				const text = context.source.slice(prefix.offset, prefix.offset + digits);
				return { item, prefix, text, number: Number(text), end: prefix.offset + prefix.marker + prefix.whitespace };
			});
			const [first, second] = items;
			let expectedNumber = 1;
			let incrementing = false;
			let zeroPrefixed = false;
			// Right-aligned: every prefix ends at one column.
			const column = (offset: number, line: number) => offset - context.mapping.lineStart(line);
			const firstEnd = first === undefined ? 0 : column(first.end, first.item.position.start.line);
			const rightAligned = items.every((each) => column(each.end, each.item.position.start.line) === firstEnd);
			if (first !== undefined && second !== undefined) {
				if (second.number !== 1 || first.number === 0) {
					incrementing = true;
					if (first.number === 0) expectedNumber = 0;
				}
				zeroPrefixed = first.text.startsWith("0");
			}
			const listStyle = Object.hasOwn(listStyleExamples, style) ? style : incrementing ? "ordered" : "one";
			if (listStyle === "zero") expectedNumber = 0;
			else if (listStyle === "one") expectedNumber = 1;
			for (const each of items) {
				if (each.number !== expectedNumber) {
					const expectedText = expectedNumber.toString();
					const length = each.text.length;
					report(
						context.diagnostic({
							at: { offset: each.prefix.offset, length: 0 },
							detail: `Expected: ${expectedNumber}; Actual: ${each.number}; Style: ${listStyleExamples[listStyle]}`,
							range: { offset: each.prefix.offset, length: each.end - each.prefix.offset },
							fix: {
								offset: each.prefix.offset,
								length,
								content: rightAligned ? expectedText.padStart(length, zeroPrefixed ? "0" : " ") : expectedText,
							},
						}),
					);
				}
				if (listStyle === "ordered") expectedNumber++;
			}
		}
	},
});
