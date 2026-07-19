// The lossless unit: source text plus the parsed tree, the materialized
// diagnostics and the link-reference definition index, in one Schema class.
//
// Cycle firewall: this module never touches raw carriers directly — it shares
// `Markdown.ts`'s single carrier-catching helper, so the document and the
// bare-tree entry points agree exactly on what is a typed failure and what is
// a defect.

import { Effect, Result, Schema } from "effect";
import type { MarkdownParseError, MarkdownParseOptions } from "./Markdown.js";
import { parsePassResult } from "./Markdown.js";
import { MarkdownDiagnostic } from "./MarkdownDiagnostic.js";
import { Definition, Root } from "./MarkdownNode.js";

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
 * Navigation accessors (headings, sections, links) are P5 scope.
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
