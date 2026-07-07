/**
 * The `Yaml` facade: value-level parsing, stringification, comment stripping,
 * semantic equality and the flagship schema factories, plus the parse and
 * stringify options and errors they raise.
 *
 * `Yaml` is a namespace of statics over the internal engine and the schema
 * layer — not itself a schema class. Per the package Effect-wrapping policy,
 * `parse`/`parseAll`/`stringify` and schema decoding carry real typed error
 * channels; `stripComments`/`equals`/`equalsValue` are pure total functions.
 *
 * @remarks
 * Cycle firewall: the internal engine returns raw `{ code, message, offset,
 * length }` diagnostic records and plain document records; this module
 * materializes {@link YamlDiagnostic} instances (deriving `line`/`character`
 * from `offset`) and constructs the aggregate {@link YamlParseError} /
 * {@link YamlStringifyError}. The dependency edge runs facade → engine only,
 * so `noImportCycles` stays satisfied.
 *
 * @packageDocumentation
 */

import type { Cause } from "effect";
import { Effect, Option, Schema, SchemaIssue, SchemaTransformation } from "effect";
import { buildAnchorMap } from "./internal/composer/anchors.js";
import { composeAllDocuments, composeFirstDocument } from "./internal/composer/document.js";
import type { RawDiagnostic } from "./internal/diagnostics.js";
import { isFatalCode } from "./internal/diagnostics.js";
import type { ParseOptionsInput, StringifyOptionsInput } from "./internal/options.js";
import type { RawYamlDocument } from "./internal/raw-document.js";
import { StringifyFailure, stringifyValue } from "./internal/stringifier.js";
import { YamlDiagnostic } from "./YamlDiagnostic.js";
import type { YamlNode } from "./YamlNode.js";
import { CollectionStyle, ScalarStyle } from "./YamlNode.js";

/**
 * Schema-generated base class backing {@link YamlParseOptions}. Not meant to
 * be referenced directly — named and exported only so API Extractor can
 * resolve the heritage clause of the class it backs.
 *
 * @public
 */
export const YamlParseOptions_base: Schema.Class<
	YamlParseOptions,
	Schema.Struct<{
		readonly strict: Schema.optionalKey<typeof Schema.Boolean>;
		readonly maxAliasCount: Schema.optionalKey<typeof Schema.Number>;
		readonly uniqueKeys: Schema.optionalKey<typeof Schema.Boolean>;
	}>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.Class's own `Inherited = {}` default
	{}
> = Schema.Class<YamlParseOptions>("YamlParseOptions")({
	strict: Schema.optionalKey(Schema.Boolean),
	maxAliasCount: Schema.optionalKey(Schema.Number),
	uniqueKeys: Schema.optionalKey(Schema.Boolean),
});

/**
 * Options controlling parse behavior. All fields are omissible; absent fields
 * resolve to `strict` `true`, `maxAliasCount` `100` (the alias-based
 * denial-of-service guard) and `uniqueKeys` `true` (duplicate mapping keys
 * are errors).
 *
 * @public
 */
export class YamlParseOptions extends YamlParseOptions_base {}

/**
 * Schema-generated base class backing {@link YamlStringifyOptions}. Not meant
 * to be referenced directly — named and exported only so API Extractor can
 * resolve the heritage clause of the class it backs.
 *
 * @public
 */
export const YamlStringifyOptions_base: Schema.Class<
	YamlStringifyOptions,
	Schema.Struct<{
		readonly indent: Schema.optionalKey<typeof Schema.Number>;
		readonly lineWidth: Schema.optionalKey<typeof Schema.Number>;
		readonly defaultScalarStyle: Schema.optionalKey<typeof ScalarStyle>;
		readonly defaultCollectionStyle: Schema.optionalKey<typeof CollectionStyle>;
		readonly sortKeys: Schema.optionalKey<typeof Schema.Boolean>;
		readonly finalNewline: Schema.optionalKey<typeof Schema.Boolean>;
		readonly forceDefaultStyles: Schema.optionalKey<typeof Schema.Boolean>;
	}>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.Class's own `Inherited = {}` default
	{}
> = Schema.Class<YamlStringifyOptions>("YamlStringifyOptions")({
	indent: Schema.optionalKey(Schema.Number),
	lineWidth: Schema.optionalKey(Schema.Number),
	defaultScalarStyle: Schema.optionalKey(ScalarStyle),
	defaultCollectionStyle: Schema.optionalKey(CollectionStyle),
	sortKeys: Schema.optionalKey(Schema.Boolean),
	finalNewline: Schema.optionalKey(Schema.Boolean),
	forceDefaultStyles: Schema.optionalKey(Schema.Boolean),
});

/**
 * Options controlling stringify behavior. All fields are omissible; absent
 * fields resolve to `indent` `2`, `lineWidth` `80`, `defaultScalarStyle`
 * `"plain"`, `defaultCollectionStyle` `"block"`, `sortKeys` `false`,
 * `finalNewline` `true` and `forceDefaultStyles` `false`.
 *
 * @public
 */
export class YamlStringifyOptions extends YamlStringifyOptions_base {}

/**
 * Schema-generated base class backing {@link YamlParseError}. Not meant to be
 * referenced directly — named and exported only so API Extractor can resolve
 * the heritage clause of the class it backs.
 *
 * @public
 */
export const YamlParseError_base: Schema.Class<
	YamlParseError,
	Schema.TaggedStruct<
		"YamlParseError",
		{
			readonly diagnostics: Schema.$Array<typeof YamlDiagnostic>;
			readonly input: typeof Schema.String;
		}
	>,
	Cause.YieldableError
> = Schema.TaggedErrorClass<YamlParseError>()("YamlParseError", {
	diagnostics: Schema.Array(YamlDiagnostic),
	input: Schema.String,
});

/**
 * Error-recovery parse failure: aggregates every fatal {@link YamlDiagnostic}
 * encountered, so a single failure reports the whole batch. Raised by
 * {@link Yaml.parse}, {@link Yaml.parseAll}, `YamlDocument.parse`/`parseAll`
 * and the decode direction of the schema factories.
 *
 * @public
 */
export class YamlParseError extends YamlParseError_base {
	override get message(): string {
		const count = this.diagnostics.length;
		const summary = this.diagnostics.map((d) => `${d.code} at ${d.line}:${d.character}`).join("; ");
		return `YAML parse failed with ${count} error${count === 1 ? "" : "s"}: ${summary}`;
	}
}

/**
 * Schema-generated base class backing {@link YamlStringifyError}. Not meant
 * to be referenced directly — named and exported only so API Extractor can
 * resolve the heritage clause of the class it backs.
 *
 * @public
 */
export const YamlStringifyError_base: Schema.Class<
	YamlStringifyError,
	Schema.TaggedStruct<
		"YamlStringifyError",
		{
			readonly diagnostics: Schema.$Array<typeof YamlDiagnostic>;
			readonly value: typeof Schema.Unknown;
		}
	>,
	Cause.YieldableError
> = Schema.TaggedErrorClass<YamlStringifyError>()("YamlStringifyError", {
	diagnostics: Schema.Array(YamlDiagnostic),
	value: Schema.Unknown,
});

/**
 * Stringification failure (the circular-reference guard), carrying structured
 * {@link YamlDiagnostic} entries and the offending value. Raised by
 * {@link Yaml.stringify}, `YamlDocument#stringify` and the encode direction of
 * the schema factories.
 *
 * @public
 */
export class YamlStringifyError extends YamlStringifyError_base {
	override get message(): string {
		const summary = this.diagnostics.map((d) => d.message).join("; ");
		return `YAML stringify failed: ${summary}`;
	}
}

// ── Internal helpers ────────────────────────────────────────────────────────

const toParseInput = (options?: YamlParseOptions): ParseOptionsInput =>
	options === undefined
		? {}
		: {
				strict: options.strict,
				maxAliasCount: options.maxAliasCount,
				uniqueKeys: options.uniqueKeys,
			};

const toStringifyInput = (options?: YamlStringifyOptions): StringifyOptionsInput =>
	options === undefined
		? {}
		: {
				indent: options.indent,
				lineWidth: options.lineWidth,
				defaultScalarStyle: options.defaultScalarStyle,
				defaultCollectionStyle: options.defaultCollectionStyle,
				sortKeys: options.sortKeys,
				finalNewline: options.finalNewline,
				forceDefaultStyles: options.forceDefaultStyles,
			};

const toDiagnostics = (text: string, records: ReadonlyArray<RawDiagnostic>): ReadonlyArray<YamlDiagnostic> =>
	records.map((r) => YamlDiagnostic.fromRaw(r, text));

/**
 * Collect the raw diagnostics that make a composed document a parse failure:
 * every fatal-code error, plus DuplicateKey warnings promoted to errors when
 * `uniqueKeys` is in force (the v3 `parse` contract). Order preserved:
 * fatals first, then promotions.
 */
const failureRecords = (doc: RawYamlDocument, uniqueKeys: boolean): ReadonlyArray<RawDiagnostic> => {
	const fatal = doc.errors.filter((e) => isFatalCode(e.code));
	if (fatal.length > 0) return fatal;
	return uniqueKeys ? doc.warnings.filter((w) => w.code === "DuplicateKey") : [];
};

/** Extract per-document values for a multi-document stream (anchors per doc). */
const documentValue = (doc: RawYamlDocument): unknown => {
	const anchors = buildAnchorMap(doc.contents);
	return doc.contents === null ? null : doc.contents.toValue(anchors);
};

const stringifyOrFail = (value: unknown, options?: YamlStringifyOptions): Effect.Effect<string, YamlStringifyError> =>
	Effect.try({
		try: () => stringifyValue(value, toStringifyInput(options)),
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
					value,
				});
			}
			throw defect;
		},
	});

// ── Facade ──────────────────────────────────────────────────────────────────

/**
 * Static entry points for YAML parsing, stringification, comment stripping,
 * semantic equality and the schema factories. Not instantiable.
 *
 * @example
 * ```ts
 * import { Yaml } from "@effected/yaml";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const value = yield* Yaml.parse("name: Alice\nage: 30");
 *   return value; // { name: "Alice", age: 30 }
 * });
 * ```
 *
 * @public
 */
export class Yaml {
	private constructor() {}

	/**
	 * Parse a single YAML document into a plain JavaScript value, resolving
	 * anchors and aliases. Error-recovery parsing: collects every fatal
	 * diagnostic and fails once with the aggregate {@link YamlParseError}.
	 * Returns `unknown`, never `any`.
	 */
	static readonly parse = Effect.fn("Yaml.parse")(function* (text: string, options?: YamlParseOptions) {
		const doc = composeFirstDocument(text, toParseInput(options));
		const failures = failureRecords(doc, options?.uniqueKeys ?? true);
		if (failures.length > 0) {
			return yield* new YamlParseError({ diagnostics: toDiagnostics(text, failures), input: text });
		}
		// An empty map lets toValue register anchors incrementally, so aliases
		// resolve to the most recent anchor at the point of use.
		const anchors = new Map<string, YamlNode>();
		return doc.contents === null ? null : (doc.contents.toValue(anchors) as unknown);
	});

	/**
	 * Parse a multi-document YAML stream into an array of plain JavaScript
	 * values (one per document, in order). Any fatal diagnostic in any
	 * document — or a stream-level directive-placement error — fails the
	 * whole Effect with the aggregate {@link YamlParseError}.
	 */
	static readonly parseAll = Effect.fn("Yaml.parseAll")(function* (text: string, options?: YamlParseOptions) {
		const { documents, streamErrors } = composeAllDocuments(text, toParseInput(options));
		const uniqueKeys = options?.uniqueKeys ?? true;
		const failures = [
			...streamErrors.filter((e) => e.code === "InvalidDirective"),
			...documents.flatMap((d) => failureRecords(d, uniqueKeys)),
		];
		if (failures.length > 0) {
			return yield* new YamlParseError({ diagnostics: toDiagnostics(text, failures), input: text });
		}
		return documents.map(documentValue) as ReadonlyArray<unknown>;
	});

	/**
	 * Stringify a plain JavaScript value as YAML. Fails with
	 * {@link YamlStringifyError} on circular references.
	 */
	static readonly stringify = Effect.fn("Yaml.stringify")(function* (value: unknown, options?: YamlStringifyOptions) {
		return yield* stringifyOrFail(value, options);
	});

	/**
	 * Strip comments from YAML text. Without `replaceCh`, comment characters
	 * are removed (line breaks are kept, so line numbers stay stable); with a
	 * `replaceCh` (e.g. `" "`), each comment character is replaced instead,
	 * keeping all offsets stable. Quote-aware: `#` inside quoted scalars is
	 * content, not a comment. Pure and total.
	 */
	static stripComments(text: string, replaceCh?: string): string {
		let result = "";
		let i = 0;
		let inComment = false;
		let inSingleQuote = false;
		let inDoubleQuote = false;

		while (i < text.length) {
			const ch = text[i] as string;

			if (inComment) {
				if (ch === "\n") {
					inComment = false;
					result += ch;
				} else if (replaceCh !== undefined) {
					result += replaceCh;
				}
			} else if (inDoubleQuote) {
				result += ch;
				if (ch === "\\" && i + 1 < text.length) {
					i++;
					result += text[i];
				} else if (ch === '"') {
					inDoubleQuote = false;
				}
			} else if (inSingleQuote) {
				result += ch;
				if (ch === "'" && i + 1 < text.length && text[i + 1] === "'") {
					i++;
					result += text[i];
				} else if (ch === "'") {
					inSingleQuote = false;
				}
			} else if (ch === '"') {
				inDoubleQuote = true;
				result += ch;
			} else if (ch === "'") {
				inSingleQuote = true;
				result += ch;
			} else if (ch === "#") {
				const prev = i > 0 ? text[i - 1] : "\n";
				if (prev === " " || prev === "\t" || prev === "\n" || i === 0) {
					inComment = true;
					if (replaceCh !== undefined) {
						result += replaceCh;
					}
				} else {
					result += ch;
				}
			} else {
				result += ch;
			}

			i++;
		}

		return result;
	}

	/**
	 * Compare two YAML strings for semantic equality: comments, whitespace,
	 * formatting and mapping key order are ignored; sequence order is
	 * significant. Malformed input is never equal to anything — parse errors
	 * (or duplicate keys) on either side yield `false` rather than comparing
	 * recovery-parser artifacts. Pure and total.
	 */
	static equals(a: string, b: string): boolean {
		const va = parseForEquality(a);
		const vb = parseForEquality(b);
		if (va.malformed || vb.malformed) return false;
		return deepEqualValues(va.value, vb.value);
	}

	/**
	 * Compare a YAML string against an existing JavaScript value with the
	 * same semantics as {@link Yaml.equals}: malformed `text` yields `false`.
	 * Pure and total.
	 */
	static equalsValue(text: string, value: unknown): boolean {
		const v = parseForEquality(text);
		if (v.malformed) return false;
		return deepEqualValues(v.value, value);
	}

	/**
	 * A `Schema<unknown, string>` decoding a single YAML document with the
	 * given `options` (defaults when omitted) and encoding values back to
	 * YAML text with default stringify options.
	 *
	 * Schema-producing: each call returns a fresh schema whose derivation
	 * caches are not shared across calls. Bind the result to a `const` on hot
	 * paths; for the default-options case use {@link Yaml.YamlFromString}.
	 */
	static fromString(options?: YamlParseOptions): Schema.Codec<unknown, string> {
		return Schema.String.pipe(
			Schema.decodeTo(
				Schema.Unknown,
				SchemaTransformation.transformOrFail({
					decode: (input: string) =>
						Yaml.parse(input, options).pipe(
							Effect.mapError((error) => new SchemaIssue.InvalidValue(Option.some(input), { message: error.message })),
						),
					encode: (value: unknown) =>
						stringifyOrFail(value).pipe(
							Effect.mapError((error) => new SchemaIssue.InvalidValue(Option.some(value), { message: error.message })),
						),
				}),
			),
		);
	}

	/**
	 * The zero-config `Schema<unknown, string>` — `Yaml.fromString()` with
	 * default options, pre-bound so the common case needs no memoization
	 * discipline.
	 */
	static readonly YamlFromString: Schema.Codec<unknown, string> = Yaml.fromString();

	/**
	 * A `Schema<ReadonlyArray<unknown>, string>` decoding a multi-document
	 * YAML stream into one value per document, and encoding an array of
	 * values back into a `---`-separated stream.
	 *
	 * Schema-producing: bind the result to a `const` on hot paths (see
	 * {@link Yaml.fromString}).
	 */
	static allFromString(options?: YamlParseOptions): Schema.Codec<ReadonlyArray<unknown>, string> {
		return Schema.String.pipe(
			Schema.decodeTo(
				Schema.Array(Schema.Unknown),
				SchemaTransformation.transformOrFail({
					decode: (input: string) =>
						Yaml.parseAll(input, options).pipe(
							Effect.mapError((error) => new SchemaIssue.InvalidValue(Option.some(input), { message: error.message })),
						),
					encode: (values: ReadonlyArray<unknown>) =>
						Effect.gen(function* () {
							if (values.length === 0) return "";
							const parts: Array<string> = [];
							for (let index = 0; index < values.length; index++) {
								const yaml = yield* stringifyOrFail(values[index]).pipe(
									Effect.mapError(
										(error) => new SchemaIssue.InvalidValue(Option.some(values), { message: error.message }),
									),
								);
								parts.push(index > 0 ? `---\n${yaml}` : yaml);
							}
							return parts.join("");
						}),
				}),
			),
		);
	}

	/**
	 * Compose {@link Yaml.fromString} with a target schema, yielding a
	 * `Schema<A, string>` that decodes YAML straight into a validated domain
	 * value — the single best consumer-facing feature of the library. The
	 * target's decoding/encoding service requirements flow through.
	 *
	 * Schema-producing: bind the result to a `const` on hot paths (see
	 * {@link Yaml.fromString}).
	 */
	static schema<T, E, RD = never, RE = never>(
		target: Schema.Codec<T, E, RD, RE>,
		options?: YamlParseOptions,
	): Schema.Codec<T, string, RD, RE> {
		return Yaml.fromString(options).pipe(
			Schema.decodeTo(target as unknown as Schema.Codec<T, unknown, RD, RE>),
		) as unknown as Schema.Codec<T, string, RD, RE>;
	}
}

// ── Equality internals ──────────────────────────────────────────────────────

/**
 * Parse for `equals`/`equalsValue`: any recorded error — fatal or not — or a
 * DuplicateKey warning marks the input malformed (never equal to anything).
 */
function parseForEquality(text: string): { readonly malformed: boolean; readonly value: unknown } {
	const doc = composeFirstDocument(text, {});
	if (doc.errors.length > 0 || doc.warnings.some((w) => w.code === "DuplicateKey")) {
		return { malformed: true, value: undefined };
	}
	const anchors = new Map<string, YamlNode>();
	return { malformed: false, value: doc.contents === null ? null : doc.contents.toValue(anchors) };
}

/**
 * Deep structural equality over plain values: NaN equals NaN, mapping key
 * order ignored, sequence order significant.
 */
function deepEqualValues(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) {
		return true;
	}
	if (a === null || b === null) return false;
	if (typeof a !== typeof b) return false;

	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!deepEqualValues(a[i], b[i])) return false;
		}
		return true;
	}
	if (Array.isArray(b)) return false;

	if (typeof a === "object" && typeof b === "object") {
		const aObj = a as Record<string, unknown>;
		const bObj = b as Record<string, unknown>;
		const aKeys = Object.keys(aObj);
		const bKeys = Object.keys(bObj);
		if (aKeys.length !== bKeys.length) return false;
		for (const key of aKeys) {
			if (!Object.hasOwn(bObj, key) || !deepEqualValues(aObj[key], bObj[key])) return false;
		}
		return true;
	}

	return false;
}
