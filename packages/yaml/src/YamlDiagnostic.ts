// The structured diagnostic concept: YamlDiagnostic (carried by both error
// payloads and YamlDocument's warnings-as-data arrays), the staged error-code
// literal unions, and the single fatal-code predicate.
//
// Cycle firewall: the internal engine emits raw `{ code, message, offset,
// length }` records; this module materializes them into `YamlDiagnostic`,
// deriving `line`/`character` from `offset` through `@effected/source`'s
// `LineIndex` over the source text. The dependency edge runs public modules →
// engine only.
//
// The positional core (`code`/`message`/`offset`/`length`/`line`/`character`)
// is `@effected/source`'s `SourceDiagnostic`, the shape every kit format
// package's diagnostic satisfies.

import type { SourceIndex } from "@effected/source";
import { LineIndex } from "@effected/source";
import { Schema } from "effect";
import {
	YAML_COMPOSE_ERROR_CODES,
	YAML_LEX_ERROR_CODES,
	YAML_MODIFY_ERROR_CODES,
	YAML_PARSE_ERROR_CODES,
	YAML_STRINGIFY_ERROR_CODES,
	isFatalCode,
} from "./internal/diagnostics.js";

/**
 * Error codes emitted by the lexer stage.
 *
 * @public
 */
export const YamlLexErrorCode = Schema.Literals(YAML_LEX_ERROR_CODES);

/**
 * The union of all lexer-stage error code string literals.
 *
 * @public
 */
export type YamlLexErrorCode = typeof YamlLexErrorCode.Type;

/**
 * Error codes emitted by the CST-parser stage.
 *
 * @public
 */
export const YamlParseErrorCode = Schema.Literals(YAML_PARSE_ERROR_CODES);

/**
 * The union of all parser-stage error code string literals.
 *
 * @public
 */
export type YamlParseErrorCode = typeof YamlParseErrorCode.Type;

/**
 * Error codes emitted by the composer stage.
 *
 * @public
 */
export const YamlComposerErrorCode = Schema.Literals(YAML_COMPOSE_ERROR_CODES);

/**
 * The union of all composer-stage error code string literals.
 *
 * @public
 */
export type YamlComposerErrorCode = typeof YamlComposerErrorCode.Type;

/**
 * Error codes emitted by the stringifier: `CircularReference` (the value or
 * synthetic AST points back at itself) and `UnrepresentableValue` (a function
 * or symbol, which has no YAML rendering and is never written as its
 * `String()` form).
 *
 * @public
 */
export const YamlStringifyErrorCode = Schema.Literals(YAML_STRINGIFY_ERROR_CODES);

/**
 * The union of all stringifier-stage error code string literals.
 *
 * @public
 */
export type YamlStringifyErrorCode = typeof YamlStringifyErrorCode.Type;

/**
 * Error codes emitted by `YamlFormat.modify`'s path navigation against an
 * already-composed AST — not raised by the parser/composer/stringifier.
 *
 * @public
 */
export const YamlModifyErrorCode = Schema.Literals(YAML_MODIFY_ERROR_CODES);

/**
 * The union of all modify-stage error code string literals.
 *
 * @public
 */
export type YamlModifyErrorCode = typeof YamlModifyErrorCode.Type;

/**
 * Union of all YAML error codes across all pipeline stages. Stage
 * discrimination lives here (in the code), not in separate error classes.
 *
 * @public
 */
export const YamlErrorCode = Schema.Union([
	YamlLexErrorCode,
	YamlParseErrorCode,
	YamlComposerErrorCode,
	YamlStringifyErrorCode,
	YamlModifyErrorCode,
]);

/**
 * The union of all YAML error code string literals.
 *
 * @public
 */
export type YamlErrorCode = typeof YamlErrorCode.Type;

/**
 * One structured diagnostic: its {@link (YamlErrorCode:type)}, a
 * human-readable `message`, and its exact position (`offset`/`length`, plus
 * zero-based `line`/`character`). Used for both errors and warnings-as-data;
 * fatality is a property of the code — see {@link YamlDiagnostic.isFatal}.
 *
 * @remarks
 * Satisfies `@effected/source`'s `SourceDiagnostic<YamlErrorCode>`: the
 * positional core (`code`/`message`/`offset`/`length`/`line`/`character`)
 * the kit's format packages share, so a consumer printing or serving
 * diagnostics (an LSP server, a CLI annotation) is written once against that
 * shape. `line`/`character` are zero-based, `character` in UTF-16 code units,
 * with `\n`, `\r\n` and a bare `\r` as line breaks, YAML 1.2's own
 * `b-break` set: exactly `LineIndex.make(text).positionAt(offset)`. U+2028
 * and U+2029 are not line breaks (YAML 1.2 dropped them, the lexer never
 * treated them as one, and neither does an LSP client), and an offset at the
 * `\n` of a `\r\n` reads as the end of its line.
 *
 * @public
 */
export class YamlDiagnostic extends Schema.Class<YamlDiagnostic>("YamlDiagnostic")({
	code: YamlErrorCode,
	message: Schema.String,
	offset: Schema.Number,
	length: Schema.Number,
	line: Schema.Number,
	character: Schema.Number,
}) {
	/**
	 * The single fatal-code predicate: whether diagnostics with this code
	 * abort a parse (vs. being recoverable warnings-as-data). Declared once,
	 * as a property of the code.
	 *
	 * @param code - The diagnostic code to classify.
	 * @returns `true` when diagnostics with `code` abort a parse.
	 */
	static isFatal(code: YamlErrorCode): boolean {
		return isFatalCode(code);
	}

	/**
	 * Materialize a raw engine diagnostic record into a `YamlDiagnostic`,
	 * deriving `line`/`character` from `offset` against the source `text`.
	 * Advanced — the parse/stringify entry points call this for you.
	 *
	 * @remarks
	 * Pass a line index already built over the source to materialize many
	 * records without rescanning the text; a string builds one. The
	 * parameter is the structural `SourceIndex`, so an index from any
	 * installed copy of `@effected/source` is accepted. An offset
	 * outside the source clamps into it, as `LineIndex.positionAt` does.
	 *
	 * @param raw - The engine record: `code`, `message`, `offset` and `length`.
	 * @param text - The source text the record's `offset` indexes into, or a
	 *   `LineIndex` over it.
	 * @returns The diagnostic with `line` and `character` filled in.
	 */
	static fromRaw(
		raw: { readonly code: YamlErrorCode; readonly message: string; readonly offset: number; readonly length: number },
		text: string | SourceIndex,
	): YamlDiagnostic {
		const index = typeof text === "string" ? LineIndex.make(text) : text;
		const { line, character } = index.positionAt(raw.offset);
		return YamlDiagnostic.make({
			code: raw.code,
			message: raw.message,
			offset: raw.offset,
			length: raw.length,
			line,
			character,
		});
	}
}

/**
 * A line index over `text`, built on first call and shared by every later
 * one: the parse entry points materialize all of a parse's diagnostics
 * against one index, and a parse with none never builds it.
 *
 * @internal
 */
export const lazyLineIndex = (text: string): (() => SourceIndex) => {
	let index: SourceIndex | undefined;
	return () => {
		index ??= LineIndex.make(text);
		return index;
	};
};
