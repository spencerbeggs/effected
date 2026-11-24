// MD022 `blanks-around-headings`: a port of markdownlint's lib/md022.mjs over
// the kit tree. markdownlint counts blank content lines (and, above, front
// matter lines under `include_front_matter`); its fix inserts blank lines
// carrying the blockquote prefix of the line they go next to, which this
// module reads from that line's raw text.

import type { Heading } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { headingNodes } from "../internal/headings.js";
import { preferredLineEnding } from "../internal/line-endings.js";
import { firstContentLine, isBlankLine, lineStarts } from "../internal/lines.js";
import { isBoolean, setting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

const isLinesSetting = (value: unknown): value is number | ReadonlyArray<number> =>
	typeof value === "number" || (Array.isArray(value) && value.every((item) => typeof item === "number"));

// markdownlint's `lines_above` / `lines_below`: one count, or one per heading level (missing levels 1).
const linesFor = (value: number | ReadonlyArray<number>, heading: Heading): number =>
	typeof value === "number" ? value : (value.slice(0, 6)[heading.depth - 1] ?? 1);

// markdownlint's `getBlockQuotePrefixText`: the line's blockquote markers and the indentation around them,
// trailing space trimmed, then a line break, `count` times.
const prefixText = (line: string | undefined, count: number, lineEnding: string): string =>
	`${(/^(?:[ \t]*>[ \t]?)*/.exec(line ?? "")?.[0] ?? "").trimEnd()}${lineEnding}`.repeat(Math.max(0, count));

/**
 * MD022 `blanks-around-headings`: headings are surrounded by blank lines.
 *
 * @remarks
 * markdownlint's settings: `lines_above` and `lines_below` (default `1`;
 * a count, or an array of counts per heading level; a negative count turns
 * that side off) and `include_front_matter` (default `false`). A setting of
 * the wrong type reads as its default.
 *
 * @public
 */
export const MD022: Lint.LintRule = LintRule.make({
	names: ["MD022", "blanks-around-headings"],
	description: "Headings should be surrounded by blank lines",
	tags: ["headings", "blank_lines"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md022.md",
	check: (context, report) => {
		const above = setting(context.config, "lines_above", isLinesSetting, 1);
		const below = setting(context.config, "lines_below", isLinesSetting, 1);
		const includeFrontMatter = setting(context.config, "include_front_matter", isBoolean, false);
		const starts = lineStarts(context.source);
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
		const contentLine = (lineNumber: number): string | undefined =>
			lineNumber >= first && lineNumber <= last ? context.lines[lineNumber - 1] : undefined;
		for (const heading of headingNodes(context)) {
			const startLine = heading.position.start.line;
			const endLine = heading.position.end.line;
			const text = (context.lines[startLine - 1] as string).trim();
			const linesAbove = linesFor(above, heading);
			if (linesAbove >= 0) {
				let actual = 0;
				while (actual < linesAbove && isBlankLine(lineAt(startLine - 1 - actual, includeFrontMatter))) actual++;
				if (actual !== linesAbove) {
					const offset = starts[startLine - 1] as number;
					report(
						context.diagnostic({
							at: { offset, length: 0 },
							detail: `Expected: ${linesAbove}; Actual: ${actual}; Above`,
							context: text,
							fix: {
								offset,
								length: 0,
								content: prefixText(contentLine(startLine - 1), linesAbove - actual, lineEnding),
							},
						}),
					);
				}
			}
			const linesBelow = linesFor(below, heading);
			if (linesBelow >= 0) {
				let actual = 0;
				while (actual < linesBelow && isBlankLine(lineAt(endLine + 1 + actual, false))) actual++;
				if (actual !== linesBelow) {
					const offset = starts[endLine] as number;
					report(
						context.diagnostic({
							at: { offset: heading.position.start.offset, length: 0 },
							detail: `Expected: ${linesBelow}; Actual: ${actual}; Below`,
							context: text,
							fix: {
								offset,
								length: 0,
								content: prefixText(contentLine(endLine + 1), linesBelow - actual, lineEnding),
							},
						}),
					);
				}
			}
		}
	},
});
