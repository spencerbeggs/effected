// The parsed-document concept: YamlDocument (root AST node plus
// errors/warnings-as-data, directives and document framing) and
// YamlDirective.
//
// The recoverable-parse design lives here: non-fatal diagnostics surface as
// data on `errors`/`warnings` while fatal ones fail `parse`/`parseAll` with a
// typed `YamlParseError`.

import { Effect, Result, Schema, SchemaIssue, SchemaTransformation } from "effect";
import { composeAllDocuments, composeFirstDocument } from "./internal/composer/document.js";
import { isFatalCode } from "./internal/diagnostics.js";
import type { RawYamlDocument } from "./internal/raw-document.js";
import { stringifyDocument } from "./internal/stringifier.js";
import type { YamlParseOptions, YamlStringifyError, YamlStringifyOptions } from "./Yaml.js";
import { YamlParseError, stringifyDefectToError } from "./Yaml.js";
import { YamlDiagnostic } from "./YamlDiagnostic.js";
import type { YamlNode as YamlNodeType } from "./YamlNode.js";
import { YamlNode } from "./YamlNode.js";

/**
 * A YAML directive appearing before a document (e.g. `%YAML 1.2` or
 * `%TAG ! tag:example.com,2000:`). `"YAML"` and `"TAG"` are the YAML 1.2
 * spec-defined directives; any other name is a reserved directive preserved
 * for round-trip fidelity.
 *
 * @public
 */
export class YamlDirective extends Schema.Class<YamlDirective>("YamlDirective")({
	name: Schema.String,
	parameters: Schema.Array(Schema.String),
}) {}

/**
 * A parsed YAML document: the root {@link (YamlNode:type)} (or `null` when
 * empty), recovered `errors` and `warnings` as {@link YamlDiagnostic} data,
 * the {@link YamlDirective} list, the optional document-level comments and the
 * `---`/`...` framing flags (absent flags read as `false`).
 *
 * `commentBefore` is a header block sitting AHEAD of a `---` marker; `comment`
 * is the trailing block after the content or the `...` marker. A header with
 * no marker, or one after the marker, belongs to the content rather than the
 * document — it leads the root node, or the first entry when there is no
 * marker to separate it from the item stream.
 *
 * Construct via `YamlDocument.parse` / `parseAll`; `YamlDocument.make` is for
 * synthetic documents.
 *
 * @example
 * ```ts
 * import { YamlDocument } from "@effected/yaml";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const doc = yield* YamlDocument.parse("# header\nname: Alice\n");
 *   return doc.errors.length; // 0 — no recovered errors
 * });
 * ```
 *
 * @public
 */
export class YamlDocument extends Schema.Class<YamlDocument>("YamlDocument")({
	contents: Schema.NullOr(Schema.suspend((): Schema.Schema<YamlNodeType> => YamlNode)),
	errors: Schema.Array(YamlDiagnostic),
	warnings: Schema.Array(YamlDiagnostic),
	directives: Schema.Array(YamlDirective),
	commentBefore: Schema.optionalKey(Schema.String),
	comment: Schema.optionalKey(Schema.String),
	hasDocumentStart: Schema.optionalKey(Schema.Boolean),
	hasDocumentEnd: Schema.optionalKey(Schema.Boolean),
	hasDocumentStartTab: Schema.optionalKey(Schema.Boolean),
}) {
	/**
	 * Synchronous single-document parse, returning a `Result` instead of an
	 * `Effect`. This is the primitive {@link YamlDocument.parse} is defined in
	 * terms of — a synchronous host can call it without an Effect runtime.
	 * Keeps the full AST, directives and recovered diagnostics; fails with the
	 * aggregate {@link YamlParseError} when any fatal-code diagnostic is
	 * present, and non-fatal diagnostics are data on the returned document.
	 *
	 * @example
	 * ```ts
	 * import { YamlDocument } from "@effected/yaml";
	 * import { Result } from "effect";
	 *
	 * const result = YamlDocument.parseResult("name: Alice\n");
	 * if (Result.isSuccess(result)) {
	 *   console.log(result.success.toValue()); // => { name: "Alice" }
	 * }
	 * ```
	 *
	 * @param text - The YAML source to parse.
	 * @param options - Optional {@link YamlParseOptions}; defaults apply for
	 *   omitted fields.
	 * @returns A `Result` succeeding with the {@link YamlDocument}, or failing
	 *   with {@link YamlParseError}.
	 */
	static parseResult(text: string, options?: YamlParseOptions): Result.Result<YamlDocument, YamlParseError> {
		const raw = composeFirstDocument(text, toParseInput(options));
		const fatal = raw.errors.filter((e) => isFatalCode(e.code));
		if (fatal.length > 0) {
			return Result.fail(
				new YamlParseError({
					diagnostics: fatal.map((e) => YamlDiagnostic.fromRaw(e, text)),
					input: text,
				}),
			);
		}
		return Result.succeed(fromRawDocument(raw, text));
	}

	/**
	 * Parse a single YAML document, keeping the full AST, directives and
	 * recovered diagnostics. Fails with the aggregate {@link YamlParseError}
	 * when any fatal-code diagnostic is present; non-fatal diagnostics are
	 * data on the returned document. Defined in terms of
	 * {@link YamlDocument.parseResult} — synchronous callers can use that
	 * variant directly.
	 *
	 * @param text - The YAML source to parse.
	 * @param options - Optional {@link YamlParseOptions}; defaults apply for
	 *   omitted fields.
	 * @returns An `Effect` that succeeds with the {@link YamlDocument}, or fails
	 *   with {@link YamlParseError}.
	 */
	static readonly parse = Effect.fn("YamlDocument.parse")((text: string, options?: YamlParseOptions) =>
		Effect.fromResult(YamlDocument.parseResult(text, options)),
	);

	/**
	 * Synchronous multi-document parse, returning a `Result` instead of an
	 * `Effect` — the primitive {@link YamlDocument.parseAll} is defined in
	 * terms of. Any fatal diagnostic in any document — or a stream-level
	 * directive-placement error — fails the whole parse with one aggregate
	 * {@link YamlParseError}.
	 *
	 * @example
	 * ```ts
	 * import { YamlDocument } from "@effected/yaml";
	 * import { Result } from "effect";
	 *
	 * const result = YamlDocument.parseAllResult("a: 1\n---\nb: 2\n");
	 * if (Result.isSuccess(result)) {
	 *   console.log(result.success.length); // => 2
	 * }
	 * ```
	 *
	 * @param text - The YAML stream to parse.
	 * @param options - Optional {@link YamlParseOptions}; defaults apply for
	 *   omitted fields.
	 * @returns A `Result` succeeding with one {@link YamlDocument} per
	 *   document, or failing with {@link YamlParseError}.
	 */
	static parseAllResult(
		text: string,
		options?: YamlParseOptions,
	): Result.Result<ReadonlyArray<YamlDocument>, YamlParseError> {
		const { documents, streamErrors } = composeAllDocuments(text, toParseInput(options));
		const fatal = [
			...streamErrors.filter((e) => e.code === "InvalidDirective"),
			...documents.flatMap((d) => d.errors.filter((e) => isFatalCode(e.code))),
		];
		if (fatal.length > 0) {
			return Result.fail(
				new YamlParseError({
					diagnostics: fatal.map((e) => YamlDiagnostic.fromRaw(e, text)),
					input: text,
				}),
			);
		}
		return Result.succeed(documents.map((raw) => fromRawDocument(raw, text)));
	}

	/**
	 * Parse a multi-document YAML stream into one {@link YamlDocument} per
	 * document. Any fatal diagnostic in any document — or a stream-level
	 * directive-placement error — fails the whole Effect. Defined in terms of
	 * {@link YamlDocument.parseAllResult} — synchronous callers can use that
	 * variant directly.
	 *
	 * @param text - The YAML stream to parse.
	 * @param options - Optional {@link YamlParseOptions}; defaults apply for
	 *   omitted fields.
	 * @returns An `Effect` that succeeds with one {@link YamlDocument} per
	 *   document, or fails with {@link YamlParseError}.
	 */
	static readonly parseAll = Effect.fn("YamlDocument.parseAll")((text: string, options?: YamlParseOptions) =>
		Effect.fromResult(YamlDocument.parseAllResult(text, options)),
	);

	/**
	 * A `Schema<YamlDocument, string>` decoding YAML text into a full
	 * document (AST, directives, diagnostics) and encoding a document back to
	 * YAML text.
	 *
	 * Schema-producing: each call returns a fresh schema whose derivation
	 * caches are not shared across calls; bind the result to a `const` on hot
	 * paths.
	 *
	 * @param options - Optional {@link YamlParseOptions} applied on decode.
	 * @returns A `Schema.Codec<YamlDocument, string>`.
	 */
	static schema(options?: YamlParseOptions): Schema.Codec<YamlDocument, string> {
		return Schema.String.pipe(
			Schema.decodeTo(
				Schema.instanceOf(YamlDocument),
				SchemaTransformation.transformEffect({
					decode: (input: string) =>
						YamlDocument.parse(input, options).pipe(
							Effect.mapError((error) => new SchemaIssue.InvalidValue({ message: error.message }, input)),
						),
					encode: (doc: YamlDocument) =>
						doc
							.stringify()
							.pipe(Effect.mapError((error) => new SchemaIssue.InvalidValue({ message: error.message }, doc))),
				}),
			),
		);
	}

	/**
	 * Stringify this document (contents, directives and framing) as YAML.
	 * Fails with {@link YamlStringifyError} (`NestingDepthExceeded`) on a
	 * synthetic AST nested deeper than the stringifier's recursion budget. A
	 * cycle introduced into a synthetic AST fails the same way: the node path
	 * keeps no ancestor set, so the cycle is caught by the depth cap rather
	 * than reported as `CircularReference`. Either way the failure surfaces
	 * through the typed error channel, never as an unhandled stack-overflow
	 * defect.
	 * Defined in terms of {@link YamlDocument.stringifyResult} behind a
	 * `YamlDocument.stringify` span — synchronous callers can use that variant
	 * directly.
	 *
	 * @remarks
	 * `YamlStringifyOptions.lineWidth` is not honored here: column-based
	 * scalar folding exists only on the value path, through the entry points
	 * that accept stringify options ({@link Yaml.stringify} and
	 * {@link Yaml.stringifyResult}). The
	 * document/node path threads `lineWidth` into its render context but
	 * never reads it, so long scalars are emitted unfolded regardless of the
	 * option. Callers that need folding should render the plain value
	 * instead — `Yaml.stringify(doc.toValue(), options)` — at the cost of
	 * the document-level framing and styles this path preserves.
	 *
	 * @param options - Optional {@link YamlStringifyOptions}; defaults apply for
	 *   omitted fields.
	 * @returns An `Effect` that succeeds with the YAML text, or fails with
	 *   {@link YamlStringifyError}.
	 */
	stringify(options?: YamlStringifyOptions): Effect.Effect<string, YamlStringifyError> {
		// Suspended so the stringify runs inside the span when the Effect runs,
		// not when `stringify()` is called — an unmapped stringifier defect then
		// dies inside the span rather than throwing out of the method call.
		return Effect.suspend(() => Effect.fromResult(this.stringifyResult(options))).pipe(
			Effect.withSpan("YamlDocument.stringify"),
		);
	}

	/**
	 * Synchronous stringify, returning a `Result` instead of an `Effect` — the
	 * primitive {@link YamlDocument.stringify} is defined in terms of, so a
	 * synchronous host can round-trip a document parsed with
	 * {@link YamlDocument.parseResult} without an Effect runtime. Fails with
	 * {@link YamlStringifyError} exactly where `stringify` does: a synthetic
	 * AST nested deeper than the stringifier's recursion budget, or one
	 * containing a cycle, both as `NestingDepthExceeded` (the node path keeps
	 * no ancestor set, so a cycle is caught by the depth cap, not reported as
	 * `CircularReference`).
	 *
	 * @remarks
	 * `YamlStringifyOptions.lineWidth` is not honored here, for the reason
	 * given on {@link YamlDocument.stringify}.
	 *
	 * @example
	 * ```ts
	 * import { YamlDocument } from "@effected/yaml";
	 * import { Result } from "effect";
	 *
	 * const parsed = YamlDocument.parseResult("# keep\nname: Alice\n");
	 * if (Result.isSuccess(parsed)) {
	 *   const text = parsed.success.stringifyResult();
	 *   if (Result.isSuccess(text)) console.log(text.success); // => "# keep\nname: Alice\n"
	 * }
	 * ```
	 *
	 * @param options - Optional {@link YamlStringifyOptions}; defaults apply for
	 *   omitted fields.
	 * @returns A `Result` succeeding with the YAML text, or failing with
	 *   {@link YamlStringifyError}.
	 */
	stringifyResult(options?: YamlStringifyOptions): Result.Result<string, YamlStringifyError> {
		return Result.try({
			try: () => stringifyDocument(toRawDocument(this), toStringifyInput(options)),
			catch: (defect) => {
				const error = stringifyDefectToError(defect, this);
				if (error !== undefined) return error;
				throw defect;
			},
		});
	}

	/**
	 * Reconstruct the plain JavaScript value of this document's contents,
	 * resolving anchors and aliases. `null` for an empty document. Pure and
	 * total.
	 */
	toValue(): unknown {
		if (this.contents === null) return null;
		const anchors = new Map<string, YamlNodeType>();
		return this.contents.toValue(anchors);
	}
}

// ── Raw-document bridging ───────────────────────────────────────────────────

const toParseInput = (options?: YamlParseOptions) =>
	options === undefined
		? {}
		: {
				strict: options.strict,
				maxAliasCount: options.maxAliasCount,
				uniqueKeys: options.uniqueKeys,
			};

const toStringifyInput = (options?: YamlStringifyOptions) =>
	options === undefined
		? {}
		: {
				indent: options.indent,
				lineWidth: options.lineWidth,
				defaultScalarStyle: options.defaultScalarStyle,
				defaultCollectionStyle: options.defaultCollectionStyle,
				sortKeys: options.sortKeys,
				indentSequences: options.indentSequences,
				quoteStyle: options.quoteStyle,
				quoteCompat: options.quoteCompat,
				finalNewline: options.finalNewline,
				forceDefaultStyles: options.forceDefaultStyles,
			};

/**
 * Materialize a raw engine document into the public class — including
 * documents whose diagnostics are fatal, which `YamlDocument.parse` refuses.
 * The lint layer builds its context through this so linting runs on
 * malformed input; it is NOT a second public parse entry point (not
 * re-exported from the package index).
 *
 * @internal
 */
export function documentFromRaw(raw: RawYamlDocument, text: string): YamlDocument {
	return fromRawDocument(raw, text);
}

/** Materialize a raw engine document into the public class. */
function fromRawDocument(raw: RawYamlDocument, text: string): YamlDocument {
	return new YamlDocument({
		contents: raw.contents,
		errors: raw.errors.map((e) => YamlDiagnostic.fromRaw(e, text)),
		warnings: raw.warnings.map((w) => YamlDiagnostic.fromRaw(w, text)),
		directives: raw.directives.map((d) => new YamlDirective({ name: d.name, parameters: d.parameters })),
		...(raw.commentBefore !== undefined ? { commentBefore: raw.commentBefore } : {}),
		...(raw.comment !== undefined ? { comment: raw.comment } : {}),
		hasDocumentStart: raw.hasDocumentStart,
		hasDocumentEnd: raw.hasDocumentEnd,
		hasDocumentStartTab: raw.hasDocumentStartTab,
	});
}

/** Project the public class back onto the raw shape the engine consumes. */
function toRawDocument(doc: YamlDocument): RawYamlDocument {
	return {
		contents: doc.contents,
		errors: [],
		warnings: [],
		directives: doc.directives,
		...(doc.commentBefore !== undefined ? { commentBefore: doc.commentBefore } : {}),
		...(doc.comment !== undefined ? { comment: doc.comment } : {}),
		hasDocumentStart: doc.hasDocumentStart ?? false,
		hasDocumentEnd: doc.hasDocumentEnd ?? false,
		hasDocumentStartTab: doc.hasDocumentStartTab ?? false,
	};
}
