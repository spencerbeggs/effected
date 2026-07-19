// The frontmatter composition seam: the codec contract the free-standing
// codec modules (`YamlFrontmatter`, `TomlFrontmatter`, `JsonFrontmatter`)
// implement, and the typed errors they fail with. The schema composition
// helper (`Frontmatter.schema`, typed gray-matter parity) arrives in P3
// Task 3 and lives here too, keeping this module the one lean seam between
// the raw capture node and a consumer's typed data.
//
// The codecs themselves are deliberately NOT defined or re-exported here —
// one module each, never a namespace object. Collecting them would make this
// module a dispatch table: referencing it would reach every codec, every
// codec reaches its format engine, and a JSON-only consumer would drag the
// yaml and toml engines into their bundle (the config-file tree-shaking
// rule, applied verbatim).

import { Effect, Schema } from "effect";
import type { MarkdownDocument } from "./MarkdownDocument.js";
import type { Frontmatter as FrontmatterNode } from "./MarkdownNode.js";
import { FrontmatterFormat } from "./MarkdownNode.js";

/**
 * Indicates that a frontmatter codec was handed a capture of a different
 * format — a yaml codec applied to a `+++` toml capture, for example.
 *
 * @remarks
 * The mismatch is detected before any parsing happens, so `cause`-free: the
 * node's `format` marker and the codec's declared `format` simply disagree.
 * Route on the `"FrontmatterFormatMismatchError"` tag with `Effect.catchTag`.
 *
 * @public
 */
export class FrontmatterFormatMismatchError extends Schema.TaggedErrorClass<FrontmatterFormatMismatchError>()(
	"FrontmatterFormatMismatchError",
	{
		/** The format the codec decodes. */
		expected: FrontmatterFormat,
		/** The format the capture node actually carries. */
		actual: FrontmatterFormat,
	},
) {
	override get message(): string {
		return `frontmatter format mismatch: the ${this.expected} codec cannot decode a ${this.actual} capture`;
	}
}

/**
 * Indicates that a frontmatter capture's content failed to parse in its
 * declared format.
 *
 * @remarks
 * The underlying format package's failure is preserved structurally in
 * `cause` — never stringified — so a consumer can reach the positioned
 * diagnostics the format engines carry. Route on the
 * `"FrontmatterDecodeError"` tag with `Effect.catchTag`.
 *
 * @public
 */
export class FrontmatterDecodeError extends Schema.TaggedErrorClass<FrontmatterDecodeError>()(
	"FrontmatterDecodeError",
	{
		/** The format that failed to parse. */
		format: FrontmatterFormat,
		/** The underlying format-package failure, preserved structurally. */
		cause: Schema.Defect(),
	},
) {
	override get message(): string {
		return `frontmatter ${this.format} content failed to parse`;
	}
}

/**
 * A frontmatter codec: how to turn a raw `Frontmatter` capture into decoded
 * data.
 *
 * @remarks
 * The three built-in codecs — `YamlFrontmatter`, `TomlFrontmatter` and
 * `JsonFrontmatter` — are free-standing named exports, one per module, each
 * peering on its format package (`@effected/yaml`, `@effected/toml`,
 * `@effected/jsonc`). They are deliberately never collected into a namespace
 * object: name the one codec you use and a bundler drops the rest, engines
 * included.
 *
 * A codec checks the capture's `format` marker before parsing and fails with
 * {@link FrontmatterFormatMismatchError} when handed the wrong format;
 * unparseable content fails with {@link FrontmatterDecodeError} carrying the
 * format package's failure structurally.
 *
 * @public
 */
export interface FrontmatterCodec {
	/** The format this codec decodes. */
	readonly format: FrontmatterFormat;
	/** Decode a capture node's raw value into data. */
	readonly decode: (
		node: FrontmatterNode,
	) => Effect.Effect<unknown, FrontmatterDecodeError | FrontmatterFormatMismatchError>;
}

/**
 * Indicates that a document handed to a frontmatter decoder carries no
 * frontmatter capture.
 *
 * @remarks
 * Raised when the document genuinely has no frontmatter block — including
 * when it has one in the source but was parsed with the capture toggle off
 * (`MarkdownParseOptions.frontmatter` defaults to `false`). Cause-free: there
 * is nothing to diagnose beyond the absence itself. Consumers wanting
 * optional semantics can `Effect.catchTag("FrontmatterMissingError", ...)`
 * to a default.
 *
 * @public
 */
export class FrontmatterMissingError extends Schema.TaggedErrorClass<FrontmatterMissingError>()(
	"FrontmatterMissingError",
	{},
) {
	override get message(): string {
		return "the document has no frontmatter capture; was it parsed with `frontmatter: true`?";
	}
}

/**
 * Indicates that decoded frontmatter data did not satisfy the consumer's
 * schema.
 *
 * @remarks
 * `issue` carries the **structured** schema failure — at runtime a
 * `SchemaIssue.Issue` tree, reachable through `_tag` and nested `issues` —
 * never a stringified rendering (the `ConfigValidationError` precedent from
 * `@effected/config-file`). It is typed `unknown` because v4 exposes no
 * `Schema` for `Issue`; narrow it with the `SchemaIssue` module.
 *
 * @public
 */
export class FrontmatterValidationError extends Schema.TaggedErrorClass<FrontmatterValidationError>()(
	"FrontmatterValidationError",
	{
		/** The structured schema issue. Never a string. */
		issue: Schema.Defect(),
	},
) {
	override get message(): string {
		return "frontmatter data failed schema validation";
	}
}

/**
 * The union of everything a composed frontmatter decoder can fail with.
 *
 * @public
 */
export type FrontmatterSchemaError =
	| FrontmatterMissingError
	| FrontmatterFormatMismatchError
	| FrontmatterDecodeError
	| FrontmatterValidationError;

/**
 * The frontmatter schema composition facade — typed gray-matter parity.
 *
 * @remarks
 * The design doc's indicative spelling was `Frontmatter.schema`, but
 * `Frontmatter` names the capture node class (the node classes co-locate in
 * `MarkdownNode.ts` and are named after their mdast types), so the facade
 * follows the package's Markdown-prefix convention instead.
 *
 * @public
 */
export class MarkdownFrontmatter {
	/**
	 * Compose a consumer schema with a {@link FrontmatterCodec} into a typed
	 * decoder over a parsed `MarkdownDocument`.
	 *
	 * @remarks
	 * The decoder reads the document's frontmatter capture (parse with
	 * `frontmatter: true` — the toggle defaults off), decodes its raw value
	 * through the codec, then validates the data against `schema`. Each stage
	 * fails typed: no capture is {@link FrontmatterMissingError}, a
	 * wrong-format codec is {@link FrontmatterFormatMismatchError}, unparseable
	 * content is {@link FrontmatterDecodeError}, and schema-invalid data is
	 * {@link FrontmatterValidationError} carrying the structured issue.
	 *
	 * The seam takes the parsed document, not raw source: parse options
	 * (dialect, the frontmatter toggle) stay at the consumer's parse call and
	 * are never guessed here. Node-level composition remains available through
	 * `MarkdownDocument.frontmatter` plus the codec's own `decode`.
	 *
	 * Schema-producing in spirit: bind the returned decoder to a `const` when
	 * decoding many documents.
	 *
	 * @param schema - The schema the decoded frontmatter data must satisfy.
	 * @param codec - The format codec to decode the raw capture with.
	 * @returns A function from a parsed document to an `Effect` of the typed
	 *   frontmatter data.
	 */
	static schema<T, E, RD = never, RE = never>(
		schema: Schema.Codec<T, E, RD, RE>,
		codec: FrontmatterCodec,
	): (document: MarkdownDocument) => Effect.Effect<T, FrontmatterSchemaError, RD> {
		return (document) => {
			const node = document.frontmatter;
			return node === undefined
				? Effect.fail(new FrontmatterMissingError())
				: codec.decode(node).pipe(
						Effect.flatMap((data) =>
							Schema.decodeUnknownEffect(schema)(data).pipe(
								// Normalize the schema failure at the boundary. Never leak
								// SchemaError deeper, never stringify it — carry its
								// structured issue tree instead.
								Effect.catchTag("SchemaError", (error) =>
									Effect.fail(new FrontmatterValidationError({ issue: error.issue })),
								),
							),
						),
					);
		};
	}
}
