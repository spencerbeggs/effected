// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// The inline pass: upstream's `InlineParser` minus emphasis and links, which
// need the delimiter and bracket stacks and arrive in Task 9. The loop, the
// cursor primitives and the construct dispatch are all here; the two stack
// slots below are where Task 9 hangs its state.
//
// Port notes, three changes from upstream:
//
// 1. Positions. Upstream's inline nodes inherit their leaf block's sourcepos
//    and have no offsets of their own. Every node built here is positioned
//    through the segment table (`segments.ts`), so an inline node inside a
//    twice-indented blockquote still points at the right characters in the
//    ORIGINAL source.
// 2. Adjacent text merges. Upstream emits a text node per run and lets its
//    renderer concatenate; mdast wants one text node per contiguous run, and
//    merging is also what makes a soft line break a `\n` inside a value
//    rather than a node boundary.
// 3. Dispatch is a per-dialect trigger table rather than a `switch`
//    (`inlineRegistry.ts`).
//
// Imports node classes from `../MarkdownNode.js` (the sanctioned exception to
// the cycle firewall) and nothing else public.

import type { Definition, PhrasingContent } from "../MarkdownNode.js";
import { Point, Position, Text } from "../MarkdownNode.js";
import type { InlineDialectName } from "./inlineRegistry.js";
import { inlineDialect } from "./inlineRegistry.js";
import type { InlineDialect, InlineScanner, InlineSource } from "./inlineTypes.js";
import { sourceOffsetAt } from "./segments.js";

const reTrailingSpaces = / +$/;

/**
 * Builds a {@link Position} from an absolute source range. The block pass owns
 * the line index, so it supplies this rather than the inline pass building a
 * second one.
 */
type PositionOf = (startOffset: number, endOffset: number) => Position;

class InlineParser implements InlineScanner {
	readonly subject: string;
	pos = 0;

	private readonly source: InlineSource;
	private readonly dialect: InlineDialect;
	private readonly positionOf: PositionOf;
	private readonly children: PhrasingContent[] = [];

	// The delimiter and bracket stacks Task 9 fills. They exist here so the
	// loop below is the final shape: emphasis and links are constructs that
	// push onto these, not a different parser.
	// private delimiters: Delimiter | undefined;
	// private brackets: Bracket | undefined;

	constructor(source: InlineSource, dialect: InlineDialect, positionOf: PositionOf) {
		this.source = source;
		this.subject = source.text;
		this.dialect = dialect;
		this.positionOf = positionOf;
	}

	peek(): number {
		return this.pos < this.subject.length ? this.subject.charCodeAt(this.pos) : -1;
	}

	/**
	 * Match `pattern` AT the cursor, advancing past it on success.
	 *
	 * A match that starts later is not a match: every construct here asks
	 * "does this begin at the cursor". Upstream adds `m.index` to its position
	 * instead, which is safe only because its dispatch guarantees index zero —
	 * a guarantee the trigger table does not make (see `text.ts`).
	 */
	match(pattern: RegExp): string | undefined {
		const found = pattern.exec(this.subject.slice(this.pos));
		if (found === null || found.index !== 0) {
			return undefined;
		}
		this.pos += found[0].length;
		return found[0];
	}

	matchAhead(pattern: RegExp): string | undefined {
		const found = pattern.exec(this.subject.slice(this.pos));
		if (found === null) {
			return undefined;
		}
		this.pos += found.index + found[0].length;
		return found[0];
	}

	offsetAt(index: number): number {
		return sourceOffsetAt(this.source.segments, index, this.source.startOffset);
	}

	position(from: number, to: number): Position {
		const start = this.offsetAt(from);
		return this.positionOf(start, Math.max(this.offsetAt(to), start));
	}

	appendText(value: string, from: number, to: number): void {
		const previous = this.children[this.children.length - 1];
		if (previous?.type === "text") {
			this.children[this.children.length - 1] = Text.make({
				value: previous.value + value,
				position: Position.make({ start: previous.position.start, end: this.position(from, to).end }),
			});
			return;
		}
		this.children.push(Text.make({ value, position: this.position(from, to) }));
	}

	append(node: PhrasingContent): void {
		this.children.push(node);
	}

	lastText(): Text | undefined {
		const previous = this.children[this.children.length - 1];
		return previous?.type === "text" ? previous : undefined;
	}

	trimTrailingSpaces(): number {
		const last = this.lastText();
		if (last === undefined) {
			return 0;
		}

		const trimmed = last.value.replace(reTrailingSpaces, "");
		const removed = last.value.length - trimmed.length;
		if (removed === 0) {
			return 0;
		}

		if (trimmed.length === 0) {
			this.children.pop();
			return removed;
		}

		this.children[this.children.length - 1] = Text.make({
			value: trimmed,
			position: Position.make({
				start: last.position.start,
				end: Point.make({
					line: last.position.end.line,
					column: Math.max(last.position.end.column - removed, 0),
					offset: Math.max(last.position.end.offset - removed, last.position.start.offset),
				}),
			}),
		});
		return removed;
	}

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

		// A character no construct claimed — an emphasis marker until Task 9,
		// a stray bracket, a quote — is literal text.
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
		return this.children;
	}
}

/**
 * Parse a leaf block's raw text into phrasing content.
 *
 * `refmap` is threaded now so the signature is final: reference links resolve
 * against it in Task 9, and nothing here consults it yet. `position` comes
 * from the block pass, which owns the line index.
 */
export const parseInlines = (
	source: InlineSource,
	refmap: ReadonlyMap<string, Definition>,
	position: PositionOf,
	dialect: InlineDialectName = "commonmark",
): ReadonlyArray<PhrasingContent> => {
	void refmap;
	return new InlineParser(source, inlineDialect(dialect), position).parse();
};
