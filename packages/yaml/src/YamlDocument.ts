// The parsed-document concept: YamlDocument (root AST node plus
// errors/warnings-as-data, directives and document framing) and
// YamlDirective.
//
// The recoverable-parse design lives here: non-fatal diagnostics surface as
// data on `errors`/`warnings` while fatal ones fail `parse`/`parseAll` with a
// typed `YamlParseError`.

import { Effect, Option, Schema, SchemaIssue, SchemaTransformation } from "effect";
import { composeAllDocuments, composeFirstDocument } from "./internal/composer/document.js";
import { isFatalCode } from "./internal/diagnostics.js";
import type { RawYamlDocument } from "./internal/raw-document.js";
import { StringifyDepthExceeded, StringifyFailure, stringifyDocument } from "./internal/stringifier.js";
import type { YamlParseOptions, YamlStringifyOptions } from "./Yaml.js";
import { YamlParseError, YamlStringifyError } from "./Yaml.js";
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
 * the {@link YamlDirective} list, an optional document-level comment, and the
 * `---`/`...` framing flags (absent flags read as `false`).
 *
 * Construct via `YamlDocument.parse` / `parseAll`; `YamlDocument.make` is for
 * synthetic documents.
 *
 * @public
 */
export class YamlDocument extends Schema.Class<YamlDocument>("YamlDocument")({
	contents: Schema.NullOr(Schema.suspend((): Schema.Schema<YamlNodeType> => YamlNode)),
	errors: Schema.Array(YamlDiagnostic),
	warnings: Schema.Array(YamlDiagnostic),
	directives: Schema.Array(YamlDirective),
	comment: Schema.optionalKey(Schema.String),
	hasDocumentStart: Schema.optionalKey(Schema.Boolean),
	hasDocumentEnd: Schema.optionalKey(Schema.Boolean),
	hasDocumentStartTab: Schema.optionalKey(Schema.Boolean),
}) {
	/**
	 * Parse a single YAML document, keeping the full AST, directives and
	 * recovered diagnostics. Fails with the aggregate {@link YamlParseError}
	 * when any fatal-code diagnostic is present; non-fatal diagnostics are
	 * data on the returned document.
	 */
	static readonly parse = Effect.fn("YamlDocument.parse")(function* (text: string, options?: YamlParseOptions) {
		const raw = composeFirstDocument(text, toParseInput(options));
		const fatal = raw.errors.filter((e) => isFatalCode(e.code));
		if (fatal.length > 0) {
			return yield* new YamlParseError({
				diagnostics: fatal.map((e) => YamlDiagnostic.fromRaw(e, text)),
				input: text,
			});
		}
		return fromRawDocument(raw, text);
	});

	/**
	 * Parse a multi-document YAML stream into one {@link YamlDocument} per
	 * document. Any fatal diagnostic in any document — or a stream-level
	 * directive-placement error — fails the whole Effect.
	 */
	static readonly parseAll = Effect.fn("YamlDocument.parseAll")(function* (text: string, options?: YamlParseOptions) {
		const { documents, streamErrors } = composeAllDocuments(text, toParseInput(options));
		const fatal = [
			...streamErrors.filter((e) => e.code === "InvalidDirective"),
			...documents.flatMap((d) => d.errors.filter((e) => isFatalCode(e.code))),
		];
		if (fatal.length > 0) {
			return yield* new YamlParseError({
				diagnostics: fatal.map((e) => YamlDiagnostic.fromRaw(e, text)),
				input: text,
			});
		}
		return documents.map((raw) => fromRawDocument(raw, text)) as ReadonlyArray<YamlDocument>;
	});

	/**
	 * A `Schema<YamlDocument, string>` decoding YAML text into a full
	 * document (AST, directives, diagnostics) and encoding a document back to
	 * YAML text.
	 *
	 * Schema-producing: each call returns a fresh schema whose derivation
	 * caches are not shared across calls; bind the result to a `const` on hot
	 * paths.
	 */
	static schema(options?: YamlParseOptions): Schema.Codec<YamlDocument, string> {
		return Schema.String.pipe(
			Schema.decodeTo(
				Schema.instanceOf(YamlDocument),
				SchemaTransformation.transformOrFail({
					decode: (input: string) =>
						YamlDocument.parse(input, options).pipe(
							Effect.mapError((error) => new SchemaIssue.InvalidValue(Option.some(input), { message: error.message })),
						),
					encode: (doc: YamlDocument) =>
						doc
							.stringify()
							.pipe(
								Effect.mapError((error) => new SchemaIssue.InvalidValue(Option.some(doc), { message: error.message })),
							),
				}),
			),
		);
	}

	/**
	 * Stringify this document (contents, directives and framing) as YAML.
	 * Fails with {@link YamlStringifyError} on circular references introduced
	 * into a synthetic AST (`CircularReference`) or on a synthetic AST nested
	 * deeper than the stringifier's recursion budget (`NestingDepthExceeded`)
	 * — both surface through the typed error channel rather than as an
	 * unhandled stack-overflow defect.
	 */
	stringify(options?: YamlStringifyOptions): Effect.Effect<string, YamlStringifyError> {
		return Effect.try({
			try: () => stringifyDocument(toRawDocument(this), toStringifyInput(options)),
			catch: (defect) => {
				if (defect instanceof StringifyFailure) {
					return new YamlStringifyError({
						diagnostics: [
							YamlDiagnostic.make({
								code: "CircularReference",
								message: defect.reason,
								offset: 0,
								length: 0,
								line: 0,
								character: 0,
							}),
						],
						value: this,
					});
				}
				// A synthetic AST nested deeper than the stringifier's cap overflowed
				// the node-path recursion — surface it typed, not as a stack-overflow
				// defect.
				if (defect instanceof StringifyDepthExceeded) {
					return new YamlStringifyError({
						diagnostics: [
							YamlDiagnostic.make({
								code: "NestingDepthExceeded",
								message: defect.message,
								offset: 0,
								length: 0,
								line: 0,
								character: 0,
							}),
						],
						value: this,
					});
				}
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
				finalNewline: options.finalNewline,
				forceDefaultStyles: options.forceDefaultStyles,
			};

/** Materialize a raw engine document into the public class. */
function fromRawDocument(raw: RawYamlDocument, text: string): YamlDocument {
	return new YamlDocument({
		contents: raw.contents,
		errors: raw.errors.map((e) => YamlDiagnostic.fromRaw(e, text)),
		warnings: raw.warnings.map((w) => YamlDiagnostic.fromRaw(w, text)),
		directives: raw.directives.map((d) => new YamlDirective({ name: d.name, parameters: d.parameters })),
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
		...(doc.comment !== undefined ? { comment: doc.comment } : {}),
		hasDocumentStart: doc.hasDocumentStart ?? false,
		hasDocumentEnd: doc.hasDocumentEnd ?? false,
		hasDocumentStartTab: doc.hasDocumentStartTab ?? false,
	};
}
