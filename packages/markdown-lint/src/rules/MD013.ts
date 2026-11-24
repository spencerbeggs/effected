// MD013 `line-length`: a port of markdownlint's lib/md013.mjs over the kit
// tree. markdownlint reads micromark tokens for six line sets — headings, code
// blocks, tables, links, paragraph text and definitions — and this module
// derives each from kit node positions and the raw source instead.

import type { MarkdownNode, Paragraph } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { codeBlockLines } from "../internal/code-blocks.js";
import { headingNodes } from "../internal/headings.js";
import { LINE_BREAK } from "../internal/line-endings.js";
import { firstContentLine, nodeLines } from "../internal/lines.js";
import { flagSetting, flagSettingOn, numberSetting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

// A line that cannot wrap: optional heading or blockquote markers and space, then one run of non-space.
const notWrappable = /^(?:[#>\s]*\s)?\S*$/;

// markdownlint's `line.replace(re`\S*$`, "#")`: the last run of non-space becomes `#`. re2js's `\s` is ASCII
// (tab, line feed, form feed, carriage return, space) and its engine is linear; the leftmost match of `\S*$`
// starts just after the last whitespace character, so a scan back from the end finds it in linear time where an
// unanchored V8 regex would retry from every position of a long run.
const isRe2Space = (code: number): boolean => code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
const replaceLastRun = (line: string): string => {
	let start = line.length;
	while (start > 0 && !isRe2Space(line.charCodeAt(start - 1))) start--;
	return `${line.slice(0, start)}#`;
};

// A line's text less its trailing spaces and tabs, scanned back from the end (an unanchored `[ \t]+$` is quadratic).
const withoutLineSuffix = (text: string): string => {
	let end = text.length;
	while (end > 0 && (text[end - 1] === " " || text[end - 1] === "\t")) end--;
	return text.slice(0, end);
};

// The lines holding a paragraph's own text: its direct text children, less the line breaks between them, the
// indentation that opens a continuation line, and character escapes and references (micromark's `data` tokens
// directly under `paragraph`).
const paragraphTextLines = (context: Lint.LintContext): Set<number> => {
	const lines = new Set<number>();
	for (const paragraph of context.document.findAll("paragraph") as ReadonlyArray<Paragraph>) {
		for (const child of paragraph.children as ReadonlyArray<MarkdownNode>) {
			if (child.type !== "text") continue;
			const text = context.source.slice(child.position.start.offset, child.position.end.offset);
			const value = (child as { readonly value: string }).value;
			// micromark makes no `data` of a character escape or a character reference: drop escapes and numeric
			// references by their syntax, and a named reference when the parse decoded it (an unknown name stays text).
			const notData = (segment: string): string =>
				segment
					.replace(/\\[!-/:-@[-`{-~]/g, "")
					.replace(/&#(?:\d{1,7}|[xX][\da-fA-F]{1,6});/g, "")
					.replace(/&[A-Za-z][A-Za-z\d]{0,30};/g, (reference) => (value.includes(reference) ? reference : ""));
			const segments = text.split(LINE_BREAK);
			for (const [index, segment] of segments.entries()) {
				// The indentation opening a continuation line is micromark's `linePrefix`, and the spaces and tabs before
				// a line break its `lineSuffix`: neither is `data`.
				const opened = index === 0 ? segment : segment.replace(/^[ \t]+/, "");
				const content = index < segments.length - 1 ? withoutLineSuffix(opened) : opened;
				if (notData(content).length > 0) {
					lines.add(child.position.start.line + index);
				}
			}
		}
	}
	return lines;
};

// The lines markdownlint counts as links: inline links, images and autolinks, and references whose label is
// defined (micromark makes a link of no other reference).
const linkLines = (context: Lint.LintContext): Set<number> =>
	nodeLines(
		context.document.links
			.filter(
				(entry) =>
					entry.node.type === "link" ||
					entry.node.type === "image" ||
					((entry.node.type === "linkReference" || entry.node.type === "imageReference") && entry.url !== undefined),
			)
			.map((entry) => entry.node),
	);

/**
 * MD013 `line-length`: lines are no longer than a limit.
 *
 * @remarks
 * markdownlint's settings: `line_length` (default `80`),
 * `heading_line_length` and `code_block_line_length` (default
 * `line_length`), `code_blocks`, `tables` and `headings` (default `true`),
 * and `strict` and `stern` (default `false`). Settings are coerced as markdownlint coerces them
 * (`"50"` reads as `50`, `0` as `false`).
 *
 * @public
 */
export const MD013: Lint.LintRule = LintRule.make({
	names: ["MD013", "line-length"],
	description: "Line length",
	tags: ["line_length"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md013.md",
	check: (context, report) => {
		const lineLength = numberSetting(context.config, "line_length", 80);
		const headingLineLength = numberSetting(context.config, "heading_line_length", lineLength);
		const codeLineLength = numberSetting(context.config, "code_block_line_length", lineLength);
		const strict = flagSetting(context.config, "strict");
		const stern = flagSetting(context.config, "stern");
		const includeCodeBlocks = flagSettingOn(context.config, "code_blocks");
		const includeTables = flagSettingOn(context.config, "tables");
		const includeHeadings = flagSettingOn(context.config, "headings");
		const headings = nodeLines(headingNodes(context));
		const code = codeBlockLines(context);
		const tables = nodeLines(context.document.findAll("table"));
		const textLines = paragraphTextLines(context);
		const linkOnly = new Set([...linkLines(context)].filter((line) => !textLines.has(line)));
		const definitions = nodeLines(
			context.document.findAll((node) => node.type === "definition" || node.type === "footnoteDefinition"),
		);
		for (let lineNumber = firstContentLine(context); lineNumber <= context.lines.length; lineNumber++) {
			const line = context.lines[lineNumber - 1] as string;
			const isHeading = headings.has(lineNumber);
			const inCode = code.has(lineNumber);
			const inTable = tables.has(lineNumber);
			const maxLength = inCode ? codeLineLength : isHeading ? headingLineLength : lineLength;
			// Unless strict or stern, the last run of non-space may run past the limit if it starts within it.
			const text = strict || stern ? line : replaceLastRun(line);
			if (
				maxLength > 0 &&
				(includeCodeBlocks || !inCode) &&
				(includeTables || !inTable) &&
				(includeHeadings || !isHeading) &&
				!definitions.has(lineNumber) &&
				(strict || (!(stern && notWrappable.test(line)) && !linkOnly.has(lineNumber))) &&
				text.length > maxLength &&
				// markdownlint reports through `addErrorDetailIf`, which is silent when the line is exactly the limit.
				line.length !== maxLength
			) {
				const start = context.mapping.lineStart(lineNumber);
				// markdownlint reports a fractional limit's range as fractional columns; a kit range is whole columns, so
				// a fractional limit's finding carries no range (recorded in the module concept).
				const range = Number.isInteger(maxLength)
					? { range: { offset: start + maxLength, length: line.length - maxLength } }
					: {};
				report(
					context.diagnostic({
						at: { offset: start, length: 0 },
						detail: `Expected: ${maxLength}; Actual: ${line.length}`,
						...range,
					}),
				);
			}
		}
	},
});
