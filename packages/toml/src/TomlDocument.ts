// The lossless document concept: TomlDocument pairs the source text with the
// parser's linear expression CST and any semantic violations as diagnostics
// data. Syntax errors fail `parse` typed; a syntactically valid but
// semantically illegal document still parses, stays editable, and refuses
// only at `toValue`.
//
// Cycle firewall: same discipline as `Toml.ts` — the engine throws raw
// carriers (`RawTomlError`, `GuardExceeded`); this module materializes
// `TomlDiagnostic` instances and the tagged `TomlParseError`. The dependency
// edge runs facade → engine only.

import { Effect, Result, Schema, SchemaIssue, SchemaTransformation } from "effect";
import { isRawTomlError } from "./internal/diagnostics.js";
import { parseExpressions } from "./internal/parser.js";
import { analyze, buildValue } from "./internal/semantic.js";
import { TomlParseError, toTomlParseError } from "./Toml.js";
import { TomlDiagnostic } from "./TomlDiagnostic.js";
import { TomlExpression } from "./TomlNode.js";

/**
 * A parsed TOML document that never loses a byte: the `source` text, the
 * linear {@link (TomlExpression:type)} CST whose spans tile the source
 * exactly, and
 * any semantic violations as {@link TomlDiagnostic} data.
 *
 * @remarks
 * `parse` fails typed only on lex/parse errors; a syntactically valid but
 * semantically illegal document (say, a duplicate key) still parses with the
 * violation recorded in `diagnostics`, so the text stays inspectable and
 * editable. `stringify` reconstructs the source by concatenating expression
 * spans — that the result equals `source` is the span-bookkeeping proof, held
 * byte-exact across the full toml-test corpus. `toValue` refuses on a
 * non-empty `diagnostics`.
 *
 * Construct via {@link TomlDocument.parse}; `TomlDocument.make` is for
 * synthetic documents.
 *
 * @example
 * ```ts
 * import { TomlDocument } from "@effected/toml";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const doc = yield* TomlDocument.parse('name = "Alice"\n');
 *   doc.stringify(); // 'name = "Alice"\n' — byte-exact
 *   return yield* doc.toValue(); // { name: "Alice" }
 * });
 * ```
 *
 * @public
 */
export class TomlDocument extends Schema.Class<TomlDocument>("TomlDocument")({
	source: Schema.String,
	expressions: Schema.Array(TomlExpression),
	diagnostics: Schema.Array(TomlDiagnostic),
}) {
	/**
	 * Synchronous {@link TomlDocument.parse}, returning a `Result` instead of
	 * an `Effect` — the primitive `parse` is defined in terms of, so a
	 * synchronous host can call it without an Effect runtime. Fails with
	 * {@link TomlParseError} only on lex/parse errors — including a
	 * nesting-depth bomb, which surfaces as a `NestingDepthExceeded`
	 * diagnostic, never a throw. Semantic violations do not fail: they land in
	 * `diagnostics` as data (first violation wins, so there is at most one
	 * today; the array shape is the contract).
	 *
	 * @example
	 * ```ts
	 * import { TomlDocument } from "@effected/toml";
	 * import { Result } from "effect";
	 *
	 * const result = TomlDocument.parseResult('name = "Alice"\n');
	 * if (Result.isSuccess(result)) {
	 *   console.log(result.success.stringify()); // => 'name = "Alice"\n'
	 * }
	 * ```
	 *
	 * @param text - The TOML source to parse.
	 * @returns A `Result` succeeding with the {@link TomlDocument}, or failing
	 *   with {@link TomlParseError}.
	 */
	static parseResult(text: string): Result.Result<TomlDocument, TomlParseError> {
		return Result.map(
			Result.try({
				try: () => parseExpressions(text),
				catch: (defect) => toTomlParseError(text, defect),
			}),
			(expressions) => {
				const diagnostics: Array<TomlDiagnostic> = [];
				try {
					analyze(expressions);
				} catch (defect) {
					if (!isRawTomlError(defect)) {
						throw defect;
					}
					diagnostics.push(TomlDiagnostic.fromRaw(text, defect.diagnostic));
				}
				return TomlDocument.make({ source: text, expressions, diagnostics });
			},
		);
	}

	/**
	 * Parse TOML text into a lossless document. Fails with
	 * {@link TomlParseError} only on lex/parse errors — including a
	 * nesting-depth bomb, which surfaces as a `NestingDepthExceeded`
	 * diagnostic, never an unhandled defect. Semantic violations do not fail:
	 * they land in `diagnostics` as data. Defined in terms of
	 * {@link TomlDocument.parseResult} — synchronous callers can use that
	 * variant directly.
	 *
	 * @param text - The TOML source to parse.
	 * @returns An `Effect` that succeeds with the {@link TomlDocument}, or fails
	 *   with {@link TomlParseError}.
	 */
	static readonly parse = Effect.fn("TomlDocument.parse")((text: string) =>
		Effect.fromResult(TomlDocument.parseResult(text)),
	);

	/**
	 * A `Schema<TomlDocument, string>` decoding TOML text into a full document
	 * (source, expressions, diagnostics) and encoding a document back to its
	 * byte-exact text.
	 *
	 * Schema-producing: each call returns a fresh schema whose derivation
	 * caches are not shared across calls; bind the result to a `const` on hot
	 * paths.
	 */
	static schema(): Schema.Codec<TomlDocument, string> {
		return Schema.String.pipe(
			Schema.decodeTo(
				Schema.instanceOf(TomlDocument),
				SchemaTransformation.transformEffect({
					decode: (input: string) =>
						TomlDocument.parse(input).pipe(
							Effect.mapError((error) => new SchemaIssue.InvalidValue({ message: error.message }, input)),
						),
					encode: (doc: TomlDocument) => Effect.succeed(doc.stringify()),
				}),
			),
		);
	}

	/**
	 * Materialize the document's plain JavaScript value. Fails with
	 * {@link TomlParseError} carrying the stored `diagnostics` when the parse
	 * recorded semantic violations; otherwise builds the value from the
	 * expression list (already validated, so the defensive materialization
	 * wrapper is belt-and-suspenders). Defined in terms of
	 * {@link TomlDocument.toValueResult} — synchronous callers can use that
	 * variant directly.
	 *
	 * @returns An `Effect` that succeeds with the plain value, or fails with
	 *   {@link TomlParseError}.
	 */
	toValue(): Effect.Effect<unknown, TomlParseError> {
		// Suspended so the value is built when the Effect runs, not when
		// `toValue()` is called — a genuine engine defect then dies inside the
		// Effect rather than throwing out of the method call.
		return Effect.suspend(() => Effect.fromResult(this.toValueResult()));
	}

	/**
	 * Synchronous {@link TomlDocument.toValue}, returning a `Result` — the
	 * second half of a synchronous document round-trip that starts at
	 * {@link TomlDocument.parseResult}. Fails with {@link TomlParseError}
	 * carrying the stored `diagnostics` when the parse recorded semantic
	 * violations.
	 *
	 * @example
	 * ```ts
	 * import { TomlDocument } from "@effected/toml";
	 * import { Result } from "effect";
	 *
	 * const parsed = TomlDocument.parseResult("a = 1\na = 2\n");
	 * if (Result.isSuccess(parsed)) {
	 *   const value = parsed.success.toValueResult();
	 *   console.log(Result.isFailure(value)); // => true — DuplicateKey
	 * }
	 * ```
	 *
	 * @returns A `Result` succeeding with the plain value, or failing with
	 *   {@link TomlParseError}.
	 */
	toValueResult(): Result.Result<unknown, TomlParseError> {
		if (this.diagnostics.length > 0) {
			return Result.fail(new TomlParseError({ diagnostics: this.diagnostics }));
		}
		return Result.try({
			try: () => buildValue(this.expressions),
			catch: (defect) => toTomlParseError(this.source, defect),
		});
	}

	/**
	 * Reconstruct the document text by concatenating each expression's source
	 * span in order. The expression spans tile the source exactly, so the
	 * result equals `source` byte-for-byte — the round-trip contract this
	 * class exists to prove. Pure and total.
	 */
	stringify(): string {
		let out = "";
		for (const expression of this.expressions) {
			out += this.source.slice(expression.offset, expression.offset + expression.length);
		}
		return out;
	}
}
