// MD022 `blanks-around-headings`: a port of markdownlint's lib/md022.mjs over
// the kit tree. markdownlint counts blank content lines (and, above, front
// matter lines under `include_front_matter`); its fix inserts blank lines
// carrying the blockquote prefix of the line they go next to, which this
// module reads from that line's raw text.

import type { Heading } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { blockQuotePrefixText, flowNodes } from "../internal/containers.js";
import { headingNodes } from "../internal/headings.js";
import { preferredLineEnding } from "../internal/line-endings.js";
import { contentLine, firstContentLine, isBlankLine } from "../internal/lines.js";
import { perReading } from "../internal/memo.js";
import {
	REPEAT_CAP,
	coercedNumber,
	coercedText,
	flagSetting,
	numberSetting,
	rawSetting,
} from "../internal/settings.js";
import type { LintContext } from "../LintContext.js";
import { LintRule } from "../LintRule.js";

// markdownlint's `getLinesFunction` for `lines_above` / `lines_below`: an array gives each heading level its item
// as written (missing levels 1); any other value is one count, `Number(value ?? 1)`. markdownlint compares an
// item as written: by coercion to count and to test the side is on (`<`, `>=`), strictly to decide the finding
// (`!==`, so `["2"]` reports two blank lines as wrong), and as text in the detail.
const linesFunction = (config: Readonly<Record<string, unknown>>, name: string): ((heading: Heading) => unknown) => {
	const value = rawSetting(config, name);
	if (Array.isArray(value)) {
		const levels: Array<unknown> = [1, 1, 1, 1, 1, 1];
		for (const [index, item] of value.slice(0, 6).entries()) levels[index] = item;
		return (heading) => levels[heading.depth - 1];
	}
	const lines = numberSetting(config, name, 1);
	return () => lines;
};

// markdownlint's `getBlockQuotePrefixText` for the line a blank goes next to, `count` times: the line's
// `blockQuotePrefix` and `linePrefix` tokens (a list item's own indentation is neither), trailing space trimmed, then a
// line break. markdownlint's token filter skips an HTML block's children, and micromark nests the container prefixes of
// the block's later lines inside it, so those lines read as no prefix.
const quotePrefixLines = (context: LintContext, lineNumber: number, count: number, lineEnding: string): string => {
	const inside = contentLine(context, lineNumber) !== undefined && !htmlInteriorLines(context).has(lineNumber);
	return `${inside ? blockQuotePrefixText(context, lineNumber) : ""}${lineEnding}`.repeat(Math.max(0, count));
};

// The lines of each HTML block after its first.
const htmlInteriorLines: (context: LintContext) => ReadonlySet<number> = perReading((context) => {
	const lines = new Set<number>();
	for (const node of flowNodes(context, new Set(["html"]))) {
		for (let line = node.position.start.line + 1; line <= node.position.end.line; line++) lines.add(line);
	}
	return lines;
});

// markdownlint's count of blank lines beside a heading: up to `count` steps from it while each line is blank. Every
// line past the document's edge reads as "" (blank), so once the walk leaves the document each remaining step counts
// one: the walk stops at the edge and takes them at once (the smallest whole count not below `count`), where
// markdownlint loops through them, forever under `Infinity`. The bound is the document's own lines.
const blankRun = (
	count: number,
	lineNumberAt: (step: number) => number,
	inside: (lineNumber: number) => boolean,
	lineAt: (lineNumber: number) => string,
): number => {
	let actual = 0;
	while (actual < count) {
		const lineNumber = lineNumberAt(actual);
		if (!inside(lineNumber)) return Math.ceil(count);
		if (!isBlankLine(lineAt(lineNumber))) break;
		actual++;
	}
	return actual;
};

/**
 * MD022 `blanks-around-headings`: headings are surrounded by blank lines.
 *
 * @remarks
 * markdownlint's settings: `lines_above` and `lines_below` (default `1`;
 * a count, or an array of counts per heading level; a negative count turns
 * that side off; a fix inserts at most 1,000 blank lines, and a count past
 * the document's edge ends there, where markdownlint loops through it) and `include_front_matter` (default `false`). Settings are coerced as markdownlint coerces them
 * (`"50"` reads as `50`, `0` as `false`).
 *
 * @public
 */
export const MD022: Lint.LintRule = LintRule.make({
	names: ["MD022", "blanks-around-headings"],
	description: "Headings should be surrounded by blank lines",
	tags: ["headings", "blank_lines"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md022.md",
	check: (context, report) => {
		const above = linesFunction(context.config, "lines_above");
		const below = linesFunction(context.config, "lines_below");
		const includeFrontMatter = flagSetting(context.config, "include_front_matter");
		const lineEnding = preferredLineEnding(context.source);
		const first = firstContentLine(context);
		const last = context.lines.length;
		// markdownlint's `getLine`, by whole-source line number: a content line, a front matter line when allowed, or "".
		const lineAt = (lineNumber: number, frontMatter: boolean): string =>
			lineNumber >= first && lineNumber <= last
				? (context.lines[lineNumber - 1] as string)
				: frontMatter && lineNumber >= 1 && lineNumber < first
					? (context.lines[lineNumber - 1] as string)
					: "";
		// The first line the walk above can read: a front matter line when included, else the first content line.
		const top = includeFrontMatter ? 1 : first;
		for (const heading of headingNodes(context)) {
			const startLine = heading.position.start.line;
			const endLine = heading.position.end.line;
			const text = (context.lines[startLine - 1] as string).trim();
			const linesAbove = above(heading);
			const countAbove = coercedNumber(linesAbove);
			if (countAbove >= 0) {
				const actual = blankRun(
					countAbove,
					(step) => startLine - 1 - step,
					(lineNumber) => lineNumber >= top,
					(lineNumber) => lineAt(lineNumber, includeFrontMatter),
				);
				if (actual !== linesAbove) {
					const offset = context.mapping.lineStart(startLine);
					report(
						context.diagnostic({
							at: { offset, length: 0 },
							detail: `Expected: ${coercedText(linesAbove)}; Actual: ${actual}; Above`,
							context: text,
							fix: {
								offset,
								length: 0,
								content: quotePrefixLines(
									context,
									startLine - 1,
									Math.min(REPEAT_CAP, countAbove - actual),
									lineEnding,
								),
							},
						}),
					);
				}
			}
			const linesBelow = below(heading);
			const countBelow = coercedNumber(linesBelow);
			if (countBelow >= 0) {
				const actual = blankRun(
					countBelow,
					(step) => endLine + 1 + step,
					(lineNumber) => lineNumber <= last,
					(lineNumber) => lineAt(lineNumber, false),
				);
				if (actual !== linesBelow) {
					const offset = context.mapping.lineStart(endLine + 1);
					report(
						context.diagnostic({
							at: { offset: heading.position.start.offset, length: 0 },
							detail: `Expected: ${coercedText(linesBelow)}; Actual: ${actual}; Below`,
							context: text,
							fix: {
								offset,
								length: 0,
								content: quotePrefixLines(context, endLine + 1, Math.min(REPEAT_CAP, countBelow - actual), lineEnding),
							},
						}),
					);
				}
			}
		}
	},
});
