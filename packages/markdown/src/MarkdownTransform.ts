// Pure tree-to-tree transforms over the node classes: a typed post-order map
// with structural sharing, heading-depth shifting built on it, and a
// root-level section finder over children indexes (no source text), so a
// consumer can reshape a tree and still navigate it.
//
// Sync-primitive posture: every method here is total and has no error
// channel, so each is a plain return value — no `Result`/`Effect` twin and no
// span (sync-primitive policy, "where the policy stops"). An exception a
// handler throws propagates to the caller as a plain thrown exception; it
// becomes a defect only if the caller is running inside an Effect.

import { FIDELITY_FIELDS, clearFidelity } from "./internal/fidelity.js";
import { rootHeadingBounds } from "./internal/sectionBounds.js";
import type {
	FlowContent,
	Heading,
	HeadingDepth,
	MarkdownNode,
	MarkdownNodeOfType,
	MarkdownNodeType,
	PhrasingContent,
	Root,
} from "./MarkdownNode.js";

/**
 * The node `type` tags whose handler may change the node's type — the
 * phrasing-only types, i.e. every member of `PhrasingContent` that is
 * not also flow content.
 *
 * @remarks
 * `html` is excluded: an `html` node is both phrasing and flow content, so it
 * can sit in a `Root`, `Blockquote` or `ListItem` child list, where only flow
 * content is valid. Its handler must therefore return an `Html`.
 *
 * @public
 */
export type MarkdownPhrasingOnlyType = Exclude<PhrasingContent, FlowContent>["type"];

/**
 * The handler table for `MarkdownTransform.map`: at most one function
 * per node `type` tag, each receiving the node narrowed to its class.
 *
 * @remarks
 * A handler for a phrasing-only type (see {@link MarkdownPhrasingOnlyType})
 * may return any {@link (PhrasingContent:type)} — turning a `link` into a
 * `linkReference`, say. That is sound because every parent of a phrasing
 * node holds `PhrasingContent` children, so any phrasing node is valid in its
 * place. Every other handler must return a node of its own type, which keeps
 * `map` total: no handler can put a node where its parent forbids it.
 *
 * @public
 */
export type MarkdownTransformHandlers = {
	readonly [T in MarkdownNodeType]?: (
		node: MarkdownNodeOfType<T>,
	) => T extends MarkdownPhrasingOnlyType ? PhrasingContent : MarkdownNodeOfType<T>;
};

/**
 * What `MarkdownTransform.map` returns for an input of type `N`: any
 * `PhrasingContent` when `N` is phrasing-only (its handler may change
 * its type), otherwise `N` itself.
 *
 * @public
 */
export type MarkdownTransformResult<N extends MarkdownNode> =
	N extends Exclude<PhrasingContent, FlowContent> ? PhrasingContent : N;

/**
 * Options for {@link MarkdownTransform.shiftHeadings}: the inclusive depth
 * range shifted headings are clamped into.
 *
 * @public
 */
export interface ShiftHeadingsOptions {
	/** The shallowest depth a shifted heading may take. Defaults to `1`. */
	readonly min?: HeadingDepth;
	/** The deepest depth a shifted heading may take. Defaults to `6`. */
	readonly max?: HeadingDepth;
}

/**
 * Options for {@link MarkdownTransform.sections}: the heading depth to match
 * and the window of `root.children` indexes to search.
 *
 * @public
 */
export interface SectionSpanOptions {
	/** The exact heading depth to match. */
	readonly depth: HeadingDepth;
	/** The first child index searched, inclusive. Defaults to `0`. */
	readonly start?: number;
	/** The child index the search stops at, exclusive. Defaults to `root.children.length`. */
	readonly end?: number;
}

/**
 * A root-level section located by index: the heading, its index in
 * `root.children`, and the exclusive index its section ends at. The body is
 * the children at `[headingIndex + 1, end)`.
 *
 * @public
 */
export interface SectionSpan {
	readonly heading: Heading;
	readonly headingIndex: number;
	readonly end: number;
}

/**
 * Pure, total tree-to-tree transforms over the markdown node classes. Not
 * instantiable.
 *
 * @remarks
 * Every method returns a plain value — none has an error channel. They work
 * on a tree, never on source text, so they compose with
 * {@link Markdown.stringify} for output and with each other; offset-splice
 * editing stays the job of `MarkdownFormat` and `MarkdownEdit`.
 *
 * @example
 * ```ts
 * import { LinkReference, Markdown, MarkdownTransform } from "@effected/markdown";
 * import { Result } from "effect";
 *
 * const parsed = Markdown.parseResult("# Title\n\nSee [docs](https://example.com).\n");
 * if (Result.isSuccess(parsed)) {
 *   const shifted = MarkdownTransform.shiftHeadings(parsed.success, 1);
 *   const rewritten = MarkdownTransform.map(shifted, {
 *     link: (link) =>
 *       LinkReference.make({ identifier: "docs", referenceType: "full", children: link.children }),
 *   });
 *   Markdown.stringifyResult(rewritten); // "## Title\n\nSee [docs][docs].\n"
 * }
 * ```
 *
 * @public
 */
export class MarkdownTransform {
	private constructor() {}

	/**
	 * Rebuild a tree by applying `handlers` to its nodes, bottom-up.
	 *
	 * @remarks
	 * **Walk order is a contract:** post-order, children left to right. A
	 * handler sees its node with its children ALREADY transformed, and
	 * handlers are called in document order of the nodes' closing positions,
	 * so a stateful handler can rely on it — deduplicating while keeping the
	 * first occurrence, or remembering the last paragraph seen. The input
	 * node itself is visited last.
	 *
	 * **Structural sharing:** a subtree no handler changed is returned as the
	 * same instance (`===`), so `map(node, {})` returns `node`. A parent whose
	 * children changed is rebuilt with only `children` swapped — every other
	 * field, including `position`, kept as it was. A rebuilt parent therefore
	 * carries its ORIGINAL `position`: offsets into the pre-transform source,
	 * which no longer describe the transformed tree.
	 *
	 * **Handler typing keeps the map total.** A handler for a phrasing-only
	 * type ({@link MarkdownPhrasingOnlyType}) may return any phrasing node —
	 * a `link` may become a `linkReference` — because every parent of a
	 * phrasing node holds phrasing children. Every other handler must return a
	 * node of its own type. `html` is the one phrasing type excluded from the
	 * type-changing set: it is a member of BOTH the phrasing and the flow
	 * unions, so an `html` node can be a child of a `Root`, `Blockquote` or
	 * `ListItem`, where only flow content is valid — its handler must return
	 * an `Html`, and `map` of an `Html` returns an `Html`. See
	 * {@link MarkdownTransformHandlers}. A handler that throws propagates the
	 * exception unchanged; `map` has no error channel of its own.
	 *
	 * The walk recurses once per nesting level. Every tree `Markdown.parse` or
	 * `Mdast.fromMdast` produces stays within the package's nesting cap, but a
	 * hand-built tree nested far deeper than that can overflow the call stack.
	 *
	 * **Two signatures.** This one covers every node whose handler cannot
	 * change its type — a `Root`, any flow node, a list item, a table row or
	 * cell, an `html` node — and returns `N` itself, so a generic caller
	 * constrained to, say, `Root | FlowContent` gets its own type parameter
	 * back. A lone phrasing-only node resolves to the second signature, whose
	 * result widens to `PhrasingContent`.
	 *
	 * @param node - The node to transform — typically a {@link Root}.
	 * @param handlers - At most one function per node `type` tag.
	 * @returns The transformed node, of the input's own type: `node` itself
	 *   when nothing changed.
	 */
	static map<N extends Exclude<MarkdownNode, Exclude<PhrasingContent, FlowContent>>>(
		node: N,
		handlers: MarkdownTransformHandlers,
	): N;
	/**
	 * Rebuild a tree by applying `handlers` to its nodes, bottom-up — the
	 * signature for any node, including a lone phrasing-only node whose own
	 * handler may change its type.
	 *
	 * @remarks
	 * Walk order, structural sharing, handler typing and the recursion limit
	 * are exactly as documented on the first signature. The difference is the
	 * result type, {@link MarkdownTransformResult}: for a phrasing-only node
	 * (a `link`, `text`, `emphasis`, ...) it is any `PhrasingContent`, since
	 * that node's handler may return, say, a `linkReference` for a `link`. For
	 * every other node it is `N`, but a caller holding a node of a known
	 * non-phrasing type resolves to the first signature, which returns `N`
	 * without the conditional type.
	 *
	 * @param node - Any node.
	 * @param handlers - At most one function per node `type` tag.
	 * @returns The transformed node: `node` itself when nothing changed.
	 */
	static map<N extends MarkdownNode>(node: N, handlers: MarkdownTransformHandlers): MarkdownTransformResult<N>;
	static map(node: MarkdownNode, handlers: MarkdownTransformHandlers): MarkdownNode {
		return mapNode(node, handlers);
	}

	/**
	 * Shift every heading's depth by `by`, clamped into `[min, max]`.
	 *
	 * @remarks
	 * The new depth is `clamp(depth + by, min ?? 1, max ?? 6)`. A heading
	 * whose new depth exceeds 2 loses `headingStyle: "setext"` (the key is
	 * omitted), since setext spells depths 1 and 2 only; it then serializes
	 * as ATX. A heading whose depth does not change, and needs no setext
	 * drop, keeps its identity; structural sharing follows
	 * {@link MarkdownTransform.(map:1)}, on which this is built. Accepts any node,
	 * including a lone {@link Heading}.
	 *
	 * Built on `map`, it recurses the same way: a hand-built tree nested far
	 * deeper than anything `Markdown.parse` or `Mdast.fromMdast` produces can
	 * overflow the call stack.
	 *
	 * @param node - The node whose headings to shift.
	 * @param by - The signed depth offset; must be an integer.
	 * @param options - Optional {@link ShiftHeadingsOptions} clamp bounds.
	 * @returns The node with headings shifted.
	 * @throws `RangeError` when `by` is not an integer, or `min` / `max` is not
	 *   a heading depth or `min > max` — a wiring error, not a data error.
	 */
	static shiftHeadings<N extends MarkdownNode>(node: N, by: number, options?: ShiftHeadingsOptions): N {
		if (!Number.isInteger(by)) {
			throw new RangeError(`MarkdownTransform.shiftHeadings: by must be an integer, got ${by}`);
		}
		const min = options?.min ?? 1;
		const max = options?.max ?? 6;
		if (!isHeadingDepth(min) || !isHeadingDepth(max) || min > max) {
			throw new RangeError(`MarkdownTransform.shiftHeadings: invalid depth bounds min=${min} max=${max}`);
		}
		return mapNode(node, {
			heading: (heading) => {
				const depth = Math.min(max, Math.max(min, heading.depth + by)) as HeadingDepth;
				const dropSetext = depth > 2 && heading.headingStyle === "setext";
				if (depth === heading.depth && !dropSetext) return heading;
				const { headingStyle, ...rest } = heading;
				const ctor = heading.constructor as new (input: unknown, options: { readonly disableChecks: true }) => Heading;
				return new ctor(
					{ ...rest, depth, ...(headingStyle !== undefined && !dropSetext ? { headingStyle } : {}) },
					{ disableChecks: true },
				);
			},
		}) as N;
	}

	/**
	 * Return a copy of the tree with every fidelity field cleared, so
	 * `Markdown.stringify` emits the canonical form instead of the author's
	 * spelling.
	 *
	 * @remarks
	 * Clears `headingStyle`, `markerChar` (emphasis, strong, thematic break),
	 * `fenceChar` and `fenceLength`, `bulletChar` and `delimiter`, and
	 * `breakStyle`. `Text`'s `escapeStyle` is an emitter instruction rather
	 * than a recorded spelling and is kept. Positions and all mdast fields are
	 * untouched. The input is never mutated; a subtree carrying no fidelity
	 * field is returned as the same instance, following
	 * {@link MarkdownTransform.(map:1)}, on which this is built. Like `map` it
	 * recurses without a depth guard, so a tree nested past the stack throws a
	 * `RangeError`; `Markdown.stringifyResult` with `canonical: true` checks
	 * depth first and fails typed at the stringifier's own limit instead.
	 *
	 * `Markdown.stringify(tree, { canonical: true })` is exactly
	 * `Markdown.stringify(MarkdownTransform.canonicalize(tree))`.
	 *
	 * @param node - The node whose fidelity fields to clear.
	 * @returns The node with fidelity fields cleared.
	 */
	static canonicalize<N extends MarkdownNode>(node: N): N {
		return mapNode(node, canonicalHandlers) as N;
	}

	/**
	 * Locate the root-level sections of one heading depth by child index —
	 * no source text needed, so it works on a tree a
	 * `MarkdownTransform.map` has reshaped.
	 *
	 * @remarks
	 * Returns the root-level headings of exactly `depth` whose index lies in
	 * `[start, end)`, in document order. Each section ends at the next
	 * root-level heading of equal or shallower depth, or at `end` — the same
	 * boundary rule as `MarkdownDocument.sections`, from one shared
	 * implementation. The window is what lets a caller nest: find the depth-2
	 * blocks, then the depth-3 sections inside one block's
	 * `[headingIndex + 1, end)`.
	 *
	 * **A shallower heading ends a section too.** Querying depth 2 on
	 * `## Features`, a list, a stray `# Top` and another list yields one span
	 * whose `end` is the `# Top` heading's index, so neither `# Top` nor the
	 * list after it belongs to the section. That is the outline reading. A
	 * caller that wants each section to run to the next heading of the SAME
	 * depth (slicing a changeset or changelog by entry, where a stray H1 is
	 * content) computes each body's end from the next span's `headingIndex`
	 * instead, or the window's end for the last span, as in the example.
	 *
	 * @example
	 * Bodies that run to the next same-depth heading:
	 *
	 * ```ts
	 * import { Markdown, MarkdownTransform } from "@effected/markdown";
	 * import { Result } from "effect";
	 *
	 * const root = Result.getOrThrow(Markdown.parseResult("## Features\n\n- a\n\n# Top\n\n- b\n"));
	 * const spans = MarkdownTransform.sections(root, { depth: 2 });
	 * // spans[0].end === 2: the outline section stops at `# Top`
	 * const bodies = spans.map((span, index) =>
	 *   root.children.slice(span.headingIndex + 1, spans[index + 1]?.headingIndex ?? root.children.length),
	 * );
	 * // bodies[0] holds the first list, `# Top` and the second list
	 * ```
	 *
	 * @param root - The tree whose root-level headings delimit sections.
	 * @param options - The {@link SectionSpanOptions} depth and window.
	 * @returns The matching {@link SectionSpan}s, in document order.
	 * @throws `RangeError` when `depth` is not an integer from 1 to 6, when
	 *   `start` or `end` is not an integer in `[0, root.children.length]`, or
	 *   when `start > end`.
	 */
	static sections(root: Root, options: SectionSpanOptions): ReadonlyArray<SectionSpan> {
		if (!isHeadingDepth(options.depth)) {
			throw new RangeError(`MarkdownTransform.sections: depth must be a heading depth 1-6, got ${options.depth}`);
		}
		const length = root.children.length;
		const start = options.start ?? 0;
		const end = options.end ?? length;
		if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > length || start > end) {
			throw new RangeError(
				`MarkdownTransform.sections: invalid window start=${start} end=${end} for ${length} children`,
			);
		}
		const spans: Array<SectionSpan> = [];
		for (const bound of rootHeadingBounds(root.children)) {
			if (bound.index < start || bound.index >= end || bound.heading.depth !== options.depth) continue;
			spans.push({ heading: bound.heading, headingIndex: bound.index, end: Math.min(bound.end, end) });
		}
		return spans;
	}
}

const isHeadingDepth = (value: number): value is HeadingDepth => Number.isInteger(value) && value >= 1 && value <= 6;

const canonicalHandlers: MarkdownTransformHandlers = Object.fromEntries(
	Object.keys(FIDELITY_FIELDS).map((type) => [type, clearFidelity]),
);

type AnyHandler = (node: MarkdownNode) => MarkdownNode;

function mapNode(node: MarkdownNode, handlers: MarkdownTransformHandlers): MarkdownNode {
	let current = node;
	if ("children" in node) {
		const children = node.children as ReadonlyArray<MarkdownNode>;
		let next: Array<MarkdownNode> | undefined;
		for (let index = 0; index < children.length; index += 1) {
			const child = children[index] as MarkdownNode;
			const mapped = mapNode(child, handlers);
			if (next === undefined && mapped !== child) next = children.slice(0, index);
			next?.push(mapped);
		}
		if (next !== undefined) {
			// Handler typing guarantees every child is valid in this parent, so
			// refinement checks are skipped; the constructor still parses the
			// node's own fields shallowly (class instances pass by reference).
			const ctor = node.constructor as new (input: unknown, options: { readonly disableChecks: true }) => MarkdownNode;
			current = new ctor({ ...node, children: next }, { disableChecks: true });
		}
	}
	const handler = handlers[current.type] as AnyHandler | undefined;
	return handler === undefined ? current : handler(current);
}
