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

import type { Effect } from "effect";
import { Schema } from "effect";
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
 * A frontmatter codec: how to turn a raw {@link FrontmatterNode | Frontmatter}
 * capture into decoded data.
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
