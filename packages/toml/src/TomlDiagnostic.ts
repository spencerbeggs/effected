// The structured diagnostic concept: TomlDiagnostic and the staged
// error-code literal unions.
//
// Cycle firewall: the internal engine emits raw `{ code, message, offset,
// length }` records; this module materializes them into `TomlDiagnostic`,
// deriving `line`/`character` from `offset` against the source text through
// `@effected/source`'s `LineIndex`. The dependency edge runs public modules →
// engine only.

import { LineIndex } from "@effected/source";
import { Schema } from "effect";
import {
	TOML_LEX_ERROR_CODES,
	TOML_PARSE_ERROR_CODES,
	TOML_SEMANTIC_ERROR_CODES,
	TOML_STRINGIFY_ERROR_CODES,
} from "./internal/diagnostics.js";

/**
 * Error codes emitted by the lexer stage.
 *
 * @public
 */
export const TomlLexErrorCode = Schema.Literals(TOML_LEX_ERROR_CODES);

/**
 * The union of all lexer-stage error code string literals.
 *
 * @public
 */
export type TomlLexErrorCode = typeof TomlLexErrorCode.Type;

/**
 * Error codes emitted by the parser stage.
 *
 * @public
 */
export const TomlParseErrorCode = Schema.Literals(TOML_PARSE_ERROR_CODES);

/**
 * The union of all parser-stage error code string literals.
 *
 * @public
 */
export type TomlParseErrorCode = typeof TomlParseErrorCode.Type;

/**
 * Error codes emitted by the semantic (table/key conflict) stage.
 *
 * @public
 */
export const TomlSemanticErrorCode = Schema.Literals(TOML_SEMANTIC_ERROR_CODES);

/**
 * The union of all semantic-stage error code string literals.
 *
 * @public
 */
export type TomlSemanticErrorCode = typeof TomlSemanticErrorCode.Type;

/**
 * Error codes emitted by the stringifier stage.
 *
 * @public
 */
export const TomlStringifyErrorCode = Schema.Literals(TOML_STRINGIFY_ERROR_CODES);

/**
 * The union of all stringifier-stage error code string literals.
 *
 * @public
 */
export type TomlStringifyErrorCode = typeof TomlStringifyErrorCode.Type;

/**
 * Union of all TOML error codes across all pipeline stages. Stage
 * discrimination lives here (in the code), not in separate error classes.
 *
 * @public
 */
export const TomlErrorCode = Schema.Union([
	TomlLexErrorCode,
	TomlParseErrorCode,
	TomlSemanticErrorCode,
	TomlStringifyErrorCode,
]);

/**
 * The union of all TOML error code string literals.
 *
 * @public
 */
export type TomlErrorCode = typeof TomlErrorCode.Type;

/**
 * One structured diagnostic: its {@link (TomlErrorCode:type)}, a
 * human-readable `message`, and its exact position (`offset`/`length`, plus
 * zero-based `line`/`character`).
 *
 * @remarks
 * The five-field positional core (`code`/`offset`/`length`/`line`/`character`)
 * is structurally identical to `@effected/jsonc`'s parse-error detail shape
 * and `@effected/yaml`'s `YamlDiagnostic`; `message` is this package's
 * additive extra.
 *
 * With `message` it satisfies `@effected/source`'s `SourceDiagnostic`
 * structurally, so a consumer written over that interface (an LSP server, a
 * CLI printing annotations) reads it directly. `line` and `character` come
 * from `@effected/source`'s `LineIndex` under its default `"lsp"` rule: a line
 * ends at `\n`, `\r\n` or a bare `\r`, as an LSP client counts. TOML's own
 * newline is `\n` or `\r\n` only, so a bare `\r` is invalid TOML; it is
 * counted as a line break only so a diagnostic about it positions LSP-style.
 * An offset at the `\n` of a `\r\n` reads as the end of its line.
 *
 * @public
 */
export class TomlDiagnostic extends Schema.Class<TomlDiagnostic>("TomlDiagnostic")({
	code: TomlErrorCode,
	message: Schema.String,
	offset: Schema.Number,
	length: Schema.Number,
	line: Schema.Number,
	character: Schema.Number,
}) {
	/**
	 * Materialize an engine record, deriving `line`/`character` (0-based)
	 * from `offset` against the source text. Advanced — the parse/stringify
	 * entry points call this for you.
	 *
	 * @param source - The source text the record's `offset` indexes into.
	 * @param raw - The engine record: `code`, `message`, `offset` and `length`.
	 * @returns The diagnostic with `line` and `character` filled in.
	 */
	static fromRaw(
		source: string,
		raw: { readonly code: TomlErrorCode; readonly message: string; readonly offset: number; readonly length: number },
	): TomlDiagnostic {
		// Every parse, stringify and modify path materializes at most one
		// diagnostic, so one line table per call is one per parse.
		const { line, character } = LineIndex.make(source).positionAt(raw.offset);
		return TomlDiagnostic.make({
			code: raw.code,
			message: raw.message,
			offset: raw.offset,
			length: raw.length,
			line,
			character,
		});
	}
}
