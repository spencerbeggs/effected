// The lossless unit: source text plus the parsed tree, the materialized
// diagnostics and the link-reference definition index, in one Schema class.
//
// Cycle firewall: this module never touches raw carriers directly — it shares
// `Markdown.ts`'s single carrier-catching helper, so the document and the
// bare-tree entry points agree exactly on what is a typed failure and what is
// a defect.

import { Effect, Result, Schema } from "effect";
import { MAX_NESTING_DEPTH } from "./internal/limits.js";
import { normalizeLabelText } from "./internal/references.js";
import type { MarkdownParseError, MarkdownParseOptions } from "./Markdown.js";
import { parsePassResult } from "./Markdown.js";
import { MarkdownDiagnostic } from "./MarkdownDiagnostic.js";
import { MarkdownRange } from "./MarkdownEdit.js";
import type {
	FlowContent,
	Frontmatter,
	Heading,
	HeadingDepth,
	Image,
	ImageReference,
	Link,
	LinkReference,
	MarkdownNode,
	PhrasingContent,
} from "./MarkdownNode.js";
import { Definition, Root } from "./MarkdownNode.js";

/**
 * A heading entry from {@link MarkdownDocument.headings}: the {@link Heading}
 * node plus the derivations navigation wants — its `depth` and its plain-text
 * content.
 *
 * @remarks
 * `text` concatenates the values of text and inline-code descendants, uses
 * image `alt` text where present, renders a hard break as a single space and
 * contributes nothing for raw HTML or footnote references.
 *
 * @public
 */
export interface DocumentHeading {
	readonly node: Heading;
	readonly depth: HeadingDepth;
	readonly text: string;
}

/**
 * A heading-delimited span from {@link MarkdownDocument.sections}: the
 * heading, its depth, the source `range` the section occupies and the
 * root-level blocks that follow the heading inside it.
 *
 * @remarks
 * A section runs from its heading's start offset to the start of the next
 * root-level heading of equal or shallower depth, or to the end of the
 * source. Deeper headings nest inside, so a parent section's `range` and
 * `children` include its subsections — the list is flat, in document order,
 * with `depth` carrying the hierarchy.
 *
 * @public
 */
export interface DocumentSection {
	readonly heading: Heading;
	readonly depth: HeadingDepth;
	readonly range: MarkdownRange;
	readonly children: ReadonlyArray<FlowContent>;
}

/**
 * The node types {@link MarkdownDocument.links} collects: the nodes that
 * carry an outbound URL themselves ({@link Link}, {@link Image},
 * {@link Definition}) and the reference nodes that reach one through the
 * definition index ({@link LinkReference}, {@link ImageReference}).
 *
 * @public
 */
export type LinkBearingNode = Link | Image | Definition | LinkReference | ImageReference;

/**
 * A link entry from {@link MarkdownDocument.links}: the link-bearing node and
 * the URL it points at.
 *
 * @remarks
 * `url` is the node's own `url` field, unmodified — bundle-relative and
 * otherwise non-normalized hrefs pass through exactly as written. For
 * reference nodes it is the matching definition's `url`; when no definition
 * matches (possible only on trees decoded from foreign mdast — the parser
 * never forms an unmatched reference), the field is genuinely absent.
 *
 * @public
 */
export interface DocumentLink {
	readonly node: LinkBearingNode;
	readonly url?: string;
}

// The accessor walks recurse over the tree, so they share the engine's depth
// cap. A getter has no typed error channel, so — like `applyAll`'s overlap
// guard — an over-deep tree (reachable only via a hand-built or foreign
// decoded tree; the parser refuses deeper input) is a thrown defect.
type NavigationNode = Frontmatter | MarkdownNode;

const walkTree = (node: NavigationNode, depth: number, visit: (node: NavigationNode) => void): void => {
	if (depth > MAX_NESTING_DEPTH) {
		throw new Error(`NestingDepthExceeded: limit ${MAX_NESTING_DEPTH} exceeded while walking the document tree`);
	}
	visit(node);
	if ("children" in node) {
		for (const child of node.children) {
			walkTree(child, depth + 1, visit);
		}
	}
};

const phrasingText = (nodes: ReadonlyArray<PhrasingContent>): string => {
	let out = "";
	for (const node of nodes) {
		switch (node.type) {
			case "text":
			case "inlineCode":
				out += node.value;
				break;
			case "break":
				out += " ";
				break;
			case "image":
			case "imageReference":
				out += node.alt ?? "";
				break;
			case "emphasis":
			case "strong":
			case "delete":
			case "link":
			case "linkReference":
				out += phrasingText(node.children);
				break;
			default:
				break;
		}
	}
	return out;
};

/**
 * A parsed markdown document: the original `source`, the mdast-shaped
 * {@link Root} tree, the non-fatal {@link MarkdownDiagnostic}s the parse
 * produced, and the link-reference `definitions` index.
 *
 * @remarks
 * The document is the lossless unit — `source` is retained so offsets on the
 * tree stay meaningful and so P4's edit/format layer can splice against the
 * exact bytes that were parsed.
 *
 * `definitions` is an index over the {@link Definition} nodes that remain in
 * the tree, keyed by case-folded label with the first definition winning; it
 * is not a place they were moved to. References are emitted unresolved, so
 * resolution happens against this map.
 *
 * `diagnostics` is empty for every input the P1 parser accepts, and that is
 * the current state of the world rather than a missing feature: the plumbing
 * from the engine through to this field is real and exercised, but no P1
 * construct emits a non-fatal diagnostic yet. The producers arrive with the
 * conditions that warrant them — unresolved link references, and
 * present-but-unparseable frontmatter in P3. Read an empty array as "nothing
 * to report", not as "not implemented", and do not code against it staying
 * empty.
 *
 * The navigation accessors (`headings`, `sections`, `links`) are derived
 * getters over the tree — no stored state, no parse-time cost, and they can
 * never disagree with the tree they read.
 *
 * @public
 */
export class MarkdownDocument extends Schema.Class<MarkdownDocument>("MarkdownDocument")({
	source: Schema.String,
	root: Root,
	diagnostics: Schema.Array(MarkdownDiagnostic),
	definitions: Schema.ReadonlyMap(Schema.String, Definition),
}) {
	/**
	 * The document's frontmatter capture, or `undefined` when there is none.
	 *
	 * @remarks
	 * Derived from the tree rather than stored: a {@link Frontmatter} node can
	 * only ever sit at the head of `root.children` (the capture fires at most
	 * once, at offset 0), so the tree is the single source of truth and the
	 * accessor can never disagree with it. `undefined` covers both a document
	 * with no frontmatter block and one parsed with the capture toggle off.
	 */
	get frontmatter(): Frontmatter | undefined {
		const head = this.root.children[0];
		return head !== undefined && head.type === "frontmatter" ? head : undefined;
	}

	/**
	 * Every heading in the document, in document order, wherever it sits —
	 * including headings nested inside blockquotes and list items.
	 *
	 * @remarks
	 * Each {@link DocumentHeading} carries the node, its depth and its
	 * plain-text content. For an outline restricted to section boundaries, use
	 * {@link MarkdownDocument.sections}, which considers root-level headings
	 * only.
	 */
	get headings(): ReadonlyArray<DocumentHeading> {
		const entries: Array<DocumentHeading> = [];
		for (const child of this.root.children) {
			walkTree(child, 1, (node) => {
				if (node.type === "heading") {
					entries.push({ node, depth: node.depth, text: phrasingText(node.children) });
				}
			});
		}
		return entries;
	}

	/**
	 * The document's heading-delimited sections, flat and in document order.
	 *
	 * @remarks
	 * Only root-level headings delimit sections — a heading inside a
	 * blockquote or list cannot mark a span of root-level source. Content
	 * before the first heading (the preamble) and the frontmatter block belong
	 * to no section. Each {@link DocumentSection.range} is spliceable by the
	 * edit layer: it runs from the heading's start offset to the next
	 * boundary heading's start, or to the end of the source.
	 */
	get sections(): ReadonlyArray<DocumentSection> {
		const blocks = this.root.children;
		const sections: Array<DocumentSection> = [];
		for (let index = 0; index < blocks.length; index += 1) {
			const block = blocks[index];
			if (block === undefined || block.type !== "heading") {
				continue;
			}
			let boundary = this.source.length;
			let end = blocks.length;
			for (let next = index + 1; next < blocks.length; next += 1) {
				const candidate = blocks[next];
				if (candidate !== undefined && candidate.type === "heading" && candidate.depth <= block.depth) {
					boundary = candidate.position.start.offset;
					end = next;
					break;
				}
			}
			const start = block.position.start.offset;
			sections.push({
				heading: block,
				depth: block.depth,
				range: MarkdownRange.make({ offset: start, length: boundary - start }),
				children: blocks.slice(index + 1, end).filter((child): child is FlowContent => child.type !== "frontmatter"),
			});
		}
		return sections;
	}

	/**
	 * Every link-bearing node in the document, in document order: links,
	 * images, definitions, and the reference forms resolved through the
	 * definition index.
	 *
	 * @remarks
	 * See {@link DocumentLink} for the url semantics — the raw `url` string
	 * passes through unmodified, and an unresolvable foreign reference leaves
	 * the field genuinely absent. Autolinks and GFM autolink literals are
	 * {@link Link} nodes, so they appear with no special casing. Footnote
	 * references carry no URL and are not link entries.
	 */
	get links(): ReadonlyArray<DocumentLink> {
		const entries: Array<DocumentLink> = [];
		for (const child of this.root.children) {
			walkTree(child, 1, (node) => {
				switch (node.type) {
					case "link":
					case "image":
					case "definition":
						entries.push({ node, url: node.url });
						break;
					case "linkReference":
					case "imageReference": {
						const definition = this.definitions.get(normalizeLabelText(node.identifier));
						entries.push(definition === undefined ? { node } : { node, url: definition.url });
						break;
					}
					default:
						break;
				}
			});
		}
		return entries;
	}

	/**
	 * Parse markdown into a {@link MarkdownDocument}, synchronously, as a
	 * `Result`. The pure primitive; {@link MarkdownDocument.parse} is defined
	 * in terms of it, so the two never diverge.
	 *
	 * @remarks
	 * Carries no span: it is not an `Effect`. Effect callers should reach for
	 * {@link MarkdownDocument.parse}, which carries the
	 * `MarkdownDocument.parse` tracing span.
	 *
	 * @param text - The markdown source to parse.
	 * @param options - Optional {@link MarkdownParseOptions}; the dialect
	 *   defaults to `"gfm"`.
	 * @returns A `Result` succeeding with the document, or failing with
	 *   `MarkdownParseError`.
	 */
	static parseResult(
		text: string,
		options?: MarkdownParseOptions,
	): Result.Result<MarkdownDocument, MarkdownParseError> {
		return Result.map(parsePassResult(text, options), (pass) =>
			MarkdownDocument.make({
				source: text,
				root: pass.root,
				diagnostics: pass.carriers.map((carrier) => MarkdownDiagnostic.fromRaw(text, carrier)),
				definitions: pass.refmap,
			}),
		);
	}

	/**
	 * Parse markdown into a {@link MarkdownDocument}. Defined in terms of
	 * {@link MarkdownDocument.parseResult} — synchronous callers can use that
	 * variant directly.
	 *
	 * @param text - The markdown source to parse.
	 * @param options - Optional {@link MarkdownParseOptions}; the dialect
	 *   defaults to `"gfm"`.
	 * @returns An `Effect` that succeeds with the document, or fails with
	 *   `MarkdownParseError`.
	 */
	static readonly parse = Effect.fn("MarkdownDocument.parse")((text: string, options?: MarkdownParseOptions) =>
		Effect.fromResult(MarkdownDocument.parseResult(text, options)),
	);
}
