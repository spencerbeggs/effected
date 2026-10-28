// The structured diagnostic concept: MarkdownDiagnostic and the
// error-code literal union.
//
// Cycle firewall: the internal engine emits raw `{ code, message, offset,
// length }` records (src/internal/carriers.ts); this module materializes
// them into MarkdownDiagnostic, deriving `line`/`character` from `offset`
// through `@effected/source`'s `LineIndex` over the source text. The dependency edge runs public modules ->
// engine only (toml src/TomlDiagnostic.ts precedent).

import type { SourceIndex } from "@effected/source";
import { LineIndex } from "@effected/source";
import { Schema } from "effect";
import { MARKDOWN_PARSE_ERROR_CODES } from "./internal/carriers.js";

/**
 * Error codes `Markdown.parse`/`MarkdownDocument.parse` can fail with.
 * Currently exactly one, `"NestingDepthExceeded"`, the hardening-guard trip;
 * the union may widen as new fatal conditions are identified.
 *
 * @public
 */
export const MarkdownParseErrorCode = Schema.Literals(MARKDOWN_PARSE_ERROR_CODES);

/**
 * The union of all markdown parse-error code string literals.
 *
 * @public
 */
export type MarkdownParseErrorCode = typeof MarkdownParseErrorCode.Type;

/**
 * One structured diagnostic: its {@link (MarkdownParseErrorCode:type)}, a
 * human-readable `message`, and its exact position (`offset`/`length`, plus
 * zero-based `line`/`character`).
 *
 * @remarks
 * Satisfies `@effected/source`'s `SourceDiagnostic<MarkdownParseErrorCode>`:
 * the positional core (`code`/`message`/`offset`/`length`/`line`/`character`)
 * the kit's format packages share, so a consumer printing or serving
 * diagnostics (an LSP server, a CLI annotation) is written once against that
 * shape. `line`/`character` are zero-based, `character` in UTF-16 code units,
 * with `\n`, `\r\n` and a bare `\r` as line breaks: exactly
 * `LineIndex.make(source).positionAt(offset)`, and the same index
 * {@link MarkdownDocument.lineIndex} returns. An offset at the `\n` of a
 * `\r\n` reads as the end of its line.
 *
 * The one-based `line`/`column` unist `Point`s carried on `MarkdownNode`
 * positions read the same index, one-based: a deliberate, different
 * convention for the AST rather than a mismatch to reconcile (see
 * {@link MarkdownDocument.lineIndex} for the exact mapping).
 *
 * @public
 */
export class MarkdownDiagnostic extends Schema.Class<MarkdownDiagnostic>("MarkdownDiagnostic")({
	code: MarkdownParseErrorCode,
	message: Schema.String,
	offset: Schema.Number,
	length: Schema.Number,
	line: Schema.Number,
	character: Schema.Number,
}) {
	/**
	 * Materialize an engine record, deriving zero-based `line`/`character`
	 * from `offset` against the source text. Advanced — the parse entry
	 * points call this for you.
	 *
	 * @remarks
	 * Pass a line index already built over the source to materialize many
	 * records without rescanning the text; a string builds one. The
	 * parameter is the structural `SourceIndex`, so an index from any
	 * installed copy of `@effected/source` is accepted. An offset
	 * outside the source clamps into it, as `LineIndex.positionAt` does.
	 *
	 * @param source - The source text the record's `offset` indexes into, or
	 *   a `LineIndex` over it.
	 * @param raw - The engine record: `code`, `message`, `offset` and `length`.
	 * @returns The diagnostic with `line` and `character` filled in.
	 */
	static fromRaw(
		source: string | SourceIndex,
		raw: {
			readonly code: MarkdownParseErrorCode;
			readonly message: string;
			readonly offset: number;
			readonly length: number;
		},
	): MarkdownDiagnostic {
		const index = typeof source === "string" ? LineIndex.make(source) : source;
		const { line, character } = index.positionAt(raw.offset);
		return MarkdownDiagnostic.make({
			code: raw.code,
			message: raw.message,
			offset: raw.offset,
			length: raw.length,
			line,
			character,
		});
	}
}
