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

import type { Image, ImageReference, MarkdownNode } from "@effected/markdown";
import { MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import { Result } from "effect";
import type { LintContext } from "../LintContext.js";
import { contentInContainers } from "./containers.js";
import { paragraphBreaks } from "./directives.js";
import type { NestedImage } from "./inline.js";
import {
	characterReference,
	imageLabelEnd,
	inMathText,
	isReference,
	labelDefinitions,
	labelSource,
	mathCheck,
	nestedImages,
} from "./inline.js";
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

/**
 * One autolink, link or image markdownlint's MD054 reads, as written: an inline one's destination and title strings
 * (absent when empty, as micromark makes no string token), a reference's raw label and reference string. A `link`
 * or `image` with no destination string reads as a reference of its own kind (`shortcut` for an empty resource).
 * @internal
 */
export interface Medium {
	readonly kind: "autolink" | "inline" | "full" | "collapsed" | "shortcut";
	readonly image: boolean;
	readonly start: number;
	readonly end: number;
	readonly label: string;
	readonly destination?: string;
	// An inline one's destination string, in source offsets (its `<>` left out).
	readonly destinationStart?: number;
	readonly destinationEnd?: number;
	readonly title?: string;
	readonly reference?: string;
}

/** markdownlint's reference link and image data, keyed by normalized label, each map in markdownlint's order. @internal */
export interface ReferenceData {
	readonly references: ReadonlyMap<string, ReadonlyArray<ReferenceUse>>;
	readonly shortcuts: ReadonlyMap<string, ReadonlyArray<ReferenceUse>>;
	readonly definitions: ReadonlyMap<string, ReferenceDefinition>;
	readonly duplicates: ReadonlyArray<{ readonly label: string; readonly offset: number }>;
	/** Every autolink, link and image, in micromark's token order (an image before what its label holds). */
	readonly media: ReadonlyArray<Medium>;
	/** Every link reference definition's source span, duplicates included, in document order. */
	readonly definitionSpans: ReadonlyArray<{ readonly start: number; readonly end: number }>;
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

// Past whitespace and line endings (and each next line's container prefix) from `at`.
const skipBlank = (text: string, at: number, end: number): number => {
	let index = at;
	while (index < end && /[ \t\r\n>]/.test(text.charAt(index))) index++;
	return index;
};

// An inline link's resource from its `(` at `open`, as micromark's string tokens hold it: the destination (inside
// `<>` or raw) and the title (inside its quotes or parentheses), each absent when empty.
const resource = (
	text: string,
	open: number,
	end: number,
): { destination?: string; destinationStart?: number; title?: string } => {
	if (text.charAt(open) !== "(") return {};
	let at = skipBlank(text, open + 1, end);
	let destination: string;
	let destinationStart: number;
	if (text.charAt(at) === "<") {
		let stop = at + 1;
		while (stop < end && text.charAt(stop) !== ">") stop += text.charAt(stop) === "\\" ? 2 : 1;
		destination = text.slice(at + 1, stop);
		destinationStart = at + 1;
		at = stop + 1;
	} else {
		destination = rawDestination(text, at, end);
		destinationStart = at;
		at += destination.length;
	}
	at = skipBlank(text, at, end);
	const quote = text.charAt(at);
	const closer = quote === "(" ? ")" : quote;
	let title: string | undefined;
	if (quote === '"' || quote === "'" || quote === "(") {
		let stop = at + 1;
		while (stop < end && text.charAt(stop) !== closer) stop += text.charAt(stop) === "\\" ? 2 : 1;
		title = text.slice(at + 1, stop);
	}
	return {
		...(destination === "" ? {} : { destination, destinationStart }),
		...(title === undefined || title === "" ? {} : { title }),
	};
};

// A parsed text an inline walk reads: offsets in it map to the reading's source (`-1` for a character of its own).
interface View {
	readonly text: string;
	readonly toSource: (offset: number) => number;
	readonly inMath: (offset: number) => boolean;
	// Where a line's inline content starts, past its container prefix, for the line holding `offset`.
	readonly contentStart: (offset: number) => number;
	// For an image label's view, the images nested in the label, by the source offset of their label's `[`.
	readonly nested?: ReadonlyMap<number, NestedImage>;
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
	const media: Array<Medium> = [];

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

	// `visit` runs on an explicit stack, not the call stack: images nest as deep as the input. A node's step does its
	// work in order, visiting a child or deferring a closing action (`later`) onto the step's frame; the driver runs the
	// frame's tasks in that order, each before the task after it, exactly as the recursion did.
	let frame: Array<() => void> | undefined;
	const later = (task: () => void): void => {
		(frame as Array<() => void>).push(task);
	};
	const visit = (view: View, events: BlockEvents, node: MarkdownNode): void => {
		const task = () => step(view, events, node);
		if (frame !== undefined) {
			frame.push(task);
			return;
		}
		const stack: Array<() => void> = [task];
		for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
			const own: Array<() => void> = [];
			frame = own;
			try {
				next();
			} finally {
				frame = undefined;
			}
			for (let index = own.length - 1; index >= 0; index--) stack.push(own[index] as () => void);
		}
	};

	const step = (view: View, events: BlockEvents, node: MarkdownNode): void => {
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
					const from = view.toSource(start);
					const to = view.toSource(end - 1) + 1;
					const destination = source.slice(from + 1, to - 1);
					media.push({ kind: "autolink", image: false, start: from, end: to, label: destination, destination });
					return;
				}
				if (opener !== "[") {
					scanText(view, events, start, end);
					return;
				}
				const label = events.open(view.toSource(start));
				const close = labelEnd(text, start, end);
				record(view, node, start, end, close);
				medium(view, node, start, end, close);
				for (const child of children) visit(view, events, child);
				later(() => events.formed(label));
				return;
			}
			case "image":
			case "imageReference": {
				const label = events.open(view.toSource(start), true);
				// The kit's node: this one in the reading, or the one the label holding it names. A nested label's text
				// is its own when the label holding it was read with it left out (see `labelSource`). The reading's own
				// image ends its label where the kit's parse did, past any `]` in a code span in it.
				const reading = view === documentView;
				const close = reading ? imageLabelEnd(context, node as Image | ImageReference) : labelEnd(text, start + 1, end);
				const open = view.toSource(start + 1);
				const inner = view.nested?.get(open);
				const original = reading ? node : inner?.node;
				const nested = nestedImages(context, original);
				const own = labelSource(context, open, inner?.close ?? view.toSource(close), nested);
				record(view, node, start, end, close);
				medium(view, node, start, end, close, inner?.masked === true ? writtenLabel(own) : undefined);
				readAlt(own, nested, events);
				later(() => events.formed(label));
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
				later(() => scanText(view, events, (children[children.length - 1] as MarkdownNode).position.end.offset, end));
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

	// The source of `[from, to)` in `view`, as written.
	const written = (view: View, from: number, to: number): string =>
		to > from ? source.slice(view.toSource(from), view.toSource(to - 1) + 1) : "";

	// A link or image as MD054 reads it: an inline one's resource parsed from its source, a reference's label and
	// reference as written.
	const medium = (view: View, node: MarkdownNode, start: number, end: number, close: number, own?: string): void => {
		const image = node.type === "image" || node.type === "imageReference";
		const from = view.toSource(start);
		const to = view.toSource(end - 1) + 1;
		const label = own ?? written(view, start + (image ? 2 : 1), close);
		const referenceType = (node as { readonly referenceType?: string }).referenceType;
		if (referenceType === "full") {
			media.push({ kind: "full", image, start: from, end: to, label, reference: written(view, close + 2, end - 1) });
			return;
		}
		if (referenceType === "collapsed" || referenceType === "shortcut") {
			media.push({ kind: referenceType, image, start: from, end: to, label });
			return;
		}
		const { destination, destinationStart, title } = resource(view.text, close + 1, end);
		if (destination === undefined || destinationStart === undefined) {
			media.push({ kind: "shortcut", image, start: from, end: to, label });
			return;
		}
		media.push({
			kind: "inline",
			image,
			start: from,
			end: to,
			label,
			destination,
			destinationStart: view.toSource(destinationStart),
			destinationEnd: view.toSource(destinationStart + destination.length - 1) + 1,
			...(title === undefined ? {} : { title }),
		});
	};

	// A masked image's label as written: the source from its first character to its last, as its own label's text
	// reads them (see `labelSource`).
	const writtenLabel = (own: { readonly text: string; readonly offsets: ReadonlyArray<number> }): string =>
		own.text.length > 2 ? source.slice(own.offsets[1] as number, (own.offsets[own.text.length - 2] as number) + 1) : "";

	// An image's label, re-parsed after its own `[` as a paragraph (the kit's image carries its alt as a string), with
	// a stand-in for each definition its own brackets name (see `labelDefinitions`): `own` is its text and offsets,
	// its continuation lines' container prefixes and the labels of the images `nested` masks left out (see
	// `labelSource`), so each level of a chain of nested images re-parses its own characters only.
	const readAlt = (
		own: { readonly text: string; readonly offsets: ReadonlyArray<number> },
		nested: ReadonlyMap<number, NestedImage>,
		events: BlockEvents,
	): void => {
		const label = own.text.slice(1, -1);
		const { offsets } = own;
		const text = `[${label}${labelDefinitions(label, context.document.definitions)}`;
		const parsed = MarkdownDocument.parseResult(text, options);
		if (!Result.isSuccess(parsed)) return;
		const document = parsed.success;
		const inMath = mathCheck(document, text);
		const altView: View = {
			text,
			toSource: (offset) => offsets[offset] ?? -1,
			inMath,
			contentStart: (offset) => offset,
			nested,
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

	// Where micromark ends a paragraph inside one of the kit's and starts another past the line (a directive line, a
	// math block's lines; see `paragraphBreaks`), the kit's paragraph is read as those segments: each scanned alone,
	// and one after a break opening with link reference definitions, which micromark reads there and the kit's parser,
	// reading paragraph text, does not.
	const breaks = paragraphBreaks(context);
	const extraDefinitions: Array<{ readonly start: number; readonly end: number }> = [];
	const lineEnd = (lineNumber: number) =>
		context.mapping.lineStart(lineNumber) + (context.lines[lineNumber - 1] ?? "").length;
	const contentPrefix = (lineNumber: number) => {
		const line = context.lines[lineNumber - 1] ?? "";
		const content = contentInContainers(context, lineNumber) ?? line.replace(/^(?:[ \t]{0,3}>[ \t]?)*/, "");
		return line.length - content.length;
	};
	// The definitions opening the paragraph on lines `[first, last]`, in source offsets, and the line after them.
	const leadingDefinitions = (first: number, last: number): number => {
		const starts: Array<number> = [];
		let text = "";
		for (let line = first; line <= last; line++) {
			starts.push(text.length);
			text += `${(context.lines[line - 1] ?? "").slice(contentPrefix(line))}\n`;
		}
		if (!text.trimStart().startsWith("[")) return first;
		const parsed = MarkdownDocument.parseResult(text, options);
		if (!Result.isSuccess(parsed)) return first;
		const toSource = (offset: number) => {
			let index = starts.length - 1;
			while (index > 0 && (starts[index] as number) > offset) index--;
			const line = first + index;
			return context.mapping.lineStart(line) + contentPrefix(line) + offset - (starts[index] as number);
		};
		let next = first;
		for (const node of childrenOf(parsed.success.root as MarkdownNode)) {
			if (node.type !== "definition") break;
			const start = toSource(node.position.start.offset);
			const end = toSource(node.position.end.offset - 1) + 1;
			extraDefinitions.push({ start, end });
			next = context.mapping.lineNumber(end - 1) + 1;
		}
		return next;
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
		const startLine = block.position.start.line;
		const endLine = block.position.end.line;
		// The segments of the block micromark reads as paragraphs: runs of lines no break holds. A setext heading's text
		// is paragraph text to both parsers until its underline, and a break inside it splits it as a paragraph's does
		// (micromark's heading is the last segment).
		const segments: Array<{ readonly first: number; readonly last: number; readonly opens: boolean }> = [];
		if (block.type === "paragraph" || (block as { readonly headingStyle?: string }).headingStyle === "setext") {
			let first: number | undefined;
			let opens = false;
			for (let line = startLine; line <= endLine + 1; line++) {
				if (line <= endLine && !breaks.has(line)) {
					first ??= line;
					continue;
				}
				if (first !== undefined) segments.push({ first, last: line - 1, opens });
				first = undefined;
				opens = true;
			}
		} else if (!flow.has(startLine)) segments.push({ first: startLine, last: endLine, opens: false });
		for (const [index, segment] of segments.entries()) {
			const firstLine = segment.opens ? leadingDefinitions(segment.first, segment.last) : segment.first;
			if (firstLine > segment.last) continue;
			const from =
				index === 0 && firstLine === startLine
					? block.position.start.offset
					: context.mapping.lineStart(firstLine) + contentPrefix(firstLine);
			const to = segment.last === endLine ? block.position.end.offset : lineEnd(segment.last);
			const events = new BlockEvents(shims);
			if (index === 0 && checkbox !== undefined && checkbox.to === block.position.start.offset) {
				scanText(documentView, events, checkbox.from, checkbox.to);
			}
			for (const child of childrenOf(block)) {
				const start = child.position.start.offset;
				const end = child.position.end.offset;
				if (end <= from || start >= to) continue;
				if (start >= from && end <= to) visit(documentView, events, child);
				else if (child.type === "text") scanText(documentView, events, Math.max(start, from), Math.min(end, to));
			}
		}
		checkbox = undefined;
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
	const spans: Array<{ readonly start: number; readonly end: number; readonly footnote: boolean }> = [];
	for (const node of context.document.findAll(
		(each) => each.type === "definition" || each.type === "footnoteDefinition",
	) as ReadonlyArray<MarkdownNode>) {
		if (flow.has(node.position.start.line)) continue;
		spans.push({
			start: node.position.start.offset,
			end: node.position.end.offset,
			footnote: node.type === "footnoteDefinition",
		});
	}
	for (const extra of extraDefinitions) spans.push({ ...extra, footnote: false });
	spans.sort((a, b) => a.start - b.start);
	const definitionSpans: Array<{ readonly start: number; readonly end: number }> = [];
	for (const { start, end, footnote } of spans) {
		if (!footnote) definitionSpans.push({ start, end });
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
	// A reference the kit's parser left as text because the definition it names is one the kit reads as paragraph text
	// (see `leadingDefinitions`) is a link or image to micromark, which reads that definition: MD054 reads it too.
	if (extraDefinitions.length > 0) {
		const recovered = new Set(
			extraDefinitions.map(({ start, end }) => normalizeLabel(source.slice(start + 1, labelEnd(source, start, end)))),
		);
		for (const shim of shims) {
			if (!recovered.has(normalizeLabel(shim.label))) continue;
			const image = source.charAt(shim.start) === "!";
			const open = shim.start + (image ? 1 : 0);
			const close = labelEnd(source, open, shim.end);
			const label = source.slice(open + 1, close);
			const kind = shim.type;
			media.push({
				kind,
				image,
				start: shim.start,
				end: shim.end,
				label,
				...(kind === "full" ? { reference: shim.label } : {}),
			});
		}
		media.sort((a, b) => a.start - b.start);
	}
	return { references, shortcuts, definitions, duplicates, media, definitionSpans };
});
