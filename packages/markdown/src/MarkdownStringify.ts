// Canonical serialization as free functions, so a consumer that only EMITS
// markdown bundles the serializer without the parser.
//
// A bundler cannot drop an unused static member of a class, so serialization
// living only on `Markdown` dragged the block and inline passes into every
// bundle that stringified a tree. This module is the serializer's home; the
// `Markdown.stringify`/`Markdown.stringifyResult` statics delegate to it.
//
// Its import graph is load-bearing and pinned by
// `__test__/stringify-entry.test.ts`: it must never reach `Markdown.ts`,
// `MarkdownDocument.ts`, the block or inline passes, or the entity table.
// The stringifier's escape set reads the entity GRAMMAR from the
// `internal/grammar.ts` leaf for exactly that reason.

import { Effect, Result, Schema } from "effect";
import { isGuardExceeded } from "./internal/carriers.js";
import { stringifyBlocks } from "./internal/stringify.js";
import { assertWithinNestingDepth } from "./internal/treeDepth.js";
import { MarkdownDiagnostic } from "./MarkdownDiagnostic.js";
import type { FlowContent, Root } from "./MarkdownNode.js";
import { MarkdownTransform } from "./MarkdownTransform.js";

/**
 * Options for `stringify` and `stringifyResult` (and the `Markdown` statics
 * of the same names).
 *
 * @public
 */
export interface MarkdownStringifyOptions {
	/**
	 * Ignore fidelity fields (marker characters, fence style, heading
	 * spelling) and emit the canonical form. Defaults to `false`, which honours
	 * them.
	 */
	readonly canonical?: boolean;
}

/**
 * Stringify failure: the {@link MarkdownDiagnostic} describing why the tree
 * was refused.
 *
 * @remarks
 * Serialization is total over parser-produced trees — the parser cannot
 * produce one that nests past the guard, because parsing it would have been
 * refused first. The only failures here are hardening-guard trips on
 * synthesized or decoded hostile trees, symmetric with `MarkdownParseError`'s
 * posture on parse. Stringify has no source text to derive positions from,
 * so the diagnostic's `line`/`character` are `0` and `offset` carries
 * whatever the offending node's position claimed.
 *
 * @public
 */
export class MarkdownStringifyError extends Schema.TaggedError<MarkdownStringifyError>()("MarkdownStringifyError", {
	diagnostic: MarkdownDiagnostic,
}) {
	override get message(): string {
		const { code, message } = this.diagnostic;
		return `Markdown stringify failed: ${code} ${message}`;
	}
}

/**
 * Serialize a {@link Root} tree, or a single {@link (FlowContent:type)} node,
 * to canonical markdown, synchronously, as a `Result`.
 *
 * @remarks
 * The free-function form of `Markdown.stringifyResult`, which delegates here:
 * the two are one implementation, so their bytes can never differ. The
 * canonical-form table, the single-flow-node rule, the `Code` indentation
 * default and the `canonical: true` option are documented on
 * `Markdown.stringifyResult`, and the canonical form is a published stability
 * commitment either way.
 *
 * Reach for this function (or the `@effected/markdown/stringify` entry point,
 * which exports it with the node classes and nothing else) when a bundle only
 * emits markdown: unlike a static on `Markdown`, it does not keep the parser
 * reachable.
 *
 * @example
 * ```ts
 * import { Heading, Root, Text, stringifyResult } from "@effected/markdown/stringify";
 * import { Result } from "effect";
 *
 * const tree = Root.make({
 *   children: [Heading.make({ depth: 2, children: [Text.make({ value: "Usage" })] })],
 * });
 * console.log(Result.getOrThrow(stringifyResult(tree))); // => "## Usage\n"
 * ```
 *
 * @param node - The document tree, or a single flow node, to serialize.
 * @param options - Optional {@link MarkdownStringifyOptions}.
 * @returns A `Result` succeeding with markdown source, or failing with
 *   {@link MarkdownStringifyError}.
 *
 * @public
 */
export const stringifyResult = (
	node: Root | FlowContent,
	options?: MarkdownStringifyOptions,
): Result.Result<string, MarkdownStringifyError> => {
	try {
		// One path: a lone flow node is serialized as the one-block list a
		// `Root` holding it would carry. No wrapper is constructed, so a node
		// fails or succeeds here exactly as it would inside a `Root`.
		// The canonicalizing walk is unguarded recursion; probe the depth
		// iteratively first so both paths fail typed at the same limit.
		if (options?.canonical === true) assertWithinNestingDepth(node);
		const source = options?.canonical === true ? MarkdownTransform.canonicalize(node) : node;
		return Result.succeed(stringifyBlocks(source.type === "root" ? source.children : [source]));
	} catch (caught) {
		if (isGuardExceeded(caught)) {
			return Result.fail(
				new MarkdownStringifyError({
					diagnostic: MarkdownDiagnostic.make({
						code: caught.reason,
						message: caught.message,
						offset: caught.offset,
						length: 0,
						line: 0,
						character: 0,
					}),
				}),
			);
		}
		throw caught;
	}
};

/**
 * Serialize a {@link Root} tree, or a single {@link (FlowContent:type)} node,
 * to canonical markdown. Defined in terms of {@link stringifyResult} —
 * synchronous callers can use that variant directly.
 *
 * @remarks
 * The free-function form of `Markdown.stringify`, which is this very
 * function: it carries the same `Markdown.stringify` tracing span, so a trace
 * reads the same whichever spelling the caller used.
 *
 * **Fidelity fields must be set on the DECODED tree.** `Mdast.fromMdast`
 * admits spec mdast and strips everything outside it, so a `fenceChar`,
 * `headingStyle`, `markerChar` or `delimiter` placed on a plain mdast tree
 * before admission is silently dropped and the canonical default applies.
 * The exception is `Text`'s `escapeStyle`, which the boundary admits.
 *
 * @param node - The document tree, or a single flow node, to serialize.
 * @param options - Optional {@link MarkdownStringifyOptions}; `canonical: true`
 *   discards fidelity fields.
 * @returns An `Effect` that succeeds with markdown source, or fails with
 *   {@link MarkdownStringifyError}.
 *
 * @public
 */
export const stringify: (
	node: Root | FlowContent,
	options?: MarkdownStringifyOptions,
) => Effect.Effect<string, MarkdownStringifyError> = Effect.fn("Markdown.stringify")(
	(node: Root | FlowContent, options?: MarkdownStringifyOptions) => Effect.fromResult(stringifyResult(node, options)),
);
