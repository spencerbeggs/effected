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
// A third form, `traverse`, drives the same engine with enter/exit callbacks
// and `skip`/`exit` signals: the generator receives each `Enter`'s answer
// through `next(action)` (delegated down the `yield*` chain), so skipping a
// subtree is the engine not descending, never a filter over a full walk, and
// the three forms still share one depth guard and one event order.
//
// Guard posture: a tree this package's own parser produced can never exceed
// `MAX_NESTING_DEPTH` (the parse guard refuses deeper input), and neither
// can a decoded foreign tree (`Mdast.fromMdast`) — the decode boundary
// refuses it first. Only a hand-constructed tree can trip the guard.
// Mirroring stringify — which fails typed on the same tree — the walk
// surfaces the trip deliberately as a terminal `Error` event carrying a
// `NestingDepthExceeded` diagnostic and ends, never a defect and never a
// stream failure (the yaml visitor's diagnostics-as-events precedent).

import { Data, Option, Stream } from "effect";
import { MAX_NESTING_DEPTH } from "./internal/limits.js";
import { MarkdownDiagnostic } from "./MarkdownDiagnostic.js";
import type { MarkdownPath } from "./MarkdownEdit.js";
import type { MarkdownNode, MarkdownNodeOfType, MarkdownNodeType, Root } from "./MarkdownNode.js";

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
 * What a `MarkdownVisitor.traverse` callback tells the walk to do next.
 *
 * @remarks
 * - `"continue"` (or returning nothing) walks on normally.
 * - `"skip"` from an `enter` callback does not descend into the node's
 *   children; the node's own `exit` callback still runs, so enter and exit
 *   stay balanced. From an `exit` callback it means the same as `"continue"`.
 * - `"exit"` from either callback ends the whole walk at once: no further
 *   callback runs, not even the pending `exit` callbacks of the ancestors.
 *
 * The three values are also the statics `MarkdownVisitor.CONTINUE`,
 * `MarkdownVisitor.SKIP` and `MarkdownVisitor.EXIT`.
 *
 * @public
 */
export type MarkdownVisitAction = "continue" | "skip" | "exit";

/**
 * Where a `MarkdownVisitor.traverse` callback's node sits in the tree.
 *
 * @public
 */
export interface MarkdownVisitContext {
	/** Child indexes from the root to the node; the root's own path is empty. */
	readonly path: MarkdownPath;
	/** Zero-based depth; the root is `0`. */
	readonly depth: number;
	/**
	 * The node's ancestors, root first and parent last; empty for the root. A
	 * frozen snapshot that the walk never changes, so a callback may keep it;
	 * callbacks that see the same ancestors share one array.
	 */
	readonly ancestors: ReadonlyArray<MarkdownNode>;
}

/**
 * The callbacks `MarkdownVisitor.traverse` calls: `enter` when the walk
 * reaches a node, `exit` when it leaves it, both optional. `N` narrows the
 * node type when `traverse` is given a type selector.
 *
 * @remarks
 * A callback returns a {@link MarkdownVisitAction}, or nothing to continue.
 * A `throw` from a callback is not caught: it propagates out of `traverse`
 * unchanged, because a callback that throws has broken its own contract and
 * the walk has no channel that could honestly carry it.
 *
 * @public
 */
export interface MarkdownTraverseVisitor<N extends MarkdownNode = MarkdownNode> {
	/** Called when the walk reaches a matching node, before its children. */
	readonly enter?: (node: N, context: MarkdownVisitContext) => MarkdownVisitAction | undefined;
	/** Called when the walk leaves a matching node, after its children. */
	readonly exit?: (node: N, context: MarkdownVisitContext) => MarkdownVisitAction | undefined;
}

/**
 * Walks a parsed markdown tree as a lazy sequence of `Enter`/`Exit` events in
 * document pre-order — synchronously with {@link MarkdownVisitor.walk}, as a
 * `Stream` with {@link MarkdownVisitor.visit}, or through enter/exit callbacks
 * that can skip a subtree or stop the walk with `MarkdownVisitor.traverse`.
 * Not instantiable.
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
	 * The {@link MarkdownVisitAction} that walks on normally — the same as
	 * returning nothing from a `MarkdownVisitor.traverse` callback.
	 */
	static readonly CONTINUE: "continue" = "continue";

	/**
	 * The {@link MarkdownVisitAction} that, returned from an `enter` callback,
	 * stops `MarkdownVisitor.traverse` from descending into the node.
	 */
	static readonly SKIP: "skip" = "skip";

	/**
	 * The {@link MarkdownVisitAction} that ends a `MarkdownVisitor.traverse`
	 * walk at once.
	 */
	static readonly EXIT: "exit" = "exit";

	/**
	 * Walk `root` synchronously in document pre-order, calling `visitor.enter`
	 * when the walk reaches each node and `visitor.exit` when it leaves it.
	 *
	 * @remarks
	 * The callback form of {@link MarkdownVisitor.walk}, over the same engine:
	 * the same order, the same `path` and `depth`, the same depth guard. Two
	 * things it adds. A callback steers the walk — `MarkdownVisitor.SKIP` from
	 * `enter` keeps the walk out of that node's children (its `exit` still
	 * runs), and `MarkdownVisitor.EXIT` from either callback ends the walk.
	 * And each callback receives the node's ancestors, root first.
	 *
	 * Given a type selector — one node `type`, or an array of them — only
	 * matching nodes reach the callbacks, typed as that node class
	 * (`traverse(root, "heading", { enter: (heading) => … })` hands the
	 * callback a `Heading`). The walk still descends through every node, so a
	 * selector filters callbacks, never the tree; `SKIP` applies to the matched
	 * node's subtree.
	 *
	 * Returns `Option.none()` when the walk ends normally or by `EXIT`, and
	 * `Option.some` of a `NestingDepthExceeded` {@link MarkdownDiagnostic} when
	 * the depth guard ended it — which only a hand-constructed tree can do: a
	 * tree from `Markdown.parse` or `Mdast.fromMdast` never trips it. Not named
	 * `traverseResult`, because a depth trip is not a failure of the walk but
	 * the end of it, reported the way `walk` reports it as an `Error` event.
	 *
	 * @example
	 * ```ts
	 * import { Markdown, MarkdownVisitor } from "@effected/markdown";
	 * import { Result } from "effect";
	 *
	 * const root = Result.getOrThrow(Markdown.parseResult("# A\n\n> # B\n\n## C\n"));
	 * const depths: Array<number> = [];
	 * MarkdownVisitor.traverse(root, ["heading", "blockquote"], {
	 *   enter: (node) => {
	 *     if (node.type === "blockquote") return MarkdownVisitor.SKIP;
	 *     depths.push(node.depth);
	 *     return undefined;
	 *   },
	 * });
	 * console.log(depths);
	 * // => [1, 2]
	 * ```
	 *
	 * @param root - The tree to walk.
	 * @param visitor - The `enter`/`exit` callbacks.
	 * @returns `Option.none()`, or the depth-guard diagnostic that ended the walk.
	 */
	static traverse(root: Root, visitor: MarkdownTraverseVisitor): Option.Option<MarkdownDiagnostic>;
	/**
	 * Walk `root`, calling `visitor` only for nodes whose `type` is `type` (or
	 * one of the types in the array), each typed as its node class.
	 *
	 * @param root - The tree to walk.
	 * @param type - The node type, or types, the callbacks receive.
	 * @param visitor - The `enter`/`exit` callbacks, typed by `type`.
	 * @returns `Option.none()`, or the depth-guard diagnostic that ended the walk.
	 */
	static traverse<T extends MarkdownNodeType>(
		root: Root,
		type: T | ReadonlyArray<T>,
		visitor: MarkdownTraverseVisitor<MarkdownNodeOfType<T>>,
	): Option.Option<MarkdownDiagnostic>;
	static traverse(
		root: Root,
		selectorOrVisitor: MarkdownNodeType | ReadonlyArray<MarkdownNodeType> | MarkdownTraverseVisitor,
		maybeVisitor?: MarkdownTraverseVisitor,
	): Option.Option<MarkdownDiagnostic> {
		const selected: ReadonlySet<string> | undefined =
			typeof selectorOrVisitor === "string"
				? new Set([selectorOrVisitor])
				: Array.isArray(selectorOrVisitor)
					? new Set<string>(selectorOrVisitor)
					: undefined;
		const visitor = (selected === undefined ? selectorOrVisitor : maybeVisitor) as MarkdownTraverseVisitor | undefined;
		const enter = visitor?.enter;
		const exit = visitor?.exit;
		const ancestors: Array<MarkdownNode> = [];
		// snapshots[n] is a frozen copy of the first n ancestors, shared by
		// every callback that sees that stack: a parent's enter and exit, and
		// all of its children. A push replaces the stack's top, so it drops
		// the snapshot of the new length; a pop leaves every shorter prefix,
		// and its snapshot, intact. A copy is made only when a callback runs,
		// once per distinct stack rather than twice per node.
		const snapshots: Array<ReadonlyArray<MarkdownNode>> = [];
		const snapshot = (): ReadonlyArray<MarkdownNode> => {
			const cached = snapshots[ancestors.length];
			if (cached !== undefined) return cached;
			const copy = Object.freeze(ancestors.slice());
			snapshots[ancestors.length] = copy;
			return copy;
		};
		const events = walkNode(root, [], 0);
		let reply: MarkdownVisitAction | undefined;
		for (;;) {
			const step = events.next(reply);
			reply = undefined;
			if (step.done === true) return Option.none();
			const event = step.value;
			if (event._tag === "Error") return Option.some(event.diagnostic);
			const matches = selected === undefined || selected.has(event.node.type);
			if (event._tag === "Enter") {
				if (matches && enter !== undefined) {
					const action = enter(event.node, { path: event.path, depth: event.depth, ancestors: snapshot() });
					if (action === "exit") {
						events.return(false);
						return Option.none();
					}
					if (action === "skip") reply = "skip";
				}
				ancestors.push(event.node);
				if (snapshots.length > ancestors.length) snapshots.length = ancestors.length;
			} else {
				ancestors.pop();
				if (matches && exit !== undefined) {
					const action = exit(event.node, { path: event.path, depth: event.depth, ancestors: snapshot() });
					if (action === "exit") {
						events.return(false);
						return Option.none();
					}
				}
			}
		}
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

// The one engine behind `walk`, `visit` and `traverse`. Each `Enter` yield
// receives the consumer's reply through `next(...)`: `"skip"` keeps the walk
// out of the node's children. `walk` iterates with `for…of`, which always
// replies `undefined`, so it never skips. Children are walked by `yield*`
// delegation so a reply reaches the generator that yielded the `Enter`, and
// each level returns `true` when the depth guard ended the walk, which stops
// every ancestor at once with nothing after the `Error` event.
function* walkNode(
	node: MarkdownNode,
	path: MarkdownPath,
	depth: number,
): Generator<MarkdownVisitorEvent, boolean, MarkdownVisitAction | undefined> {
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
		return true;
	}

	const reply = yield MarkdownVisitorEvent.Enter({ node, path, depth });

	if (reply !== "skip" && "children" in node) {
		const children = node.children as ReadonlyArray<MarkdownNode>;
		for (let index = 0; index < children.length; index++) {
			const child = children[index] as MarkdownNode;
			// Terminal: a depth trip anywhere below aborts the whole walk,
			// mirroring stringify's whole-operation typed failure.
			if (yield* walkNode(child, [...path, index], depth + 1)) return true;
		}
	}

	yield MarkdownVisitorEvent.Exit({ node, path, depth });
	return false;
}
