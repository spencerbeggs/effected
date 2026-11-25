// markdownlint's directive extension (leaf and container directives, inline
// ones off) reads lines the kit's parser reads as paragraph text: micromark
// ends the paragraph (and so a list item's lazy continuation, or a table)
// before each. One reading of those lines, in micromark's own grammar
// (micromark-extension-directive's factory-name, factory-label and
// factory-attributes), shared by every rule and reader whose blocks they end.
// A line inside a fenced or indented code block, an HTML block, a math block
// or the front matter is no directive: micromark never reads one there.

import type { MarkdownNode } from "@effected/markdown";
import { Option } from "effect";
import type { LintContext } from "../LintContext.js";
import { contentInContainers, flowNodes } from "./containers.js";
import { mathFlowLines } from "./math-flow.js";
import { perReading } from "./memo.js";

// micromark's `unicodePunctuation` (Unicode punctuation and symbols) and `unicodeWhitespace`. micromark codes a tab
// as a negative value, which is neither, so a tab is a name character.
const isPunctuation = (char: string): boolean => /[\p{P}\p{S}]/u.test(char);
const isWhitespace = (char: string): boolean => char !== "\t" && /\s/u.test(char);
const isSpace = (char: string): boolean => char === " " || char === "\t";

// micromark's `factoryName` from `at`: the end of the name, or -1. It opens with no punctuation or whitespace, goes on
// to whitespace or punctuation other than `-` and `_`, and does not end in either.
const nameEnd = (text: string, at: number): number => {
	const first = text.charAt(at);
	if (first === "" || isPunctuation(first) || isWhitespace(first)) return -1;
	let index = at + 1;
	for (; index < text.length; index++) {
		const char = text.charAt(index);
		if (isWhitespace(char) || (isPunctuation(char) && char !== "-" && char !== "_")) break;
	}
	const last = text.charAt(index - 1);
	return last === "-" || last === "_" ? -1 : index;
};

// micromark's `factoryLabel` (no line ending) from the `[` at `at`: past its `]`, or -1. Brackets nest, at most 32 deep;
// a backslash escapes the character after it.
const labelEnd = (text: string, at: number): number => {
	let balance = 0;
	for (let index = at + 1; index < text.length; index++) {
		const char = text.charAt(index);
		if (char === "\\") index++;
		else if (char === "[") {
			if (++balance > 32) return -1;
		} else if (char === "]") {
			if (balance === 0) return index + 1;
			balance--;
		}
	}
	return -1;
};

// micromark's `factoryAttributes` (no line ending) from the `{` at `at`: past its `}`, or -1.
const attributesEnd = (text: string, at: number): number => {
	let index = at + 1;
	const char = () => text.charAt(index);
	while (index <= text.length) {
		// `between`
		while (isSpace(char())) index++;
		const start = char();
		if (start === "#" || start === ".") {
			index++;
			if (/^["#'.<=>`}]$/.test(char()) || isSpace(char()) || char() === "") return -1;
			while (index < text.length && !/^[#.}]$/.test(char()) && !isSpace(char())) {
				if (/^["'<=>`]$/.test(char())) return -1;
				index++;
			}
			continue;
		}
		if (start === "" || isWhitespace(start) || (isPunctuation(start) && start !== "-" && start !== "_")) {
			return start === "}" ? index + 1 : -1;
		}
		// An attribute's name.
		index++;
		while (index < text.length) {
			const c = char();
			// As in a directive's name, a tab is a name character: only whitespace and punctuation end one.
			if (isWhitespace(c) || (isPunctuation(c) && !/^[-.:_]$/.test(c))) break;
			index++;
		}
		while (isSpace(char())) index++;
		if (char() !== "=") continue;
		index++;
		while (isSpace(char())) index++;
		const value = char();
		if (value === "" || /^[<=>`}]$/.test(value)) return -1;
		if (value === '"' || value === "'") {
			const close = text.indexOf(value, index + 1);
			if (close === -1) return -1;
			index = close + 1;
			const after = char();
			if (after !== "}" && !isSpace(after)) return -1;
			continue;
		}
		while (index < text.length && char() !== "}" && !isSpace(char())) {
			if (/^["'<=>`]$/.test(char())) return -1;
			index++;
		}
	}
	return -1;
};

/**
 * What markdownlint's directive extension reads a line's text, past its containers, as: a leaf (`::name`), a
 * container's opening (`:::name`, three colons or more, `colons` their count) — each a name, an optional `[label]`
 * then `{attributes}`, and nothing after but blanks — or a closing fence (colons alone). Indentation up to three
 * spaces.
 * @internal
 */
export const directiveLine = (
	text: string,
): { readonly kind: "leaf" | "open" | "close"; readonly colons: number } | undefined => {
	const fence = /^ {0,3}(:{2,})/.exec(text);
	if (fence === null) return undefined;
	const colons = (fence[1] as string).length;
	let at = fence[0].length;
	if (colons >= 3 && /^[ \t]*$/.test(text.slice(at))) return { kind: "close", colons };
	at = nameEnd(text, at);
	if (at < 0) return undefined;
	if (text.charAt(at) === "[") {
		const end = labelEnd(text, at);
		if (end >= 0) at = end;
	}
	if (text.charAt(at) === "{") {
		const end = attributesEnd(text, at);
		if (end >= 0) at = end;
	}
	if (!/^[ \t]*$/.test(text.slice(at))) return undefined;
	return { kind: colons === 2 ? "leaf" : "open", colons };
};

// A line's text past its containers; for a line lazy to one (no marker or indentation for it), past its blockquote
// markers, which a lazy line keeps.
const contentOf = (context: LintContext, lineNumber: number, line: string): string =>
	contentInContainers(context, lineNumber) ?? line.replace(/^(?:[ \t]{0,3}>[ \t]?)*/, "");

// The lines micromark reads no directive on: the front matter, code and HTML blocks, math blocks.
const opaqueLines = (context: LintContext): ReadonlySet<number> => {
	const lines = new Set<number>(mathFlowLines(context));
	const frontmatterLines = Option.match(context.frontmatter, { onNone: () => 0, onSome: (block) => block.lineCount });
	for (let line = 1; line <= frontmatterLines; line++) lines.add(line);
	for (const node of flowNodes(context, new Set(["code", "html"])) as ReadonlyArray<MarkdownNode>) {
		for (let line = node.position.start.line; line <= node.position.end.line; line++) lines.add(line);
	}
	return lines;
};

/**
 * The lines markdownlint's directive extension reads as directive lines, by line number: a leaf, a container's
 * opening, and the fence closing an open container (one with at least its opening's colons), each read past the
 * line's containers, none inside a code, HTML or math block or the front matter. micromark ends the block before each
 * where the kit's parser reads a lazy continuation or one more table row. The open containers are tracked across the
 * document, not per container. Built once per reading.
 * @internal
 */
export const directiveLines: (context: LintContext) => ReadonlyMap<number, "leaf" | "open" | "close"> = perReading(
	(context) => {
		const ends = new Map<number, "leaf" | "open" | "close">();
		if (!context.source.includes("::")) return ends;
		const opaque = opaqueLines(context);
		const open: Array<number> = [];
		for (const [index, line] of context.lines.entries()) {
			const lineNumber = index + 1;
			if (!line.includes("::") || opaque.has(lineNumber)) continue;
			const directive = directiveLine(contentOf(context, lineNumber, line));
			if (directive === undefined) continue;
			if (directive.kind === "close") {
				if (open.length > 0 && directive.colons >= (open[open.length - 1] as number)) {
					open.pop();
					ends.set(lineNumber, "close");
				}
				continue;
			}
			if (directive.kind === "open") open.push(directive.colons);
			ends.set(lineNumber, directive.kind);
		}
		return ends;
	},
);

/**
 * The lines micromark reads as indented code right after a directive line, where the kit's parser, reading the
 * directive as paragraph text, reads them as more of the paragraph: lines whose text past their containers opens
 * with four spaces or a tab, from the line after a directive line, through blank lines, to the first that does not.
 * Built once per reading.
 * @internal
 */
export const directiveIndentedCode: (context: LintContext) => ReadonlySet<number> = perReading((context) => {
	const code = new Set<number>();
	for (const directive of directiveLines(context).keys()) {
		for (let lineNumber = directive + 1; lineNumber <= context.lines.length; lineNumber++) {
			if (directiveLines(context).has(lineNumber)) break;
			const text = contentOf(context, lineNumber, context.lines[lineNumber - 1] ?? "");
			if (/^[ \t]*$/.test(text)) continue;
			if (!/^(?: {4}|\t| {0,3}\t)/.test(text)) break;
			code.add(lineNumber);
		}
	}
	return code;
});

/**
 * The lines inside the kit's paragraphs where micromark ends a paragraph and, past the line, starts another: each
 * directive line and each math block's line (a math block's lines are no text; the line after it opens a new
 * paragraph). Built once per reading.
 * @internal
 */
export const paragraphBreaks: (context: LintContext) => ReadonlySet<number> = perReading(
	(context) => new Set<number>([...directiveLines(context).keys(), ...mathFlowLines(context)]),
);
