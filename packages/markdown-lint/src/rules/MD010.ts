// MD010 `no-hard-tabs`: a port of markdownlint's lib/md010.mjs over the kit
// tree. markdownlint skips a tab that overlaps a code token's span — a fenced
// block's lines between its fences, an indented block's span, a code span's
// span — and this module takes those spans from kit node positions.

import type * as Lint from "@effected/markdown-lint";
import {
	codeNodes,
	fencedInterior,
	firstContentLine,
	isBoolean,
	isNumber,
	isStringArray,
	lineStarts,
	setting,
} from "../internal/rule-helpers.js";
import { LintRule } from "../LintRule.js";

interface Span {
	readonly startLine: number;
	readonly startColumn: number;
	readonly endLine: number;
	readonly endColumn: number;
}

const lessOrEqual = (lineA: number, columnA: number, lineB: number, columnB: number): boolean =>
	lineA < lineB || (lineA === lineB && columnA <= columnB);

// markdownlint's `hasOverlap`, which reads a token's exclusive end column as
// inclusive: a tab right after a code span overlaps it.
const overlaps = (a: Span, b: Span): boolean => {
	const [first, second] = lessOrEqual(a.startLine, a.startColumn, b.startLine, b.startColumn) ? [a, b] : [b, a];
	return lessOrEqual(second.startLine, second.startColumn, first.endLine, first.endColumn);
};

const spanOf = (node: {
	readonly position: {
		readonly start: { line: number; column: number };
		readonly end: { line: number; column: number };
	};
}): Span => ({
	startLine: node.position.start.line,
	startColumn: node.position.start.column,
	endLine: node.position.end.line,
	endColumn: node.position.end.column,
});

/**
 * MD010 `no-hard-tabs`: no hard tab characters.
 *
 * @remarks
 * markdownlint's settings: `code_blocks` (default `true`),
 * `ignore_code_languages` (default `[]`) and `spaces_per_tab` (default `1`).
 * A setting of the wrong type reads as its default.
 *
 * @public
 */
export const MD010: Lint.LintRule = LintRule.make({
	names: ["MD010", "no-hard-tabs"],
	description: "Hard tabs",
	tags: ["whitespace", "hard_tab"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md010.md",
	check: (context, report) => {
		const includeCode = setting(context.config, "code_blocks", isBoolean, true);
		const ignored = new Set(
			setting(context.config, "ignore_code_languages", isStringArray, []).map((language) => language.toLowerCase()),
		);
		const spacesPerTab = setting(context.config, "spaces_per_tab", isNumber, 1);
		const multiplier = Math.max(0, spacesPerTab);
		const starts = lineStarts(context.source);
		const spans: Array<Span> = [];
		for (const node of codeNodes(context)) {
			if (node.fenceChar !== undefined) {
				// Under an ignore list, a fence is excluded only when its language is listed (or it has none), even
				// with `code_blocks: false`, as markdownlint's filter does.
				const listed = node.lang === undefined || ignored.has(node.lang.toLowerCase());
				if (includeCode ? ignored.size === 0 || !listed : ignored.size > 0 && !listed) continue;
				const interior = fencedInterior(context, node, starts);
				spans.push({
					startLine: interior.start,
					startColumn: 0,
					endLine: interior.end,
					endColumn: Number.MAX_SAFE_INTEGER,
				});
			} else if (!includeCode) spans.push(spanOf(node));
		}
		if (!includeCode) for (const node of context.document.findAll("inlineCode")) spans.push(spanOf(node));
		for (let lineNumber = firstContentLine(context); lineNumber <= context.lines.length; lineNumber++) {
			const line = context.lines[lineNumber - 1] as string;
			for (const match of line.matchAll(/\t+/g)) {
				const column = match.index + 1;
				const length = match[0].length;
				const tab: Span = {
					startLine: lineNumber,
					startColumn: column,
					endLine: lineNumber,
					endColumn: column + length - 1,
				};
				if (spans.some((span) => overlaps(span, tab))) continue;
				const offset = (starts[lineNumber - 1] as number) + match.index;
				report(
					context.diagnostic({
						at: { offset, length },
						detail: `Column: ${column}`,
						range: true,
						fix: { offset, length, content: "".padEnd(length * multiplier) },
					}),
				);
			}
		}
	},
});
