// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// The block pass: `incorporateLine` and the scanner state it drives
// (`advanceOffset`, `advanceNextNonspace`, `findNextNonspace`, `addLine`,
// `addChild`, `finalize`, `closeUnmatchedBlocks`), plus the materialization
// step that turns the mutable block tree into mdast-shaped nodes.
//
// Port notes, four changes from upstream:
//
// 1. Offsets. Upstream tracks `lineNumber`/`column` and nothing else; every
//    scanner mutation here also has an absolute source offset behind it
//    (`lineStart + offset`), because the edit layer splices on offsets and
//    reconstructing them after the fact is not possible once tabs are
//    expanded and container prefixes stripped. `addLine` records the source
//    provenance of everything it copies (see `blockTypes.ts`).
// 2. The construct and block-start tables are per-dialect and injected
//    (`blockRegistry.ts`) rather than module globals.
// 3. Upstream mutates one `Node` type into the rendered AST; this port keeps
//    a private mutable `BlockNode` for the pass and materializes the
//    immutable schema classes afterwards, so no half-built node is ever
//    reachable from a public type.
// 4. Materialization runs in two walks: definitions are built and indexed
//    first, because the inline pass resolves references against the refmap and
//    a definition may follow the paragraph that references it.
//
// Imports node classes from `../MarkdownNode.js` (the sanctioned exception to
// the cycle firewall) and nothing else public.

import type { Definition, Heading, Paragraph, Root } from "../MarkdownNode.js";
import { Point, Position } from "../MarkdownNode.js";
import type { MarkdownDialect } from "./blockRegistry.js";
import { blockDialect } from "./blockRegistry.js";
import { isHtmlBlockEnd } from "./blocks/htmlBlock.js";
import type {
	BlockConstruct,
	BlockDialect,
	BlockNode,
	BlockScanner,
	BlockType,
	MaterializeContext,
	MaterializedBlock,
	PreparedInline,
	RawInlineSlice,
} from "./blockTypes.js";
import { makeBlockNode } from "./blockTypes.js";
import type { RawDiagnostic } from "./carriers.js";
import { GuardExceeded } from "./carriers.js";
import { MAX_NESTING_DEPTH } from "./limits.js";
import { LineIndex } from "./lineIndex.js";
import type { SourceLine } from "./preprocess.js";
import { columnsToNextTabStop, preprocessLines } from "./preprocess.js";
import { prepareInline } from "./rawInline.js";

/** Upstream's cheap pre-filter: a line that cannot start any block. */
const reMaybeSpecial = /^[#`~*+_=<>0-9-]/;

/** What the block pass hands to the inline pass and the facade. */
export interface BlockPassResult {
	/** The document, with every node positioned. */
	readonly root: Root;
	/** Leaf-block raw text awaiting the inline pass (Task 8). */
	readonly rawInlines: ReadonlyArray<RawInlineSlice>;
	/** Non-fatal engine diagnostics; the facade materializes them. */
	readonly carriers: ReadonlyArray<RawDiagnostic>;
	/**
	 * Every {@link Definition} in the tree, keyed by its case-folded label,
	 * first definition winning.
	 *
	 * The definitions stay in `root` as well — this map is a lookup index
	 * over them, not a place they were moved to. References are emitted
	 * unresolved, so whoever resolves them (the inline pass, a renderer, a
	 * consumer) does it against this.
	 */
	readonly refmap: ReadonlyMap<string, Definition>;
}

class BlockParser implements BlockScanner {
	private readonly lines: ReadonlyArray<SourceLine>;
	private readonly lineIndex: LineIndex;
	private readonly dialect: BlockDialect;
	private readonly sourceLength: number;

	private readonly doc: BlockNode;
	private tipNode: BlockNode | undefined;
	private oldtip: BlockNode;
	private lastMatchedContainer: BlockNode;

	currentLine = "";
	lineStart = 0;
	lineNumber = 0;
	offset = 0;
	column = 0;
	nextNonspace = 0;
	nextNonspaceColumn = 0;
	indent = 0;
	indented = false;
	blank = false;
	allClosed = true;

	private partiallyConsumedTab = false;
	private lastLineLength = 0;

	constructor(text: string, dialect: BlockDialect) {
		this.lines = preprocessLines(text);
		this.lineIndex = LineIndex.make(text);
		this.sourceLength = text.length;
		this.dialect = dialect;
		this.doc = makeBlockNode("document", 0, 1);
		this.tipNode = this.doc;
		this.oldtip = this.doc;
		this.lastMatchedContainer = this.doc;
	}

	/**
	 * The deepest open block. Only reachable while the document is open — a
	 * read after the final finalize is a wiring bug and dies as a defect.
	 */
	get tip(): BlockNode {
		const tip = this.tipNode;
		if (tip === undefined) {
			throw new TypeError("block parser: the tip was read after the document was finalized");
		}
		return tip;
	}

	private constructOf(type: BlockType): BlockConstruct {
		const construct = this.dialect.constructs.get(type);
		if (construct === undefined) {
			throw new TypeError(`block parser: no construct registered for block type ${type}`);
		}
		return construct;
	}

	// --- scanner ------------------------------------------------------------

	advanceOffset(count: number, columns = false): void {
		const line = this.currentLine;
		let remaining = count;
		let char = line.charAt(this.offset);

		while (remaining > 0 && char !== "") {
			if (char === "\t") {
				const charsToTab = columnsToNextTabStop(this.column);
				if (columns) {
					this.partiallyConsumedTab = charsToTab > remaining;
					const charsToAdvance = charsToTab > remaining ? remaining : charsToTab;
					this.column += charsToAdvance;
					this.offset += this.partiallyConsumedTab ? 0 : 1;
					remaining -= charsToAdvance;
				} else {
					this.partiallyConsumedTab = false;
					this.column += charsToTab;
					this.offset += 1;
					remaining -= 1;
				}
			} else {
				this.partiallyConsumedTab = false;
				this.offset += 1;
				// Block starts are ASCII, so one character is one column.
				this.column += 1;
				remaining -= 1;
			}
			char = line.charAt(this.offset);
		}
	}

	advanceNextNonspace(): void {
		this.offset = this.nextNonspace;
		this.column = this.nextNonspaceColumn;
		this.partiallyConsumedTab = false;
	}

	private findNextNonspace(): void {
		const line = this.currentLine;
		let index = this.offset;
		let cols = this.column;
		let char = line.charAt(index);

		while (char !== "") {
			if (char === " ") {
				index += 1;
				cols += 1;
			} else if (char === "\t") {
				index += 1;
				cols += columnsToNextTabStop(cols);
			} else {
				break;
			}
			char = line.charAt(index);
		}

		this.blank = char === "\n" || char === "\r" || char === "";
		this.nextNonspace = index;
		this.nextNonspaceColumn = cols;
		this.indent = this.nextNonspaceColumn - this.column;
		this.indented = this.indent >= 4;
	}

	addLine(): void {
		const tip = this.tip;

		if (this.partiallyConsumedTab) {
			// The tab straddles the container prefix: consume it and pad out to
			// the tab stop. Those spaces come from no source character, so they
			// deliberately fall outside every segment.
			this.offset += 1;
			tip.stringContent += " ".repeat(columnsToNextTabStop(this.column));
		}

		const content = this.currentLine.slice(this.offset);
		tip.segments.push({
			textOffset: tip.stringContent.length,
			sourceOffset: this.lineStart + this.offset,
			length: content.length,
		});
		tip.stringContent += `${content}\n`;
	}

	addChild(type: BlockType, offsetInLine: number): BlockNode {
		while (!this.constructOf(this.tip.type).canContain(type)) {
			this.finalizeBlock(this.tip, this.lineNumber - 1);
		}

		const parent = this.tip;
		const depth = parent.depth + 1;
		if (depth > MAX_NESTING_DEPTH) {
			// The hardening guard. Container nesting is the block pass's only
			// unbounded recursion surface — the line loop itself is iterative —
			// and materialization walks whatever this builds, so refusing here
			// is what keeps the walk inside the stack. The facade materializes
			// the typed error; the engine only ever throws the raw carrier.
			throw new GuardExceeded("NestingDepthExceeded", MAX_NESTING_DEPTH, depth, this.lineStart + offsetInLine);
		}

		const child = makeBlockNode(type, this.lineStart + offsetInLine, this.lineNumber, depth);
		child.parent = parent;
		parent.children.push(child);
		this.tipNode = child;
		return child;
	}

	setScanPosition(offset: number, column: number): void {
		this.offset = offset;
		this.column = column;
	}

	setLastLineLength(length: number): void {
		this.lastLineLength = length;
	}

	replaceBlock(block: BlockNode, type: BlockType): BlockNode {
		const parent = block.parent;
		const replacement = makeBlockNode(type, block.startOffset, block.startLine, block.depth);
		replacement.parent = parent;
		replacement.stringContent = block.stringContent;
		replacement.segments.push(...block.segments);
		replacement.endOffset = block.endOffset;
		replacement.endLine = block.endLine;

		if (parent !== undefined) {
			const at = parent.children.indexOf(block);
			if (at === -1) {
				parent.children.push(replacement);
			} else {
				parent.children[at] = replacement;
			}
		}

		block.open = false;
		this.tipNode = replacement;
		return replacement;
	}

	closeUnmatchedBlocks(): void {
		if (this.allClosed) {
			return;
		}
		while (this.oldtip !== this.lastMatchedContainer) {
			const parent = this.oldtip.parent;
			this.finalizeBlock(this.oldtip, this.lineNumber - 1);
			this.oldtip = parent ?? this.doc;
		}
		this.allClosed = true;
	}

	finalizeBlock(block: BlockNode, lineNumber: number): void {
		const above = block.parent;
		block.open = false;
		block.endLine = lineNumber;
		block.endOffset = this.endOfLine(lineNumber, this.lastLineLength);
		this.constructOf(block.type).finalize?.(this, block);
		this.tipNode = above;
	}

	/**
	 * The absolute offset `length` characters into line `lineNumber` — the
	 * offset form of upstream's `sourcepos[1] = [lineNumber, lastLineLength]`.
	 * Out-of-range line numbers clamp rather than throw.
	 */
	private endOfLine(lineNumber: number, length: number): number {
		const index = Math.min(Math.max(lineNumber - 1, 0), this.lines.length - 1);
		const line = this.lines[index];
		if (line === undefined) {
			return 0;
		}
		return line.start + Math.min(Math.max(length, 0), line.text.length);
	}

	// --- the line loop ------------------------------------------------------

	private incorporateLine(line: SourceLine): void {
		let container = this.doc;

		this.oldtip = this.tip;
		this.offset = 0;
		this.column = 0;
		this.blank = false;
		this.partiallyConsumedTab = false;
		this.lineNumber += 1;
		this.currentLine = line.text;
		this.lineStart = line.start;

		// Match each open container against this line; bail at the first that
		// fails, leaving `container` on the deepest one that matched.
		let lastChild = container.children[container.children.length - 1];
		while (lastChild?.open) {
			container = lastChild;
			this.findNextNonspace();

			const verdict = this.constructOf(container.type).continue(this, container);
			if (verdict === 2) {
				// The construct consumed the whole line (a closing fence).
				return;
			}
			if (verdict === 1) {
				// Upstream's `all_matched` flag lives only to reach this branch
				// on the next statement, so it collapses into the branch itself.
				container = container.parent ?? this.doc;
				break;
			}

			lastChild = container.children[container.children.length - 1];
		}

		this.allClosed = container === this.oldtip;
		this.lastMatchedContainer = container;

		let matchedLeaf = container.type !== "paragraph" && this.constructOf(container.type).acceptsLines;
		const starts = this.dialect.starts;

		while (!matchedLeaf) {
			this.findNextNonspace();

			// Upstream's fast path: no block can start here, so stop looking.
			if (!this.indented && !reMaybeSpecial.test(this.currentLine.slice(this.nextNonspace))) {
				this.advanceNextNonspace();
				break;
			}

			let index = 0;
			while (index < starts.length) {
				const start = starts[index];
				const result = start === undefined ? 0 : start.trigger(this, container);
				if (result === 1) {
					container = this.tip;
					break;
				}
				if (result === 2) {
					container = this.tip;
					matchedLeaf = true;
					break;
				}
				index += 1;
			}

			if (index === starts.length) {
				this.advanceNextNonspace();
				break;
			}
		}

		// Whatever is left at the scan position is text; give it to a block.
		if (!this.allClosed && !this.blank && this.tip.type === "paragraph") {
			// Lazy paragraph continuation: a line that failed to match the open
			// containers, but is non-blank and lands on an open paragraph,
			// belongs to that paragraph anyway — and crucially the unmatched
			// containers are NOT closed, because the paragraph is still inside
			// them. That is why this arm skips `closeUnmatchedBlocks` entirely.
			this.addLine();
		} else {
			this.closeUnmatchedBlocks();

			if (this.constructOf(container.type).acceptsLines) {
				this.addLine();
				// An HTML block of type 1 through 5 ends on the line that
				// carries its closing pattern, which is only knowable after
				// that line has been appended.
				if (container.type === "html" && isHtmlBlockEnd(container, this.currentLine.slice(this.offset))) {
					this.lastLineLength = this.currentLine.length;
					this.finalizeBlock(container, this.lineNumber);
				}
			} else if (this.offset < this.currentLine.length && !this.blank) {
				container = this.addChild("paragraph", this.offset);
				this.advanceNextNonspace();
				this.addLine();
			}
		}

		this.lastLineLength = this.currentLine.length;
	}

	// --- materialization ----------------------------------------------------

	private position(startOffset: number, endOffset: number): Position {
		const start = Math.min(Math.max(startOffset, 0), this.sourceLength);
		const end = Math.min(Math.max(endOffset, start), this.sourceLength);
		const startPoint = this.lineIndex.positionAt(start);
		const endPoint = this.lineIndex.positionAt(end);
		return Position.make({
			start: Point.make({ line: startPoint.line, column: startPoint.column, offset: start }),
			end: Point.make({ line: endPoint.line, column: endPoint.column, offset: end }),
		});
	}

	/**
	 * Depth-first materialization. Recursion depth is container nesting depth,
	 * which `addChild`'s `MAX_NESTING_DEPTH` guard caps at parse time — this
	 * walk can never see a tree the line loop refused to build.
	 */
	private materializeBlock(
		block: BlockNode,
		context: MaterializeContext,
		definitions: ReadonlyMap<BlockNode, Definition>,
	): MaterializedBlock | undefined {
		const children: MaterializedBlock[] = [];
		for (const child of block.children) {
			const node = this.materializeBlock(child, context, definitions);
			if (node !== undefined && node.type !== "root") {
				children.push(node);
			}
		}

		// A definition was already built by the refmap pre-pass; reusing that
		// node is what keeps the tree and the refmap pointing at one object.
		const definition = definitions.get(block);
		if (definition !== undefined) {
			return definition;
		}

		return this.constructOf(block.type).materialize(block, children, context);
	}

	/**
	 * Materialize every definition in the tree and index them, before anything
	 * else is built.
	 *
	 * The inline pass resolves references against the refmap, and a definition
	 * can appear anywhere — including after the paragraph that references it —
	 * so the map has to exist before the first leaf is parsed. Walking twice
	 * is the price; the alternative is a mutable tree the inline pass patches
	 * afterwards.
	 */
	private collectDefinitions(
		block: BlockNode,
		context: MaterializeContext,
		nodes: Map<BlockNode, Definition>,
		refmap: Map<string, Definition>,
	): void {
		if (block.type === "definition") {
			const materialized = this.constructOf(block.type).materialize(block, [], context);
			const key = block.data.definition?.key;
			if (materialized?.type === "definition" && key !== undefined) {
				nodes.set(block, materialized);
				// First definition wins, which is CommonMark's rule and the
				// order this walk visits in.
				if (!refmap.has(key)) {
					refmap.set(key, materialized);
				}
			}
			return;
		}

		for (const child of block.children) {
			this.collectDefinitions(child, context, nodes, refmap);
		}
	}

	parse(): BlockPassResult {
		for (const line of this.lines) {
			this.incorporateLine(line);
		}

		while (this.tipNode !== undefined) {
			this.finalizeBlock(this.tipNode, this.lines.length);
		}

		// A real Map: link labels are attacker-controlled, so a `__proto__`
		// label must be a key and not a prototype write.
		const refmap = new Map<string, Definition>();
		const definitionNodes = new Map<BlockNode, Definition>();
		const rawInlines: RawInlineSlice[] = [];

		const context: MaterializeContext = {
			position: (start, end) => this.position(start, end),
			inlineSlice: (block) => prepareInline(block, (start, end) => this.position(start, end), refmap),
			registerInline: (parent: Paragraph | Heading, prepared: PreparedInline) => {
				rawInlines.push({
					parent,
					text: prepared.text,
					startOffset: prepared.startOffset,
					segments: prepared.segments,
				});
			},
		};

		this.collectDefinitions(this.doc, context, definitionNodes, refmap);

		const root = this.materializeBlock(this.doc, context, definitionNodes);
		if (root === undefined || root.type !== "root") {
			throw new TypeError("block parser: the document construct did not materialize a root");
		}

		return { root, rawInlines, carriers: [], refmap };
	}
}

/**
 * Run the block pass over `text`.
 *
 * Every node carries a complete {@link Position}, leaf blocks have their
 * inline content parsed, and `rawInlines` reports the raw text each leaf was
 * built from.
 */
export const parseBlocks = (text: string, dialect: MarkdownDialect = "commonmark"): BlockPassResult =>
	new BlockParser(text, blockDialect(dialect)).parse();
