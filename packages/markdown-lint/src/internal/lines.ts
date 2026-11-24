// The line model rules read: line ranges, line offsets, the content lines
// markdownlint hands its rules (after the front matter), blank lines and
// markdownlint's error-context text.

import { Option } from "effect";
import type { LintContext } from "../LintContext.js";

/** Add lines `start` to `end`, inclusive, to `set`. @internal */
export const addRange = (set: Set<number>, start: number, end: number): void => {
	for (let line = start; line <= end; line++) set.add(line);
};

/** A run of lines, `start` to `end`, 1-based and inclusive. @internal */
export interface LineRange {
	readonly start: number;
	readonly end: number;
}

/** The 1-based line markdownlint's `params.lines` starts at: the first after its front matter. @internal */
export const firstContentLine = (context: LintContext): number =>
	Option.match(context.frontmatter, { onNone: () => 1, onSome: (block) => block.lineCount + 1 });

/**
 * markdownlint's `params.lines[lineNumber - 1]`, by whole-source line
 * number: a content line (after the front matter), or `undefined` outside
 * them.
 * @internal
 */
export const contentLine = (context: LintContext, lineNumber: number): string | undefined =>
	lineNumber >= firstContentLine(context) && lineNumber <= context.lines.length
		? context.lines[lineNumber - 1]
		: undefined;

/** Every line from each node's first to its last. @internal */
export const nodeLines = (
	nodes: Iterable<{
		readonly position: { readonly start: { readonly line: number }; readonly end: { readonly line: number } };
	}>,
): Set<number> => {
	const lines = new Set<number>();
	for (const node of nodes) addRange(lines, node.position.start.line, node.position.end.line);
	return lines;
};

/**
 * markdownlint's `isBlankLine`: empty, whitespace, or nothing but HTML
 * comments and blockquote markers.
 * @internal
 */
export const isBlankLine = (line: string | undefined): boolean => {
	if (!line?.trim()) return true;
	let text = line;
	while (true) {
		const start = text.indexOf("<!--");
		const end = text.indexOf("-->");
		if (end !== -1 && (start === -1 || end < start)) text = text.slice(end + 3);
		else if (start !== -1 && end !== -1) text = text.slice(0, start) + text.slice(end + 3);
		else if (start !== -1 && end === -1) text = text.slice(0, start);
		else break;
	}
	return !text.replace(/>/g, "").trim();
};

/**
 * markdownlint's `addErrorContext` text: line breaks normalized, then
 * `ellipsify` to 30 characters, keeping the start, the end, or both.
 * @internal
 */
export const errorContext = (text: string, start?: boolean, end?: boolean): string => {
	const normalized = text.replace(/\r\n?|\n/g, "\n");
	if (normalized.length <= 30) return normalized;
	if (start && end) return `${normalized.slice(0, 15)}...${normalized.slice(-15)}`;
	if (end) return `...${normalized.slice(-30)}`;
	return `${normalized.slice(0, 30)}...`;
};
