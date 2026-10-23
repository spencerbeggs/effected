// SAX-style tree visitor: a demand-driven sequence of enter/exit events over
// a parsed markdown tree, enabling early termination without materializing
// the full event sequence. Two forms over one engine: `walk` is the
// synchronous primitive (a lazy, re-iterable `Iterable`) and `visit` is the
// `Stream` derived from it, so the two can never disagree on an event
// (sync-primitive policy: the Effect-world form is defined in terms of the
// sync one, never the reverse).
//
// Sibling contract (yaml/toml precedent): the event union is a
// `Data.TaggedEnum` with a `taggedEnum` constructor const, and the statics
// class exposes a single `visit`. One recorded deviation: the yaml and toml
// visitors take TEXT and parse internally, because their event source is the
// parse itself; this visitor walks an ALREADY-PARSED tree, which is what lets it stay infallible
// at the type level with no parse-error channel. Consumers compose
// `Markdown.parse` (or `Mdast.fromMdast`) with `MarkdownVisitor.visit`.
//
// Guard posture: a tree this package's own parser produced can never exceed
// `MAX_NESTING_DEPTH` (the parse guard refuses deeper input), and neither
// can a decoded foreign tree (`Mdast.fromMdast`) — the decode boundary
// refuses it first. Only a hand-constructed tree can trip the guard.
// Mirroring stringify — which fails typed on the same tree — the walk
// surfaces the trip deliberately as a terminal `Error` event carrying a
// `NestingDepthExceeded` diagnostic and ends, never a defect and never a
// stream failure (the yaml visitor's diagnostics-as-events precedent).

import { Data, Stream } from "effect";
import { MAX_NESTING_DEPTH } from "./internal/limits.js";
import { MarkdownDiagnostic } from "./MarkdownDiagnostic.js";
import type { MarkdownPath } from "./MarkdownEdit.js";
import type { MarkdownNode, Root } from "./MarkdownNode.js";

/**
 * The discriminated union of markdown visitor events, in document pre-order.
 * `Enter` fires when the walk reaches a node, `Exit` when it leaves — for a
 * leaf the two fire back to back. Every variant carries `path` (child
 * indexes from the root; the root's own path is empty) and `depth`
 * (zero-based; the root is 0). `Error` is terminal: it carries the
 * depth-guard diagnostic for a hand-constructed tree nested past
 * `MAX_NESTING_DEPTH` and nothing follows it.
 *
 * @public
 */
export type MarkdownVisitorEvent = Data.TaggedEnum<{
	Enter: { readonly node: MarkdownNode; readonly path: MarkdownPath; readonly depth: number };
	Exit: { readonly node: MarkdownNode; readonly path: MarkdownPath; readonly depth: number };
	Error: { readonly diagnostic: MarkdownDiagnostic; readonly path: MarkdownPath; readonly depth: number };
}>;

/**
 * Constructors and matchers for the `MarkdownVisitorEvent` union (e.g.
 * `MarkdownVisitorEvent.Enter({ node, path, depth })`,
 * `MarkdownVisitorEvent.$is("Exit")`).
 *
 * @public
 */
export const MarkdownVisitorEvent = Data.taggedEnum<MarkdownVisitorEvent>();

/**
 * Walks a parsed markdown tree as a lazy sequence of `Enter`/`Exit` events in
 * document pre-order — synchronously with {@link MarkdownVisitor.walk}, or as
 * a `Stream` with {@link MarkdownVisitor.visit}. Not instantiable.
 *
 * @example
 * ```ts
 * import { Markdown, MarkdownVisitor, MarkdownVisitorEvent } from "@effected/markdown";
 * import { Effect, Stream } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const root = yield* Markdown.parse("# Hi\n\ntext\n");
 *   return yield* MarkdownVisitor.visit(root).pipe(
 *     Stream.filter(MarkdownVisitorEvent.$is("Enter")),
 *     Stream.map((event) => event.node.type),
 *     Stream.runCollect,
 *   );
 *   // => ["root", "heading", "text", "paragraph", "text"]
 * });
 * ```
 *
 * @public
 */
export class MarkdownVisitor {
	private constructor() {}

	/**
	 * Walk `root` synchronously, as a lazy `Iterable` of `MarkdownVisitorEvent`
	 * in document pre-order: `Enter` and `Exit` for every node including the
	 * root and every leaf. The primitive {@link MarkdownVisitor.visit} is
	 * defined in terms of, so the two yield the same events in the same order.
	 *
	 * @remarks
	 * For callers that cannot suspend — a lint rule whose host calls it
	 * synchronously, a getter, a non-Effect adapter. Events are produced on
	 * demand: a `for…of` that `break`s stops the walk without visiting the
	 * rest of the tree. The iterable is re-iterable — every `[Symbol.iterator]()`
	 * call starts a fresh walk from the root, so binding the result once and
	 * iterating it twice walks the tree twice, independently.
	 *
	 * Not named `walkResult`: it returns no `Result`, and the walk has no
	 * failure channel to put in one. A hand-constructed tree nested past the
	 * depth cap surfaces as a terminal `MarkdownVisitorEvent` `Error` event
	 * carrying a `NestingDepthExceeded` {@link MarkdownDiagnostic}, after which
	 * nothing is yielded — the same posture as `visit`. A tree produced by
	 * `Markdown.parse` or decoded by `Mdast.fromMdast` can never trip it.
	 *
	 * @example
	 * ```ts
	 * import { Markdown, MarkdownVisitor } from "@effected/markdown";
	 * import { Result } from "effect";
	 *
	 * const root = Result.getOrThrow(Markdown.parseResult("# Hi\n\ntext\n"));
	 * const entered: Array<string> = [];
	 * for (const event of MarkdownVisitor.walk(root)) {
	 *   if (event._tag === "Enter") entered.push(event.node.type);
	 * }
	 * console.log(entered);
	 * // => ["root", "heading", "text", "paragraph", "text"]
	 * ```
	 *
	 * @param root - The tree to walk.
	 * @returns A lazy, re-iterable `Iterable` of `MarkdownVisitorEvent`.
	 */
	static walk(root: Root): Iterable<MarkdownVisitorEvent> {
		return {
			[Symbol.iterator]() {
				return walkNode(root, [], 0);
			},
		};
	}

	/**
	 * Create a lazy `Stream` of `MarkdownVisitorEvent` walking `root` in
	 * document pre-order: `Enter` and `Exit` for every node including the
	 * root and every leaf. Events are produced on demand, so combining with
	 * `Stream.take` allows efficient partial scans without walking the rest
	 * of the tree.
	 *
	 * @remarks
	 * Infallible at the type level. A tree produced by `Markdown.parse` can
	 * never trip the walk's depth guard — the parser refuses deeper input —
	 * and neither can a decoded foreign tree (`Mdast.fromMdast`), because the
	 * decode boundary refuses it first; only a hand-constructed tree can trip
	 * the guard. The trip surfaces as a terminal `MarkdownVisitorEvent`
	 * `Error` event carrying a `NestingDepthExceeded` {@link MarkdownDiagnostic},
	 * mirroring the typed failure `Markdown.stringify` produces for the same
	 * tree.
	 *
	 * Defined as `Stream.fromIterable(MarkdownVisitor.walk(root))`: every run
	 * of the stream walks afresh, and the two forms never diverge.
	 *
	 * @param root - The tree to walk.
	 * @returns A lazy `Stream` of `MarkdownVisitorEvent`, infallible at the type
	 *   level.
	 */
	static visit(root: Root): Stream.Stream<MarkdownVisitorEvent> {
		return Stream.fromIterable(MarkdownVisitor.walk(root));
	}
}

function* walkNode(node: MarkdownNode, path: MarkdownPath, depth: number): Generator<MarkdownVisitorEvent> {
	if (depth > MAX_NESTING_DEPTH) {
		// Zero-based diagnostic line/character derived from the node's own
		// 1-based position (there is no source text in a tree walk); foreign
		// sentinel positions collapse to 0,0.
		yield MarkdownVisitorEvent.Error({
			diagnostic: MarkdownDiagnostic.make({
				code: "NestingDepthExceeded",
				message: `NestingDepthExceeded: limit ${MAX_NESTING_DEPTH}, actual ${depth}`,
				offset: node.position.start.offset,
				length: Math.max(0, node.position.end.offset - node.position.start.offset),
				line: Math.max(0, node.position.start.line - 1),
				character: Math.max(0, node.position.start.column - 1),
			}),
			path,
			depth,
		});
		return;
	}

	yield MarkdownVisitorEvent.Enter({ node, path, depth });

	if ("children" in node) {
		const children = node.children as ReadonlyArray<MarkdownNode>;
		for (let index = 0; index < children.length; index++) {
			const child = children[index] as MarkdownNode;
			const events = walkNode(child, [...path, index], depth + 1);
			for (const event of events) {
				yield event;
				if (event._tag === "Error") {
					// Terminal: abort the whole walk, mirroring stringify's
					// whole-operation typed failure.
					return;
				}
			}
		}
	}

	yield MarkdownVisitorEvent.Exit({ node, path, depth });
}
