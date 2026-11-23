// What the built-in rule ports share: a settings reader that falls back on a
// wrong-typed value, the content lines markdownlint hands its rules (after
// the front matter), line offsets, and the code-block line ranges the
// micromark tokens markdownlint reads would give, derived from the kit tree.

import type { Code, Heading, MarkdownNode } from "@effected/markdown";
import { Option } from "effect";
import type { LintContext } from "../LintContext.js";

/** Read setting `name`, or `fallback` when it is absent or fails `guard`. @internal */
export const setting = <A>(
	config: Readonly<Record<string, unknown>>,
	name: string,
	guard: (value: unknown) => value is A,
	fallback: A,
): A => {
	const value = config[name];
	return guard(value) ? value : fallback;
};

/** @internal */
export const isNumber = (value: unknown): value is number => typeof value === "number";

/** @internal */
export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

/** @internal */
export const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
	Array.isArray(value) && value.every((item) => typeof item === "string");

/** Add lines `start` to `end`, inclusive, to `set`. @internal */
export const addRange = (set: Set<number>, start: number, end: number): void => {
	for (let line = start; line <= end; line++) set.add(line);
};

/** The offset each line of `source` starts at; index 0 is line 1. @internal */
export const lineStarts = (source: string): Array<number> => {
	const starts = [0];
	for (const match of source.matchAll(/\r\n?|\n/g)) starts.push(match.index + match[0].length);
	return starts;
};

/** The 1-based line markdownlint's `params.lines` starts at: the first after its front matter. @internal */
export const firstContentLine = (context: LintContext): number =>
	Option.match(context.frontmatter, { onNone: () => 1, onSome: (block) => block.lineCount + 1 });

// A closed fence ends on its closing fence line: only container markers,
// indentation and at least the opener's run of its character.
const isClosingFence = (line: string, node: Code): boolean => {
	const match = /^(?:[ \t]*>)*[ \t]*(([`~])\2*)[ \t]*$/.exec(line);
	return match !== null && match[2] === node.fenceChar && (match[1] as string).length >= (node.fenceLength ?? 3);
};

/**
 * The 1-based line micromark's `codeFenced` token ends on. A closed fence
 * ends on its closing fence line; micromark ends an unclosed fence at the
 * start of the line after its last, when a line follows it.
 * @internal
 */
export const fencedEndLine = (context: LintContext, node: Code, starts: ReadonlyArray<number>): number => {
	const start = node.position.start.line;
	const end = node.position.end.line;
	const closed = end > start && isClosingFence(context.lines[end - 1] ?? "", node);
	return closed || starts[end] === undefined ? end : end + 1;
};

/**
 * The lines between a fenced code block's fences, as micromark's
 * `codeFenced` token gives them: `startLine + 1` to `endLine - 1`.
 * @internal
 */
export const fencedInterior = (
	context: LintContext,
	node: Code,
	starts: ReadonlyArray<number>,
): { readonly start: number; readonly end: number } => ({
	start: node.position.start.line + 1,
	end: fencedEndLine(context, node, starts) - 1,
});

/** Every kit code node, fenced or indented. @internal */
export const codeNodes = (context: LintContext): ReadonlyArray<Code> =>
	context.document.findAll("code") as ReadonlyArray<Code>;

/**
 * Every line of every code block, fences included, as micromark's
 * `codeFenced` and `codeIndented` tokens span them.
 * @internal
 */
export const codeBlockLines = (context: LintContext, starts: ReadonlyArray<number>): Set<number> => {
	const lines = new Set<number>();
	for (const node of codeNodes(context)) {
		const end = node.fenceChar === undefined ? node.position.end.line : fencedEndLine(context, node, starts);
		addRange(lines, node.position.start.line, end);
	}
	return lines;
};

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
 * The line ending markdownlint's `applyFixes` writes an inserted `\n` as: the
 * source's most common one, LF winning a tie, then CRLF; `\n` when the source
 * has none (markdownlint takes the platform's there).
 * @internal
 */
export const preferredLineEnding = (source: string): string => {
	let cr = 0;
	let lf = 0;
	let crlf = 0;
	for (const match of source.matchAll(/\r\n?|\n/g)) {
		if (match[0] === "\r") cr++;
		else if (match[0] === "\n") lf++;
		else crlf++;
	}
	if (cr === 0 && lf === 0 && crlf === 0) return "\n";
	if (lf >= crlf && lf >= cr) return "\n";
	return crlf >= cr ? "\r\n" : "\r";
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

/** @internal */
export const isString = (value: unknown): value is string => typeof value === "string";

/**
 * markdownlint's `frontMatterHasTitle`: whether a front matter line matches
 * `front_matter_title` (case-insensitive; default `^\s*"?title"?\s*[:=]`).
 * An empty pattern turns front matter off. A pattern of the wrong type, or
 * one that is not a valid regular expression, reads as the default.
 * @internal
 */
export const frontMatterHasTitle = (context: LintContext): boolean => {
	const fallback = '^\\s*"?title"?\\s*[:=]';
	const pattern = setting(context.config, "front_matter_title", isString, fallback);
	if (pattern === "") return false;
	let matcher: RegExp;
	try {
		matcher = new RegExp(pattern, "i");
	} catch {
		matcher = new RegExp(fallback, "i");
	}
	return Option.match(context.frontmatter, {
		onNone: () => false,
		onSome: (block) => block.lines.some((line) => matcher.test(line)),
	});
};

/** An ATX heading's source span, read as micromark tokenizes it. @internal */
export interface AtxParts {
	/** The opening `#` run. */
	readonly open: { readonly offset: number; readonly length: number };
	/** The closing `#` run, when the heading has one. */
	readonly closing: Option.Option<{ readonly offset: number; readonly length: number }>;
}

/**
 * Read an ATX heading's opening and closing sequences from its source span
 * (from its first `#` to its line's end). A closing run follows a space or
 * tab, or the opening run itself, and only spaces or tabs follow it.
 * @internal
 */
export const atxParts = (context: LintContext, heading: Heading): AtxParts => {
	const start = heading.position.start.offset;
	const text = context.source.slice(start, heading.position.end.offset);
	const open = (/^#+/.exec(text)?.[0] ?? "").length;
	const rest = text.slice(open);
	const match = /(^|[ \t])(#+)[ \t]*$/.exec(rest);
	return {
		open: { offset: start, length: open },
		closing:
			match === null
				? Option.none()
				: Option.some({
						offset: start + open + match.index + (match[1] as string).length,
						length: (match[2] as string).length,
					}),
	};
};

/** A heading's style as markdownlint's `getHeadingStyle` reads it. @internal */
export const headingStyle = (context: LintContext, heading: Heading): "atx" | "atx_closed" | "setext" =>
	heading.headingStyle === "setext"
		? "setext"
		: Option.isSome(atxParts(context, heading).closing)
			? "atx_closed"
			: "atx";

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

const CONTAINERS = new Set(["root", "blockquote", "list", "listItem", "footnoteDefinition"]);

/**
 * Every flow-level node of one of `types` — a block in the document, a
 * blockquote, a list item or a footnote definition, never inside a
 * paragraph, heading or table, where the same node type is inline.
 * @internal
 */
export const flowNodes = (context: LintContext, types: ReadonlySet<string>): Array<MarkdownNode> => {
	const found: Array<MarkdownNode> = [];
	const visit = (node: MarkdownNode): void => {
		if (types.has(node.type)) found.push(node);
		if (CONTAINERS.has(node.type) && "children" in node) {
			for (const child of node.children as ReadonlyArray<MarkdownNode>) visit(child);
		}
	};
	visit(context.document.root as MarkdownNode);
	return found;
};

/**
 * The lines of every math block, read from the raw lines: markdownlint's
 * micromark runs the math extension, whose `mathFlow` the kit tree does not
 * carry. A block opens on a line of two or more `$` and a meta with no `$`
 * (behind any blockquote markers and indentation), outside code and HTML
 * blocks, and closes on a line of at least as many `$` alone; an unclosed
 * block runs to the end, as micromark's token does.
 * @internal
 */
export const mathFlowLines = (context: LintContext, starts: ReadonlyArray<number>): Set<number> => {
	const excluded = codeBlockLines(context, starts);
	for (const line of nodeLines(flowNodes(context, new Set(["html"])))) excluded.add(line);
	const lines = new Set<number>();
	const strip = (line: string): string => line.replace(/^(?:[ \t]*>)*[ \t]*/, "");
	let open = 0;
	for (let lineNumber = firstContentLine(context); lineNumber <= context.lines.length; lineNumber++) {
		const text = strip(context.lines[lineNumber - 1] as string);
		if (open > 0) {
			lines.add(lineNumber);
			const closing = /^(\${2,})[ \t]*$/.exec(text);
			if (closing !== null && (closing[1] as string).length >= open) open = 0;
			continue;
		}
		if (excluded.has(lineNumber)) continue;
		const opening = /^(\${2,})([^$]*)$/.exec(text);
		if (opening !== null) {
			open = (opening[1] as string).length;
			lines.add(lineNumber);
		}
	}
	return lines;
};

/**
 * The document's headings as markdownlint sees them: in document order,
 * less any the kit reads inside a math block, which micromark reads as math.
 * @internal
 */
export const headingNodes = (context: LintContext): ReadonlyArray<Heading> => {
	const math = mathFlowLines(context, lineStarts(context.source));
	return (context.document.findAll("heading") as ReadonlyArray<Heading>).filter(
		(heading) => !math.has(heading.position.start.line),
	);
};

/**
 * Every flow-level node of one of `types` with its container ancestors
 * (blockquotes, lists, list items, footnote definitions), outermost first.
 * @internal
 */
export const flowNodesWithAncestors = (
	context: LintContext,
	types: ReadonlySet<string>,
): Array<{ readonly node: MarkdownNode; readonly ancestors: ReadonlyArray<MarkdownNode> }> => {
	const found: Array<{ readonly node: MarkdownNode; readonly ancestors: ReadonlyArray<MarkdownNode> }> = [];
	const visit = (node: MarkdownNode, ancestors: ReadonlyArray<MarkdownNode>): void => {
		if (types.has(node.type)) found.push({ node, ancestors });
		if (CONTAINERS.has(node.type) && "children" in node) {
			const inner = node.type === "root" ? ancestors : [...ancestors, node];
			for (const child of node.children as ReadonlyArray<MarkdownNode>) visit(child, inner);
		}
	};
	visit(context.document.root as MarkdownNode, []);
	return found;
};

/**
 * markdownlint's `getHeadingText`: the heading's content as written — each
 * direct child's source text, inline HTML left out — with line breaks read
 * as spaces, trimmed.
 * @internal
 */
export const headingText = (context: LintContext, heading: Heading): string =>
	(heading.children as ReadonlyArray<MarkdownNode>)
		.filter((child) => child.type !== "html")
		.map((child) => context.source.slice(child.position.start.offset, child.position.end.offset))
		.join("")
		.replace(/\r\n?|\n/g, " ")
		.trim();
