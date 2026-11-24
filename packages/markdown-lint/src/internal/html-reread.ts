// PARSER GAP: an HTML block's lines re-read as Markdown. markdownlint
// re-parses them with micromark's HTML blocks and indented code turned off;
// the kit parser cannot turn a construct off, so this module neutralizes what
// those two constructs read. When @effected/markdown can parse with them off,
// delete this module and re-parse once with them disabled.

import type { Code, MarkdownNode } from "@effected/markdown";
import { MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import { Result } from "effect";
import { CONTAINERS } from "./containers.js";

const reparseOptions = MarkdownParseOptions.make({ dialect: "gfm", frontmatter: false });

/** One line of an HTML block's re-read text: its text, its source line (0 for a stub) and the columns inserted. */
interface RereadLine {
	readonly text: string;
	readonly origin: number;
	readonly inserts: ReadonlyArray<readonly [at: number, length: number]>;
}

/**
 * How many times the re-read parses an HTML block before its terminal sweep.
 * Each pass neutralizes the whole of every HTML block and indented code
 * block the parse finds (every line that starts a run, and every line that
 * could open another HTML block), and a neutralized line never opens one
 * again, so a pass finds only nodes a neutralized line uncovered: a block
 * nested one container deeper, which real documents nest a few levels at
 * most. A constant, so a hostile block costs a constant number of parses.
 * @internal
 */
export const HTML_REREAD_MAX_PASSES = 8;

// A line that opens an HTML block, past its containers' prefix: at most three spaces, then `<`.
const opensHtml = /^ {0,3}</;
// A line indented as code, past its containers' prefix.
const indentedAsCode = /^(?: {4}|\t)/;
// A line with nothing but containers' markers and blanks.
const blankLine = /^[ \t>]*$/;
// The blockquote markers a line opens with, and the blank after each.
const quoteMarkers = /^(?:[ \t]{0,3}>[ \t]?)*/;

/**
 * markdownlint re-parses an HTML block's lines as Markdown with HTML blocks
 * and indented code turned off. The kit cannot turn a construct off, so it
 * parses the lines as written and neutralizes what those two constructs
 * read, until a parse finds neither. An HTML block that interrupts a
 * paragraph is indented four columns behind the container prefix, which
 * makes it the paragraph's continuation; one right after a table gets a
 * leading pipe, which makes it a body row; any other gets a stub line
 * before it (its container prefix and `x`), its own prefix blanked but for
 * blockquote markers, and is indented four columns. Within the node, every
 * later line that starts a run (after a blank line, or in a deeper
 * blockquote: each line is read past its own blockquote markers) gets a
 * stub too, and every later line that could open an HTML block is
 * indented. Every other
 * block (fences, headings, lists, blockquotes, thematic breaks, tables) is
 * read as written.
 *
 * After `maxPasses` parses that still find such nodes, a terminal sweep
 * gives every non-blank line of every node the last parse found a stub
 * before it, behind its own blockquote markers, and indents it, and the
 * block is read from one more parse: every swept line is paragraph text,
 * none read as an HTML block or code, and the re-read costs at most
 * `maxPasses + 1` parses. Each swept line is then its own paragraph, so a
 * tag spanning two of them is not read as one.
 * @internal
 */
export const rereadHtmlBlock = (
	blockLines: ReadonlyArray<string>,
	firstLine: number,
	options?: { readonly maxPasses?: number },
): {
	readonly document: MarkdownDocument | undefined;
	readonly lines: ReadonlyArray<RereadLine>;
	readonly passes: number;
	readonly settled: boolean;
	readonly swept: boolean;
} => {
	const maxPasses = options?.maxPasses ?? HTML_REREAD_MAX_PASSES;
	const lines: Array<RereadLine> = blockLines.map((text, index) => ({ text, origin: firstLine + index, inserts: [] }));
	const parse = (): MarkdownDocument | undefined => {
		const parsed = MarkdownDocument.parseResult(lines.map((line) => line.text).join("\n"), reparseOptions);
		return Result.isSuccess(parsed) ? parsed.success : undefined;
	};
	const insert = (line: RereadLine, at: number, text: string): RereadLine => ({
		text: `${line.text.slice(0, at)}${text}${line.text.slice(at)}`,
		origin: line.origin,
		inserts: [...line.inserts, [at, text.length]],
	});
	// Put a stub line (the prefix and `x`) before line `index`, blank its prefix but for blockquote markers, and
	// indent it `indent` columns.
	const stub = (index: number, at: number, indent: number): void => {
		const line = lines[index] as RereadLine;
		const head = line.text.slice(0, at);
		const blanked: RereadLine = {
			text: head.replace(/[^>]/g, " ") + line.text.slice(at),
			origin: line.origin,
			inserts: line.inserts,
		};
		lines.splice(
			index,
			1,
			{ text: `${head}x`, origin: 0, inserts: [] },
			indent > 0 ? insert(blanked, at, " ".repeat(indent)) : blanked,
		);
	};
	const neutralize = (node: MarkdownNode, previous: MarkdownNode | undefined, sweep: boolean): void => {
		const row = node.position.start.line - 1;
		const at = node.position.start.column - 1;
		const isHtml = node.type === "html";
		// The node's later lines, bottom up so a stub never moves a line still to come. Each is read past its own
		// blockquote markers, so a line opening a deeper blockquote is neutralized inside it in the same pass.
		for (let index = node.position.end.line - 1; index > row; index--) {
			const line = lines[index] as RereadLine;
			const inside = blankLine.test(line.text.slice(0, at)) ? at : 0;
			const column = inside + (quoteMarkers.exec(line.text.slice(inside))?.[0].length ?? 0);
			const content = line.text.slice(column);
			if (blankLine.test(content)) continue;
			if (sweep) {
				stub(index, column, 4);
				continue;
			}
			const startsRun = column > at || blankLine.test((lines[index - 1] as RereadLine).text);
			if ((isHtml || startsRun) && (opensHtml.test(content) || indentedAsCode.test(content))) {
				if (startsRun) stub(index, column, 4);
				else lines[index] = insert(line, column, "    ");
			}
		}
		const line = lines[row] as RereadLine;
		const follows = previous !== undefined && previous.position.end.line === row ? previous.type : undefined;
		if (isHtml && follows === "paragraph" && !sweep) lines[row] = insert(line, at, "    ");
		// After a table, micromark reads the line as a body row: a leading pipe makes it one to the kit too.
		else if (follows === "table" && !sweep) lines[row] = insert(line, at, "|");
		else stub(row, at, isHtml || sweep ? 4 : 0);
	};
	const candidates = (document: MarkdownDocument) => {
		const found: Array<{ readonly node: MarkdownNode; readonly previous: MarkdownNode | undefined }> = [];
		const visit = (node: MarkdownNode): void => {
			const children = ("children" in node ? node.children : []) as ReadonlyArray<MarkdownNode>;
			for (const [index, child] of children.entries()) {
				if (child.type === "html" || (child.type === "code" && (child as Code).fenceChar === undefined)) {
					found.push({ node: child, previous: children[index - 1] });
				}
				if (CONTAINERS.has(child.type)) visit(child);
			}
		};
		visit(document.root as MarkdownNode);
		// Bottom up, so a stub line inserted below never moves a node still to come.
		return found.reverse();
	};
	let passes = 0;
	while (passes < maxPasses) {
		passes++;
		const document = parse();
		if (document === undefined) return { document, lines, passes, settled: false, swept: false };
		const found = candidates(document);
		if (found.length === 0) return { document, lines, passes, settled: true, swept: false };
		// The cap is reached: the terminal sweep neutralizes every line of every node left, then one parse reads it.
		const sweep = passes === maxPasses;
		for (const { node, previous } of found) neutralize(node, previous, sweep);
	}
	return { document: parse(), lines, passes: passes + 1, settled: false, swept: true };
};
