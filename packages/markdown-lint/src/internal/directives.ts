// markdownlint's directive extension (leaf and container directives, inline
// ones off) reads lines the kit's parser reads as paragraph text: micromark
// ends the paragraph (and so a list item's lazy continuation, or a table)
// before each. One reading of those lines, shared by the rules whose blocks
// they end.

import type { LintContext } from "../LintContext.js";
import { contentInContainers } from "./containers.js";
import { perReading } from "./memo.js";

// What markdownlint's directive extension (leaf and container directives; inline ones off) reads a line's text, past
// its containers, as: a leaf (`::name`), a container's opening (`:::name`, three colons or more) — each an optional
// `[label]` (brackets balanced) then `{attributes}` (quotes honoured), nothing after but blanks — or a closing fence
// (colons alone, `close` its count). A name opens with a letter or digit and goes on with letters, digits, `_`, `-`.
const directiveLine = (
	text: string,
): { readonly kind: "leaf" | "open" } | { readonly kind: "close"; readonly colons: number } | undefined => {
	const fence = /^ {0,3}(:{2,})/.exec(text);
	if (fence === null) return undefined;
	const colons = (fence[1] as string).length;
	let at = fence[0].length;
	if (colons >= 3 && /^[ \t]*$/.test(text.slice(at))) return { kind: "close", colons };
	while (text.charAt(at) === "\t") at++;
	const name = /^[\p{L}\p{N}][\p{L}\p{N}_-]*/u.exec(text.slice(at));
	if (name === null) return undefined;
	at += name[0].length;
	if (text.charAt(at) === "[") {
		let depth = 0;
		for (; at < text.length; at++) {
			const char = text.charAt(at);
			if (char === "\\") at++;
			else if (char === "[") depth++;
			else if (char === "]" && --depth === 0) break;
		}
		if (depth !== 0) return undefined;
		at++;
	}
	if (text.charAt(at) === "{") {
		let quote = "";
		for (at++; at < text.length; at++) {
			const char = text.charAt(at);
			if (quote !== "") {
				if (char === quote) quote = "";
			} else if (char === '"' || char === "'") quote = char;
			else if (char === "}") break;
		}
		if (at >= text.length) return undefined;
		at++;
	}
	if (!/^[ \t]*$/.test(text.slice(at))) return undefined;
	return { kind: colons === 2 ? "leaf" : "open" };
};

// A line's text past its containers; for a line lazy to one (no marker or indentation for it), past its blockquote
// markers, which a lazy line keeps.
const contentOf = (context: LintContext, lineNumber: number, line: string): string =>
	contentInContainers(context, lineNumber) ?? line.replace(/^(?:[ \t]{0,3}>[ \t]?)*/, "");

/**
 * The lines markdownlint's directive extension reads as directive lines, by line number: a leaf, a container's
 * opening, and the fence closing an open container (one with at least its opening's colons), each read past the
 * line's containers. micromark ends the block before each where the kit's parser reads a lazy continuation or one
 * more table row. The open containers are tracked across the document, not per container. Built once per reading.
 * @internal
 */
export const directiveLines: (context: LintContext) => ReadonlyMap<number, "leaf" | "open" | "close"> = perReading(
	(context) => {
		const ends = new Map<number, "leaf" | "open" | "close">();
		const open: Array<number> = [];
		for (const [index, line] of context.lines.entries()) {
			if (!line.includes("::")) continue;
			const lineNumber = index + 1;
			const directive = directiveLine(contentOf(context, lineNumber, line));
			if (directive === undefined) continue;
			if (directive.kind === "close") {
				if (open.length > 0 && directive.colons >= (open[open.length - 1] as number)) {
					open.pop();
					ends.set(lineNumber, "close");
				}
				continue;
			}
			if (directive.kind === "open") {
				const colons = /^ {0,3}(:+)/.exec(contentOf(context, lineNumber, line))?.[1]?.length ?? 3;
				open.push(colons);
			}
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
			const text = contentOf(context, lineNumber, context.lines[lineNumber - 1] ?? "");
			if (/^[ \t]*$/.test(text)) continue;
			if (!/^(?: {4}|\t| {0,3}\t)/.test(text)) break;
			code.add(lineNumber);
		}
	}
	return code;
});
