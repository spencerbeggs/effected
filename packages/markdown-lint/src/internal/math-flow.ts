// PARSER GAP: block math. markdownlint's micromark runs the math extension,
// whose `mathFlow` the kit tree does not carry, so this module re-reads it
// from raw lines. When @effected/markdown parses math, delete this module and
// read the tree's math nodes instead.

import type { MarkdownNode } from "@effected/markdown";
import type { LintContext } from "../LintContext.js";
import { codeBlockLines } from "./code-blocks.js";
import { containerStep, flowNodes, isContainer } from "./containers.js";
import type { LineRange } from "./lines.js";
import { addRange, firstContentLine, nodeLines } from "./lines.js";
import { perReading } from "./memo.js";

// A container's child containers, looking through lists to their items.
const childContainers = (node: MarkdownNode): Array<MarkdownNode> => {
	const found: Array<MarkdownNode> = [];
	for (const child of ("children" in node ? node.children : []) as ReadonlyArray<MarkdownNode>) {
		if (isContainer(child)) found.push(child);
		else if (child.type === "list") found.push(...childContainers(child));
	}
	return found;
};

// The offset on a line past a chain of containers; `undefined` for a line lazy to one of them.
type Inside = (lineNumber: number) => number | undefined;

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
export const mathFlowBlocks: (context: LintContext) => ReadonlyArray<LineRange> = perReading((context) => {
	const excluded = new Set(codeBlockLines(context));
	for (const line of nodeLines(flowNodes(context, new Set(["html"])))) excluded.add(line);
	const math = new Set<number>();
	const blocks: Array<LineRange> = [];
	const close = (start: number, end: number): void => {
		addRange(math, start, end);
		blocks.push({ start, end });
	};
	// The offset on a line past `container` and every container outside it, from `outer`'s (the offset past
	// those outside it), each line's computed once; `undefined` when the line is lazy to one of them. Each level
	// takes one step from the level above, so no level re-strips the prefixes outside it.
	const inside = (outer: Inside, container: MarkdownNode): Inside => {
		const known = new Map<number, number | undefined>();
		return (lineNumber) => {
			if (known.has(lineNumber)) return known.get(lineNumber);
			const at = outer(lineNumber);
			const next =
				at === undefined
					? undefined
					: containerStep(context.lines[lineNumber - 1] as string, lineNumber, container, at);
			known.set(lineNumber, next);
			return next;
		};
	};
	const scan = (container: MarkdownNode, past: Inside): void => {
		const isRoot = container.type === "root";
		const first = isRoot ? firstContentLine(context) : container.position.start.line;
		const last = isRoot ? context.lines.length : container.position.end.line;
		const children = childContainers(container);
		const pastChild = new Map(children.map((child) => [child, inside(past, child)]));
		// `children` is in document order and `childAt` is asked about ever later lines: a child ending before the
		// line asked about holds no later line either, and none after one starting past it can hold it.
		let firstOpen = 0;
		const childAt = (lineNumber: number): MarkdownNode | undefined => {
			while (firstOpen < children.length && (children[firstOpen] as MarkdownNode).position.end.line < lineNumber) {
				firstOpen++;
			}
			for (let index = firstOpen; index < children.length; index++) {
				const child = children[index] as MarkdownNode;
				if (child.position.start.line > lineNumber) return undefined;
				if (lineNumber <= child.position.end.line) return child;
			}
			return undefined;
		};
		let open = 0;
		let openedAt = 0;
		for (let lineNumber = first; lineNumber <= last; lineNumber++) {
			// An open block holds every line after its opener in this container: what the kit reads there as a
			// child container (a list after the opener, say) is math to micromark.
			if (open === 0 && math.has(lineNumber)) continue;
			const line = context.lines[lineNumber - 1] as string;
			const child = open === 0 ? childAt(lineNumber) : undefined;
			// A line lazy to a child (the kit's paragraph continuation) is this container's line to micromark when
			// it opens math, which interrupts a paragraph; any other line of a child is the child's to read.
			const lazyInChild = child !== undefined && (pastChild.get(child) as Inside)(lineNumber) === undefined;
			if (child !== undefined && !lazyInChild) continue;
			const at = past(lineNumber);
			const text = at === undefined ? undefined : line.slice(at);
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
		for (const child of children) scan(child, pastChild.get(child) as Inside);
	};
	scan(context.document.root as MarkdownNode, () => 0);
	return blocks;
});

/**
 * Every line of every math block {@link mathFlowBlocks} reads, opener lines
 * included; shared, read-only. The inclusive test, for what lies inside a
 * line: inline content on an opener line (`$$ <b>x</b>`) is the fence's meta,
 * math to micromark. Its counterpart for a container is {@link inMathBlock}.
 * @internal
 */
export const mathFlowLines: (context: LintContext) => ReadonlySet<number> = perReading((context) => {
	const lines = new Set<number>();
	for (const block of mathFlowBlocks(context)) addRange(lines, block.start, block.end);
	return lines;
});

/**
 * Whether a node the kit reads starting on `line` lies inside a math block:
 * past the block's opening line, which holds the opener itself. The strict
 * test, for a container or a fence: a list starting on an opener line
 * (`- $$`) holds the opener rather than lying in the math, and the
 * differential tests fail if it is read as inside. Inline content uses the
 * inclusive {@link mathFlowLines}; the two must stay distinct.
 * @internal
 */
export const inMathBlock = (blocks: ReadonlyArray<LineRange>, line: number) =>
	blocks.some((block) => block.start < line && line <= block.end);
