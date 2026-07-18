// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// The inline pass: upstream's `InlineParser`, including `processEmphasis` —
// the delimiter-stack algorithm the whole design rests on, since it is what
// makes emphasis linear-time instead of the quadratic blowup that is
// markdown's DoS vector.
//
// Port notes, four changes from upstream:
//
// 1. Positions. Upstream's inline nodes inherit their leaf block's sourcepos
//    and have no offsets of their own. Every node built here is positioned
//    through the segment table (`segments.ts`), so an inline node inside a
//    twice-indented blockquote still points at the right characters in the
//    ORIGINAL source.
// 2. Adjacent text nodes merge at materialization. Upstream emits one per run
//    and lets its renderer concatenate; mdast wants one node per contiguous
//    run, and merging late rather than eagerly keeps `processEmphasis` free to
//    truncate a delimiter's text node in place.
// 3. Dispatch is a per-dialect trigger table rather than a `switch`
//    (`inlineRegistry.ts`).
// 4. Smart punctuation is not ported at all, so `'` and `"` never reach the
//    delimiter stack and the two `openers_bottom` slots they use stay unused
//    (the 14-slot layout is kept so the index arithmetic matches upstream's).
//
// Recursion surfaces, for the hardening enumeration: the delimiter stack and
// the bracket stack are ITERATIVE and deliberately unguarded — that is the
// point of the algorithm. What recurses is `materialize`, over the node tree
// those stacks build, and it shares the block pass's depth cap: emphasis can
// nest as deeply as the input has balanced delimiters.
//
// Imports node classes from `../MarkdownNode.js` (the sanctioned exception to
// the cycle firewall) and nothing else public.

import type { Definition, PhrasingContent, Position } from "../MarkdownNode.js";
import {
	Break,
	Emphasis,
	Html,
	Image,
	ImageReference,
	InlineCode,
	Link,
	LinkReference,
	Strong,
	Text,
} from "../MarkdownNode.js";
import { GuardExceeded } from "./carriers.js";
import type { InlineNode } from "./inlineNode.js";
import { appendChild, childrenOf, insertAfter, makeInlineNode, unlink } from "./inlineNode.js";
import type { InlineDialectName } from "./inlineRegistry.js";
import { inlineDialect } from "./inlineRegistry.js";
import type { Bracket, Delimiter, InlineDialect, InlineScanner, InlineSource } from "./inlineTypes.js";
import { MAX_NESTING_DEPTH } from "./limits.js";
import { globalOf, stickyOf } from "./patterns.js";
import { sourceOffsetAt } from "./segments.js";

const C_UNDERSCORE = 0x5f;
const C_ASTERISK = 0x2a;

const reTrailingSpaces = / +$/;

const C_BACKTICK = 0x60;

/**
 * Every backtick run in `subject`, as start offsets grouped by run length.
 *
 * One forward scan, so a code span's search for its closing run is a binary
 * search rather than a walk over every run in between.
 */
const indexBacktickRuns = (subject: string): Map<number, number[]> => {
	const runs = new Map<number, number[]>();
	let index = 0;
	while (index < subject.length) {
		if (subject.charCodeAt(index) !== C_BACKTICK) {
			index += 1;
			continue;
		}
		const start = index;
		while (index < subject.length && subject.charCodeAt(index) === C_BACKTICK) {
			index += 1;
		}
		const length = index - start;
		const starts = runs.get(length);
		if (starts === undefined) {
			runs.set(length, [start]);
		} else {
			starts.push(start);
		}
	}
	return runs;
};

/**
 * Builds a {@link Position} from an absolute source range. The block pass owns
 * the line index, so it supplies this rather than the inline pass building a
 * second one.
 */
type PositionOf = (startOffset: number, endOffset: number) => Position;

class InlineParser implements InlineScanner {
	readonly subject: string;
	pos = 0;
	readonly refmap: ReadonlyMap<string, Definition>;
	delimiters: Delimiter | undefined;
	brackets: Bracket | undefined;

	/** How many link openers on the stack are still active (see `deactivateLinkOpeners`). */
	private activeLinkOpeners = 0;
	/** Per-needle memo of the offset from which it no longer occurs. */
	private readonly absentAfter = new Map<string, number>();
	/** Backtick run starts, by run length; built on first use. */
	private backtickRuns: Map<number, number[]> | undefined;

	private readonly source: InlineSource;
	private readonly dialect: InlineDialect;
	private readonly positionOf: PositionOf;
	/** The output list's root; only ever a container for the children. */
	private readonly root: InlineNode;

	constructor(
		source: InlineSource,
		dialect: InlineDialect,
		positionOf: PositionOf,
		refmap: ReadonlyMap<string, Definition>,
	) {
		this.source = source;
		this.subject = source.text;
		this.dialect = dialect;
		this.positionOf = positionOf;
		this.refmap = refmap;
		this.root = makeInlineNode("text", 0, source.text.length);
	}

	// --- cursor -------------------------------------------------------------

	peek(): number {
		return this.pos < this.subject.length ? this.subject.charCodeAt(this.pos) : -1;
	}

	/**
	 * Match `pattern` AT the cursor, advancing past it on success.
	 *
	 * A match that starts later is not a match: every construct here asks
	 * "does this begin at the cursor". Upstream adds `m.index` to its position
	 * instead, which is safe only because its dispatch guarantees index zero —
	 * a guarantee the trigger table does not make (see `inlines/text.ts`).
	 */
	match(pattern: RegExp): string | undefined {
		const sticky = stickyOf(pattern);
		sticky.lastIndex = this.pos;
		const found = sticky.exec(this.subject);
		if (found === null) {
			return undefined;
		}
		this.pos = sticky.lastIndex;
		return found[0];
	}

	matchAhead(pattern: RegExp): string | undefined {
		const forward = globalOf(pattern);
		forward.lastIndex = this.pos;
		const found = forward.exec(this.subject);
		if (found === null) {
			return undefined;
		}
		this.pos = found.index + found[0].length;
		return found[0];
	}

	hasAhead(needle: string): boolean {
		const known = this.absentAfter.get(needle);
		if (known !== undefined && this.pos >= known) {
			return false;
		}
		if (this.subject.indexOf(needle, this.pos) !== -1) {
			return true;
		}
		this.absentAfter.set(needle, Math.min(known ?? this.pos, this.pos));
		return false;
	}

	closingBacktickRun(from: number, length: number): number | undefined {
		if (this.backtickRuns === undefined) {
			this.backtickRuns = indexBacktickRuns(this.subject);
		}
		const starts = this.backtickRuns.get(length);
		if (starts === undefined) {
			return undefined;
		}

		// Binary search for the first run starting at or after `from`.
		let low = 0;
		let high = starts.length;
		while (low < high) {
			const mid = (low + high) >> 1;
			if ((starts[mid] ?? 0) < from) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}
		return starts[low];
	}

	// --- output list --------------------------------------------------------

	append(node: InlineNode): void {
		appendChild(this.root, node);
	}

	appendText(value: string, from: number, to: number): InlineNode {
		const node = makeInlineNode("text", from, to, value);
		appendChild(this.root, node);
		return node;
	}

	lastChild(): InlineNode | undefined {
		return this.root.lastChild;
	}

	trimTrailingSpaces(): number {
		const last = this.root.lastChild;
		if (last === undefined || last.type !== "text") {
			return 0;
		}

		const trimmed = last.value.replace(reTrailingSpaces, "");
		const removed = last.value.length - trimmed.length;
		if (removed === 0) {
			return 0;
		}

		if (trimmed.length === 0) {
			unlink(last);
			return removed;
		}

		last.value = trimmed;
		last.end = Math.max(last.end - removed, last.start);
		return removed;
	}

	// --- stacks -------------------------------------------------------------

	removeDelimiter(delimiter: Delimiter): void {
		if (delimiter.previous !== undefined) {
			delimiter.previous.next = delimiter.next;
		}
		if (delimiter.next === undefined) {
			this.delimiters = delimiter.previous;
		} else {
			delimiter.next.previous = delimiter.previous;
		}
	}

	private removeDelimitersBetween(bottom: Delimiter, top: Delimiter): void {
		if (bottom.next !== top) {
			bottom.next = top;
			top.previous = bottom;
		}
	}

	addBracket(node: InlineNode, index: number, image: boolean): void {
		if (this.brackets !== undefined) {
			this.brackets.bracketAfter = true;
		}
		this.brackets = {
			node,
			previous: this.brackets,
			previousDelimiter: this.delimiters,
			index,
			image,
			active: true,
		};
		if (!image) {
			this.activeLinkOpeners += 1;
		}
	}

	removeBracket(): void {
		const popped = this.brackets;
		if (popped !== undefined && !popped.image && popped.active) {
			this.activeLinkOpeners -= 1;
		}
		this.brackets = popped?.previous;
	}

	deactivateLinkOpeners(): void {
		// The fast path is the point. Upstream walks the whole bracket stack
		// here on every link close; image openers are never popped, so a
		// document like `![[]()` repeated accumulates them and the walk turns
		// quadratic — 160k repetitions of that shape did not terminate. The
		// counter makes the common case (nothing left to deactivate) O(1)
		// while the walk itself stays exactly upstream's.
		if (this.activeLinkOpeners === 0) {
			return;
		}
		for (let opener = this.brackets; opener !== undefined; opener = opener.previous) {
			if (!opener.image && opener.active) {
				opener.active = false;
				this.activeLinkOpeners -= 1;
			}
		}
	}

	/**
	 * Pair up the delimiter stack above `stackBottom` into emphasis and strong
	 * nodes — upstream's `processEmphasis`, including the two rules that make
	 * the algorithm terminate in linear time: `openers_bottom`, which records
	 * how far back a failed search already looked, and the multiple-of-three
	 * rule for runs that can both open and close.
	 */
	processEmphasis(stackBottom: Delimiter | undefined): void {
		// One lower bound per (character, can-open, length mod 3) combination.
		// Slots 0 and 1 belong to upstream's smart quotes and stay unused.
		const openersBottom: Array<Delimiter | undefined> = new Array(14).fill(stackBottom);

		let closer = this.delimiters;
		while (closer !== undefined && closer.previous !== stackBottom) {
			closer = closer.previous;
		}

		while (closer !== undefined) {
			if (!closer.canClose) {
				closer = closer.next;
				continue;
			}

			const closercc = closer.cc;
			const openersBottomIndex =
				(closercc === C_UNDERSCORE ? 2 : 8) + (closer.canOpen ? 3 : 0) + (closer.origdelims % 3);

			let opener = closer.previous;
			let openerFound = false;
			while (opener !== undefined && opener !== stackBottom && opener !== openersBottom[openersBottomIndex]) {
				// The multiple-of-three rule: a run that can both open and
				// close cannot pair when the two lengths sum to a multiple of
				// three unless both are themselves multiples of three.
				const oddMatch =
					(closer.canOpen || opener.canClose) &&
					closer.origdelims % 3 !== 0 &&
					(opener.origdelims + closer.origdelims) % 3 === 0;
				if (opener.cc === closer.cc && opener.canOpen && !oddMatch) {
					openerFound = true;
					break;
				}
				opener = opener.previous;
			}

			const oldCloser = closer;

			if (closercc === C_ASTERISK || closercc === C_UNDERSCORE) {
				if (!openerFound || opener === undefined) {
					closer = closer.next;
				} else {
					// Two delimiters make strong emphasis, one makes emphasis.
					const useDelims = closer.numdelims >= 2 && opener.numdelims >= 2 ? 2 : 1;
					const openerNode = opener.node;
					const closerNode = closer.node;

					opener.numdelims -= useDelims;
					closer.numdelims -= useDelims;
					openerNode.value = openerNode.value.slice(0, openerNode.value.length - useDelims);
					openerNode.end -= useDelims;
					closerNode.value = closerNode.value.slice(0, closerNode.value.length - useDelims);
					closerNode.start += useDelims;

					const emphasis = makeInlineNode(useDelims === 1 ? "emphasis" : "strong", openerNode.end, closerNode.start);
					emphasis.data.markerChar = closercc === C_UNDERSCORE ? "_" : "*";

					let between = openerNode.next;
					while (between !== undefined && between !== closerNode) {
						const following = between.next;
						appendChild(emphasis, between);
						between = following;
					}

					insertAfter(openerNode, emphasis);
					this.removeDelimitersBetween(opener, closer);

					if (opener.numdelims === 0) {
						unlink(openerNode);
						this.removeDelimiter(opener);
					}

					if (closer.numdelims === 0) {
						unlink(closerNode);
						const next = closer.next;
						this.removeDelimiter(closer);
						closer = next;
					}
				}
			} else {
				closer = closer.next;
			}

			if (!openerFound) {
				// Nothing above this point can ever match this closer, so future
				// searches stop here.
				openersBottom[openersBottomIndex] = oldCloser.previous;
				if (!oldCloser.canOpen) {
					this.removeDelimiter(oldCloser);
				}
			}
		}

		while (this.delimiters !== undefined && this.delimiters !== stackBottom) {
			this.removeDelimiter(this.delimiters);
		}
	}

	// --- positions and materialization --------------------------------------

	private offsetAt(index: number): number {
		return sourceOffsetAt(this.source.segments, index, this.source.startOffset);
	}

	private position(from: number, to: number): Position {
		const start = this.offsetAt(from);
		return this.positionOf(start, Math.max(this.offsetAt(to), start));
	}

	/**
	 * Turn the mutable list into mdast nodes, coalescing adjacent text runs.
	 *
	 * Depth is emphasis nesting, which the input controls, so the same cap the
	 * block pass applies to containers applies here.
	 */
	private materialize(parent: InlineNode, depth: number): ReadonlyArray<PhrasingContent> {
		if (depth > MAX_NESTING_DEPTH) {
			throw new GuardExceeded("NestingDepthExceeded", MAX_NESTING_DEPTH, depth, this.offsetAt(parent.start));
		}

		const children: PhrasingContent[] = [];
		let pendingText: InlineNode | undefined;

		const flushText = (): void => {
			if (pendingText === undefined) {
				return;
			}
			if (pendingText.value.length > 0) {
				children.push(
					Text.make({ value: pendingText.value, position: this.position(pendingText.start, pendingText.end) }),
				);
			}
			pendingText = undefined;
		};

		for (const node of childrenOf(parent)) {
			if (node.type === "text") {
				// Merge the run rather than emitting a node per construct: two
				// text nodes side by side are one mdast text node.
				if (pendingText === undefined) {
					pendingText = makeInlineNode("text", node.start, node.end, node.value);
				} else {
					pendingText.value += node.value;
					pendingText.end = node.end;
				}
				continue;
			}

			flushText();
			const built = this.materializeNode(node, depth);
			if (built !== undefined) {
				children.push(built);
			}
		}

		flushText();
		return children;
	}

	private materializeNode(node: InlineNode, depth: number): PhrasingContent | undefined {
		const position = this.position(node.start, node.end);
		const { url, title, identifier, label, referenceType, markerChar, breakStyle } = node.data;

		switch (node.type) {
			case "inlineCode":
				return InlineCode.make({ value: node.value, position });
			case "html":
				return Html.make({ value: node.value, position });
			case "break":
				return Break.make({ position, ...(breakStyle === undefined ? {} : { breakStyle }) });
			case "emphasis":
				return Emphasis.make({
					children: this.materialize(node, depth + 1),
					position,
					...(markerChar === undefined ? {} : { markerChar }),
				});
			case "strong":
				return Strong.make({
					children: this.materialize(node, depth + 1),
					position,
					...(markerChar === undefined ? {} : { markerChar }),
				});
			case "link":
				return Link.make({
					url: url ?? "",
					children: this.materialize(node, depth + 1),
					position,
					...(title === undefined ? {} : { title }),
				});
			case "image":
				return Image.make({
					url: url ?? "",
					position,
					...(title === undefined ? {} : { title }),
					...(node.value === "" ? {} : { alt: node.value }),
				});
			case "linkReference":
				return LinkReference.make({
					identifier: identifier ?? "",
					referenceType: referenceType ?? "shortcut",
					children: this.materialize(node, depth + 1),
					position,
					...(label === undefined ? {} : { label }),
				});
			case "imageReference":
				return ImageReference.make({
					identifier: identifier ?? "",
					referenceType: referenceType ?? "shortcut",
					position,
					...(label === undefined ? {} : { label }),
					...(node.value === "" ? {} : { alt: node.value }),
				});
			default:
				// A bare text node never reaches here — `materialize` coalesces
				// those before dispatching.
				return undefined;
		}
	}

	// --- the loop -----------------------------------------------------------

	/**
	 * One construct at the cursor. Upstream's `parseInline`: try the
	 * constructs this character triggers, then ordinary text, and failing both
	 * take the character literally.
	 */
	private parseOne(): boolean {
		const code = this.peek();
		if (code === -1) {
			return false;
		}

		for (const construct of this.dialect.byTrigger.get(code) ?? []) {
			if (construct.parse(this)) {
				return true;
			}
		}

		if (this.dialect.text.parse(this)) {
			return true;
		}

		// A character no construct claimed — a stray quote, a `]` with nothing
		// open — is literal text.
		const from = this.pos;
		this.pos += 1;
		this.appendText(String.fromCodePoint(code), from, this.pos);
		return true;
	}

	parse(): ReadonlyArray<PhrasingContent> {
		// Iterative by construction: the cursor only ever moves forward, and
		// every branch of `parseOne` advances it, so this loop needs no depth
		// guard (the toml lesson — know what NOT to guard).
		while (this.parseOne()) {
			// each call consumes at least one character
		}
		this.processEmphasis(undefined);
		return this.materialize(this.root, 0);
	}
}

/**
 * Parse a leaf block's raw text into phrasing content.
 *
 * A reference only forms when `refmap` holds its normalized label — a
 * dangling `[foo]` is literal text, per the spec — and when one does form it
 * is emitted as a `linkReference` carrying the identifier rather than an
 * eagerly resolved link. `position` comes from the block pass, which owns the
 * line index.
 */
export const parseInlines = (
	source: InlineSource,
	refmap: ReadonlyMap<string, Definition>,
	position: PositionOf,
	dialect: InlineDialectName = "commonmark",
): ReadonlyArray<PhrasingContent> => new InlineParser(source, inlineDialect(dialect), position, refmap).parse();
