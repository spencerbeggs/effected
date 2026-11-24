// markdownlint's reference link and image data (`getReferenceLinkImageData`),
// read over the kit tree: the definitions (link and footnote, the first of a
// label winning, the rest duplicates), and the references and shortcuts that
// use a label, formed ones and the undefined ones markdownlint's
// micromark-parse shim reports.
//
// The shim runs wherever micromark's label end fails (a `]` that closes no
// link): from the latest label start still in the event list (a `[` or `![`
// whose link did not form; a formed link's start is resolved away), it joins
// the text of the data-like events since (data, line endings, code spans,
// inline HTML, autolinks, math and emphasis sequences; never an escape, a
// character reference, a label marker, a resource or a reference) and, when
// that text trimmed is not empty and holds no `]`, records an undefined
// shortcut over the source from the start to the `]`. A shim right after the
// previous one pairs with it: with no events between its brackets (`[]`) the
// previous becomes collapsed, otherwise the two become one full reference,
// labelled by the second. A failed `]` is data, so any later shim back to an
// earlier start holds it and records nothing.

import type { MarkdownNode } from "@effected/markdown";
import { MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import { Result } from "effect";
import type { LintContext } from "../LintContext.js";
import { contentInContainers } from "./containers.js";
import { characterReference, inMathText, isReference, mathCheck } from "./inline.js";
import { mathFlowLines } from "./math-flow.js";
import { labelEnd } from "./math-text.js";
import { perReading } from "./memo.js";

/** markdownlint's `normalizeLinkLabelText`. @internal */
export const normalizeLabel = (text: string): string => text.toLowerCase().trim().replace(/\s+/g, " ");

/** One use of a label: the source span of the link, image or footnote call (or undefined reference) using it. @internal */
export interface ReferenceUse {
	readonly offset: number;
	readonly length: number;
}

/** A definition: the offset of its label's text and its destination as written (`""` in angle brackets, or none). @internal */
export interface ReferenceDefinition {
	readonly offset: number;
	readonly destination: string;
}

/** markdownlint's reference link and image data, keyed by normalized label, each map in markdownlint's order. @internal */
export interface ReferenceData {
	readonly references: ReadonlyMap<string, ReadonlyArray<ReferenceUse>>;
	readonly shortcuts: ReadonlyMap<string, ReadonlyArray<ReferenceUse>>;
	readonly definitions: ReadonlyMap<string, ReferenceDefinition>;
	readonly duplicates: ReadonlyArray<{ readonly label: string; readonly offset: number }>;
}

const options = MarkdownParseOptions.make({ dialect: "gfm", frontmatter: false });

const childrenOf = (node: MarkdownNode): ReadonlyArray<MarkdownNode> =>
	(node as { readonly children?: ReadonlyArray<MarkdownNode> }).children ?? [];

/** Past whitespace, and at most one line ending (and the next line's container prefix), from `at`. @internal */
export const skipSpace = (source: string, at: number, end: number): number => {
	let index = at;
	while (index < end && /[ \t]/.test(source.charAt(index))) index++;
	if (source.charAt(index) === "\r") index++;
	if (source.charAt(index) === "\n") index++;
	while (index < end && /[ \t>]/.test(source.charAt(index))) index++;
	return index;
};

/** A destination written without angle brackets, from `at`: the run up to whitespace or an unbalanced `)`. @internal */
export const rawDestination = (source: string, at: number, end: number): string => {
	let depth = 0;
	let index = at;
	while (index < end) {
		const char = source.charAt(index);
		if (char === "\\" && index + 1 < end) {
			index += 2;
			continue;
		}
		if (/\s/.test(char)) break;
		if (char === "(") depth++;
		else if (char === ")") {
			if (depth === 0) break;
			depth--;
		}
		index++;
	}
	return source.slice(at, index);
};

// A parsed text an inline walk reads: offsets in it map to the reading's source (`-1` for a character of its own).
interface View {
	readonly text: string;
	readonly toSource: (offset: number) => number;
	readonly inMath: (offset: number) => boolean;
	// Where a line's inline content starts, past its container prefix, for the line holding `offset`.
	readonly contentStart: (offset: number) => number;
}

type ShimType = "shortcut" | "collapsed" | "full";

interface Shim {
	type: ShimType;
	start: number;
	end: number;
	readonly label: string;
}

interface LabelStart {
	// Its place in the start stack, which only ever pops removed starts off its top.
	readonly index: number;
	readonly offset: number;
	readonly piece: number;
	readonly image: boolean;
	// Its link formed: resolved out of the event list.
	removed: boolean;
	// Its label end failed already.
	balanced: boolean;
	// A link formed after it, so a link can no longer: micromark's label end fails it before taking its `]`.
	inactive: boolean;
}

interface Formed {
	// Its place in micromark's token order: its offset, but just after the footnote call it wraps for an image so made.
	readonly order: number;
	readonly offset: number;
	readonly length: number;
	readonly label: string;
	readonly shortcut: boolean;
}

// One block's text as micromark's label end sees it: the data-like events, in order, and the label starts.
class BlockEvents {
	private readonly pieces: Array<string> = [];
	private readonly starts: Array<LabelStart> = [];
	// The starts neither formed nor failed, the latest on top: the one micromark's label end takes a `]` for.
	private readonly pending: Array<LabelStart> = [];
	private lastFailed = -1;
	// Every link start below this stack index is inactive already: a formed link marks only those above it.
	private inactiveBelow = 0;
	// The source offset of a `!` just pushed as data, which a `[` right after turns into an image's start.
	private bang = -1;

	constructor(private readonly shims: Array<Shim>) {}

	piece(text: string, offset = -1): void {
		this.pieces.push(text);
		this.bang = text === "!" ? offset : -1;
	}

	// Whether the last event is a `!` right before `offset`, which it then gives up to an image's start.
	takeBang(offset: number): boolean {
		if (this.bang < 0 || this.bang !== offset - 1) return false;
		this.pieces.pop();
		this.bang = -1;
		return true;
	}

	// An escape or character reference: no event, and no `!` before what follows.
	skip(): void {
		this.bang = -1;
	}

	// A label start at `offset`: a `[` right after a `!` just pushed as data is an image's (`image` says it already is).
	open(offset: number, image = false): LabelStart {
		let at = offset;
		if (!image && this.bang >= 0 && this.bang === offset - 1) {
			this.pieces.pop();
			at = this.bang;
		}
		this.bang = -1;
		const start: LabelStart = {
			index: this.starts.length,
			offset: at,
			piece: this.pieces.length,
			image: at !== offset || image,
			removed: false,
			balanced: false,
			inactive: false,
		};
		this.starts.push(start);
		this.pending.push(start);
		return start;
	}

	// A formed link or image from `start`: resolved away; a link makes every link start before it inactive.
	formed(start: LabelStart): void {
		start.removed = true;
		// The latest start not yet failed is the one a link forms from.
		if (this.pending[this.pending.length - 1] === start) this.pending.pop();
		if (start.image) return;
		for (let index = Math.min(this.inactiveBelow, start.index); index < start.index; index++) {
			const before = this.starts[index] as LabelStart;
			if (!before.image) before.inactive = true;
		}
		this.inactiveBelow = start.index;
	}

	failedClose(offset: number): void {
		let top = this.starts[this.starts.length - 1];
		while (top?.removed) {
			this.starts.pop();
			top = this.starts[this.starts.length - 1];
		}
		this.inactiveBelow = Math.min(this.inactiveBelow, this.starts.length);
		// micromark's label end takes the `]` only for the latest start not yet failed, and only when it is active.
		while (this.pending[this.pending.length - 1]?.removed) this.pending.pop();
		const pending = this.pending.pop();
		const takes = pending !== undefined && !pending.inactive;
		if (pending !== undefined) pending.balanced = true;
		if (top !== undefined) {
			// A failed `]` since the start is data in the text: it holds a `]`, and events.
			const holdsClose = this.lastFailed > top.offset;
			const events = holdsClose || this.pieces.length > top.piece;
			let type: ShimType = "shortcut";
			let start = top.offset;
			const end = takes ? offset + 1 : offset;
			const previous = this.shims[this.shims.length - 1];
			if (previous !== undefined && previous.end === top.offset) {
				if (!events) {
					previous.type = "collapsed";
					previous.end = end;
				} else {
					type = "full";
					start = previous.start;
					this.shims.pop();
				}
			}
			if (!holdsClose) {
				const label = this.pieces.slice(top.piece).join("");
				if (label.trim().length > 0 && !label.includes("]")) this.shims.push({ type, start, end, label });
			}
		}
		this.lastFailed = offset;
		this.piece("]");
	}
}

// The label text of a formed reference, `[from, to)` in `view`, its continuation lines' container prefixes left out.
const labelText = (view: View, from: number, to: number): string => {
	let text = "";
	for (let at = from; at < to; at++) {
		const char = view.text.charAt(at);
		text += char;
		if (char === "\n" || (char === "\r" && view.text.charAt(at + 1) !== "\n")) {
			const next = view.contentStart(at + 1);
			if (next > at + 1) at = next - 1;
		}
	}
	return text;
};

/**
 * markdownlint's reference link and image data over the kit tree. Inline
 * blocks micromark reads as math (a math block's lines) are none; HTML blocks
 * hold no tree. Built once per reading.
 * @internal
 */
export const referenceData: (context: LintContext) => ReferenceData = perReading((context) => {
	const { source } = context;
	const flow = mathFlowLines(context);
	const shims: Array<Shim> = [];
	const formed: Array<Formed> = [];

	// The document's definitions, as written, by normalized label, for an image label's references to resolve against.
	const definitionSources = new Map<string, string>();
	for (const node of context.document.findAll("definition") as ReadonlyArray<MarkdownNode>) {
		const start = node.position.start.offset;
		const key = normalizeLabel(source.slice(start + 1, labelEnd(source, start, node.position.end.offset)));
		if (!definitionSources.has(key)) definitionSources.set(key, `\n\n${source.slice(start, node.position.end.offset)}`);
	}

	const documentView: View = {
		text: source,
		toSource: (offset) => offset,
		inMath: inMathText(context),
		contentStart: (offset) => {
			const lineNumber = context.mapping.lineNumber(offset);
			const line = context.lines[lineNumber - 1] ?? "";
			const content = contentInContainers(context, lineNumber) ?? line;
			return context.mapping.lineStart(lineNumber) + line.length - content.length;
		},
	};

	// The text from `from` to `to` in `view` as plain inline text: data, escapes and character references (no
	// events), line endings (the next line's container prefix and leading whitespace no events either), label starts
	// and failed label ends.
	const scanText = (view: View, events: BlockEvents, from: number, to: number): void => {
		const { text } = view;
		for (let at = from; at < to; at++) {
			const char = text.charAt(at);
			if (view.inMath(at)) {
				events.piece(char);
				continue;
			}
			if (char === "\\" && /[!-/:-@[-`{-~]/.test(text.charAt(at + 1))) {
				at++;
				events.skip();
				continue;
			}
			if (char === "&") {
				const reference = characterReference.exec(text.slice(at, Math.min(to, at + 40)))?.[0];
				if (reference !== undefined && isReference(reference)) {
					at += reference.length - 1;
					events.skip();
					continue;
				}
			}
			if (char === "\r" || char === "\n") {
				if (char === "\r" && text.charAt(at + 1) === "\n") at++;
				events.piece("\n");
				let next = Math.max(at + 1, view.contentStart(at + 1));
				while (next < to && /[ \t]/.test(text.charAt(next))) next++;
				at = Math.min(next, to) - 1;
				continue;
			}
			if (char === "[") events.open(view.toSource(at));
			else if (char === "]") events.failedClose(view.toSource(at));
			else events.piece(char, view.toSource(at));
		}
	};

	const visit = (view: View, events: BlockEvents, node: MarkdownNode): void => {
		const { text } = view;
		const start = node.position.start.offset;
		const end = node.position.end.offset;
		const children = childrenOf(node);
		if (node.type !== "text" && view.inMath(start)) {
			events.piece(text.slice(start, end));
			return;
		}
		switch (node.type) {
			case "text":
				scanText(view, events, start, end);
				return;
			case "inlineCode":
			case "html":
				events.piece(text.slice(start, end));
				return;
			case "break":
				events.piece("\n");
				return;
			case "footnoteReference": {
				const offset = view.toSource(start);
				const length = view.toSource(end - 1) + 1 - offset;
				const label = `^${labelText(view, start + 2, end - 1)}`;
				formed.push({ order: offset, offset, length, label, shortcut: true });
				// `![^1]`: micromark makes the `!` and the call an image, a shortcut, its token after the call's.
				if (events.takeBang(offset)) {
					formed.push({ order: offset + 0.5, offset: offset - 1, length: length + 1, label, shortcut: true });
				}
				return;
			}
			case "link":
			case "linkReference": {
				const opener = text.charAt(start);
				if (opener === "<") {
					events.piece(text.slice(start, end));
					return;
				}
				if (opener !== "[") {
					scanText(view, events, start, end);
					return;
				}
				const label = events.open(view.toSource(start));
				const close = labelEnd(text, start, end);
				record(view, node, start, end, close);
				for (const child of children) visit(view, events, child);
				events.formed(label);
				return;
			}
			case "image":
			case "imageReference": {
				const label = events.open(view.toSource(start), true);
				const close = labelEnd(text, start + 1, end);
				record(view, node, start, end, close);
				readAlt(view, events, start + 1, close);
				events.formed(label);
				return;
			}
			default:
				if (children.length === 0) {
					scanText(view, events, start, end);
					return;
				}
				// Emphasis, strong and strikethrough: their delimiters are data (markdownlint reads no strikethrough).
				scanText(view, events, start, (children[0] as MarkdownNode).position.start.offset);
				for (const child of children) visit(view, events, child);
				scanText(view, events, (children[children.length - 1] as MarkdownNode).position.end.offset, end);
		}
	};

	// A formed reference: a link or image reference's label, or its reference's for a full one.
	const record = (view: View, node: MarkdownNode, start: number, end: number, close: number): void => {
		const referenceType = (node as { readonly referenceType?: string }).referenceType;
		if (referenceType === undefined) return;
		const opener = node.type === "imageReference" ? 2 : 1;
		const label =
			referenceType === "full" ? labelText(view, close + 2, end - 1) : labelText(view, start + opener, close);
		const offset = view.toSource(start);
		formed.push({
			order: offset,
			offset,
			length: view.toSource(end - 1) + 1 - offset,
			label,
			shortcut: referenceType === "shortcut",
		});
	};

	// An image's label, re-parsed after its own `[` as a paragraph (the kit's image carries its alt as a string), with
	// the definitions its own brackets name, its continuation lines' container prefixes left out.
	const readAlt = (view: View, events: BlockEvents, open: number, close: number): void => {
		let label = "";
		const offsets: Array<number> = [view.toSource(open)];
		for (let at = open + 1; at < close; at++) {
			const char = view.text.charAt(at);
			label += char;
			offsets.push(view.toSource(at));
			if (char === "\n" || (char === "\r" && view.text.charAt(at + 1) !== "\n")) {
				const next = view.contentStart(at + 1);
				if (next > at + 1) at = next - 1;
			}
		}
		let named = "";
		for (const match of label.matchAll(/\[([^[\]]*)\]/g)) {
			named += definitionSources.get(normalizeLabel(match[1] ?? "")) ?? "";
		}
		const text = `[${label}${named}`;
		const parsed = MarkdownDocument.parseResult(text, options);
		if (!Result.isSuccess(parsed)) return;
		const document = parsed.success;
		const inMath = mathCheck(document, text);
		const altView: View = {
			text,
			toSource: (offset) => offsets[offset] ?? -1,
			inMath,
			contentStart: (offset) => offset,
		};
		const paragraph = childrenOf(document.root as MarkdownNode)[0];
		if (paragraph === undefined) return;
		for (const child of childrenOf(paragraph)) {
			if (child.position.start.offset >= label.length + 1) break;
			if (child.type === "text" && child.position.start.offset === 0) {
				scanText(altView, events, 1, Math.min(child.position.end.offset, label.length + 1));
			} else visit(altView, events, child);
		}
	};

	// A paragraph opening with a leaf or container directive line (`::name[label]{attributes}`, `:::name...`), which
	// markdownlint parses (its directive extension, inline directives off): that line is no text.
	const directive = /^:{2,}[A-Za-z][\w-]*(?:\[[^\]\r\n]*\])?(?:\{[^}\r\n]*\})?[ \t]*$/;
	const directiveEnd = (block: MarkdownNode): number => {
		const start = block.position.start.offset;
		const lineEnd = source.slice(start, block.position.end.offset).search(/[\r\n]/);
		const end = lineEnd < 0 ? block.position.end.offset : start + lineEnd;
		return block.type === "paragraph" && directive.test(source.slice(start, end)) ? end : start;
	};

	const blocks = context.document.findAll(
		(node) =>
			node.type === "paragraph" || node.type === "heading" || node.type === "tableCell" || node.type === "listItem",
	) as ReadonlyArray<MarkdownNode>;
	let checkbox: { readonly from: number; readonly to: number } | undefined;
	for (const block of blocks) {
		if (block.type === "listItem") {
			// A task list item's checkbox, which markdownlint reads as text of the item's first paragraph.
			const checked = (block as { readonly checked?: boolean | null }).checked;
			const first = childrenOf(block)[0];
			if (checked === true || checked === false) {
				const to = first?.position.start.offset ?? block.position.end.offset;
				const at = source.lastIndexOf("[", to - 1);
				checkbox = at >= block.position.start.offset ? { from: at, to } : undefined;
			}
			continue;
		}
		if (flow.has(block.position.start.line)) continue;
		const events = new BlockEvents(shims);
		if (checkbox !== undefined && checkbox.to === block.position.start.offset) {
			scanText(documentView, events, checkbox.from, checkbox.to);
		}
		checkbox = undefined;
		const from = directiveEnd(block);
		for (const child of childrenOf(block)) {
			if (child.position.end.offset <= from) continue;
			if (child.position.start.offset < from) {
				if (child.type === "text") scanText(documentView, events, from, child.position.end.offset);
				continue;
			}
			visit(documentView, events, child);
		}
	}

	const references = new Map<string, Array<ReferenceUse>>();
	const shortcuts = new Map<string, Array<ReferenceUse>>();
	const add = (label: string, use: ReferenceUse, shortcut: boolean) => {
		const dictionary = shortcut ? shortcuts : references;
		const key = normalizeLabel(label);
		const uses = dictionary.get(key) ?? [];
		uses.push(use);
		dictionary.set(key, uses);
	};
	for (const use of formed.sort((a, b) => a.order - b.order)) {
		add(use.label, { offset: use.offset, length: use.length }, use.shortcut);
	}
	for (const shim of shims)
		add(shim.label, { offset: shim.start, length: shim.end - shim.start }, shim.type === "shortcut");

	const definitions = new Map<string, ReferenceDefinition>();
	const duplicates: Array<{ readonly label: string; readonly offset: number }> = [];
	for (const node of context.document.findAll(
		(each) => each.type === "definition" || each.type === "footnoteDefinition",
	) as ReadonlyArray<MarkdownNode>) {
		if (flow.has(node.position.start.line)) continue;
		const start = node.position.start.offset;
		const end = node.position.end.offset;
		const footnote = node.type === "footnoteDefinition";
		const close = labelEnd(source, start, end);
		const offset = start + (footnote ? 2 : 1);
		const label = normalizeLabel(`${footnote ? "^" : ""}${source.slice(offset, close)}`);
		if (definitions.has(label)) {
			duplicates.push({ label, offset });
			continue;
		}
		let destination = "";
		if (!footnote) {
			const at = skipSpace(source, close + 2, end);
			destination = source.charAt(at) === "<" ? "" : rawDestination(source, at, end);
		}
		definitions.set(label, { offset, destination });
	}
	return { references, shortcuts, definitions, duplicates };
});
