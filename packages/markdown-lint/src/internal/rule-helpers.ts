// What the built-in rule ports share: a settings reader that falls back on a
// wrong-typed value, the content lines markdownlint hands its rules (after
// the front matter), line offsets, and the code-block line ranges the
// micromark tokens markdownlint reads would give, derived from the kit tree.

import type { Code, Heading, ListItem, MarkdownNode } from "@effected/markdown";
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
 * ends on its closing fence line. An unclosed fence ends where the kit's
 * node ends, except that micromark's token takes the next line break too,
 * ending at the start of the following line, when that line starts a new
 * container (a list item, blockquote or footnote definition), or when it is
 * the document's empty last line and no blockquote holds the fence (a list
 * item or footnote continues onto an empty line; a blockquote does not).
 * @internal
 */
export const fencedEndLine = (context: LintContext, node: Code, starts: ReadonlyArray<number>): number => {
	const start = node.position.start.line;
	const end = node.position.end.line;
	const closed = end > start && isClosingFence(context.lines[end - 1] ?? "", node);
	if (closed || starts[end] === undefined) return end;
	const next = end + 1;
	const containers = context.document.findAll(
		(candidate) =>
			candidate.type === "blockquote" || candidate.type === "listItem" || candidate.type === "footnoteDefinition",
	);
	if (containers.some((container) => container.position.start.line === next)) return next;
	const emptyLast = next === context.lines.length && context.lines[next - 1] === "";
	const quoted = containers.some(
		(container) =>
			container.type === "blockquote" &&
			container.position.start.offset <= node.position.start.offset &&
			node.position.end.offset <= container.position.end.offset,
	);
	return emptyLast && !quoted ? next : end;
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
 * Any falsy value (`""`, `false`, `0`, `null`) turns front matter off, as in
 * markdownlint. A truthy pattern of the wrong type, or one that is not a
 * valid regular expression, reads as the default.
 * @internal
 */
export const frontMatterHasTitle = (context: LintContext): boolean => {
	const fallback = '^\\s*"?title"?\\s*[:=]';
	// markdownlint turns front matter off for any falsy value (`""`, `false`, `0`, `null`), not only `""`.
	const raw = context.config.front_matter_title;
	if (raw !== undefined && !raw) return false;
	const pattern = setting(context.config, "front_matter_title", isString, fallback);
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
 * The 0-based column a list item's content starts at: its first child's,
 * when that starts on the item's line; otherwise past a one-character marker
 * and its space.
 * @internal
 */
export const itemContentColumn = (item: ListItem): number => {
	const first = item.children[0] as MarkdownNode | undefined;
	return first !== undefined && first.position.start.line === item.position.start.line
		? first.position.start.column - 1
		: item.position.start.column + 1;
};

const MATH_CONTAINERS = new Set(["blockquote", "listItem", "footnoteDefinition"]);

// A container's child containers, looking through lists to their items.
const childContainers = (node: MarkdownNode): Array<MarkdownNode> => {
	const found: Array<MarkdownNode> = [];
	for (const child of ("children" in node ? node.children : []) as ReadonlyArray<MarkdownNode>) {
		if (MATH_CONTAINERS.has(child.type)) found.push(child);
		else if (child.type === "list") found.push(...childContainers(child));
	}
	return found;
};

// A line's text inside its containers: each blockquote's marker and its optional space, and each list item's
// or footnote's indentation, removed in turn. `undefined` for a lazy line, one that does not carry them.
const contentOf = (line: string, lineNumber: number, chain: ReadonlyArray<MarkdownNode>): string | undefined => {
	let at = 0;
	for (const container of chain) {
		if (container.type === "blockquote") {
			const marker = /^[ \t]{0,3}>[ \t]?/.exec(line.slice(at));
			if (marker === null) return undefined;
			at += marker[0].length;
			continue;
		}
		const column =
			container.type === "listItem"
				? itemContentColumn(container as ListItem)
				: container.position.start.column - 1 + 4;
		if (lineNumber === container.position.start.line) {
			at =
				container.type === "listItem"
					? Math.max(at, column)
					: at + (/^\[\^[^\]]*\]:[ \t]*/.exec(line.slice(at))?.[0].length ?? 0);
			continue;
		}
		if (line.slice(at, column).trim() !== "") return undefined;
		at = Math.min(Math.max(at, column), line.length);
	}
	return line.slice(at);
};

/**
 * Every math block, by its first and last line: markdownlint's micromark runs the math
 * extension, whose `mathFlow` the kit tree does not carry. Each container's
 * own lines (the document's, a blockquote's, a list item's, a footnote's)
 * are read with the container's markers and indentation removed, as the
 * tree places them. A block opens on a line of two or more `$` and a meta
 * with no `$`, indented at most three columns, outside code and HTML
 * blocks; it closes on a line of at least as many `$` alone, indented at
 * most three columns. An unclosed block ends at a lazy line or where its
 * container ends, as micromark's token does.
 * @internal
 */
export const mathFlowBlocks = (
	context: LintContext,
	starts: ReadonlyArray<number>,
): Array<{ readonly start: number; readonly end: number }> => {
	const excluded = codeBlockLines(context, starts);
	for (const line of nodeLines(flowNodes(context, new Set(["html"])))) excluded.add(line);
	const math = new Set<number>();
	const blocks: Array<{ readonly start: number; readonly end: number }> = [];
	const close = (start: number, end: number): void => {
		addRange(math, start, end);
		blocks.push({ start, end });
	};
	const scan = (container: MarkdownNode, chain: ReadonlyArray<MarkdownNode>): void => {
		const isRoot = container.type === "root";
		const first = isRoot ? firstContentLine(context) : container.position.start.line;
		const last = isRoot ? context.lines.length : container.position.end.line;
		const children = childContainers(container);
		const inChild = (lineNumber: number): boolean =>
			children.some((child) => child.position.start.line <= lineNumber && lineNumber <= child.position.end.line);
		let open = 0;
		let openedAt = 0;
		for (let lineNumber = first; lineNumber <= last; lineNumber++) {
			// An open block holds every line after its opener in this container: what the kit reads there as a
			// child container (a list after the opener, say) is math to micromark.
			if (open === 0 && (inChild(lineNumber) || math.has(lineNumber))) continue;
			const text = contentOf(context.lines[lineNumber - 1] as string, lineNumber, chain);
			if (open > 0) {
				if (text === undefined) {
					close(openedAt, lineNumber - 1);
					open = 0;
					continue;
				}
				const closing = /^ {0,3}(\${2,})[ \t]*$/.exec(text);
				if (closing !== null && (closing[1] as string).length >= open) {
					close(openedAt, lineNumber);
					open = 0;
				}
				continue;
			}
			if (text === undefined || excluded.has(lineNumber)) continue;
			const opening = /^ {0,3}(\${2,})([^$]*)$/.exec(text);
			if (opening !== null) {
				open = (opening[1] as string).length;
				openedAt = lineNumber;
			}
		}
		if (open > 0) close(openedAt, last);
		for (const child of children) scan(child, [...chain, child]);
	};
	scan(context.document.root as MarkdownNode, []);
	return blocks;
};

/** Every line of every math block {@link mathFlowBlocks} reads. @internal */
export const mathFlowLines = (context: LintContext, starts: ReadonlyArray<number>): Set<number> => {
	const lines = new Set<number>();
	for (const block of mathFlowBlocks(context, starts)) addRange(lines, block.start, block.end);
	return lines;
};

/**
 * Whether a node the kit reads starting on `line` lies inside a math block:
 * past the block's opening line, which holds the opener itself.
 * @internal
 */
export const inMathBlock = (blocks: ReadonlyArray<{ readonly start: number; readonly end: number }>, line: number) =>
	blocks.some((block) => block.start < line && line <= block.end);

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

/**
 * markdownlint's `isHtmlFlowComment`: an HTML block that is one comment,
 * read from its unmasked source span.
 * @internal
 */
export const isHtmlFlowComment = (context: LintContext, node: MarkdownNode): boolean => {
	if (node.type !== "html") return false;
	// markdownlint reads the comment before masking it, so `<!-- a --->` still ends in `-`.
	const text = context.unmaskedSource.slice(node.position.start.offset, node.position.end.offset);
	if (!text.startsWith("<!--") || !text.endsWith("-->")) return false;
	const comment = text.slice(4, -3);
	return !comment.startsWith(">") && !comment.startsWith("->") && !comment.endsWith("-");
};

/** The document's top-level blocks after its front matter: micromark's top-level content tokens. @internal */
export const contentBlocks = (context: LintContext): ReadonlyArray<MarkdownNode> =>
	(context.document.root.children as ReadonlyArray<MarkdownNode>).filter((node) => node.type !== "frontmatter");
