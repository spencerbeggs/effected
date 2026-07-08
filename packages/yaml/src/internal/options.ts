// Internal option shapes consumed by the engine. The public facade owns the
// `Schema.Class` option types (`YamlParseOptions`, `YamlStringifyOptions`,
// `YamlFormattingOptions`); the engine takes these plain records so it never
// imports the facade. Defaults are applied where consumed (`?? default`).

import type { CollectionStyle, ScalarStyle } from "../YamlNode.js";

/** Parse options as consumed by the composer. All fields optional. */
export interface ParseOptionsInput {
	/** Treat parse errors as failures rather than recovering. Default `true`. */
	readonly strict?: boolean | undefined;
	/** Max alias nodes per document (DoS guard). Default `100`. */
	readonly maxAliasCount?: number | undefined;
	/** Treat duplicate mapping keys as errors. Default `true`. */
	readonly uniqueKeys?: boolean | undefined;
}

/** Stringify options as consumed by the stringifier. All fields optional. */
export interface StringifyOptionsInput {
	/** Spaces per indentation level. Default `2`. */
	readonly indent?: number | undefined;
	/** Preferred maximum line width. Default `80`. */
	readonly lineWidth?: number | undefined;
	/** Scalar output style when none is requested. Default `"plain"`. */
	readonly defaultScalarStyle?: ScalarStyle | undefined;
	/** Collection output style when none is requested. Default `"block"`. */
	readonly defaultCollectionStyle?: CollectionStyle | undefined;
	/** Sort mapping keys alphabetically. Default `false`. */
	readonly sortKeys?: boolean | undefined;
	/** End output with a trailing newline. Default `true`. */
	readonly finalNewline?: boolean | undefined;
	/** Ignore per-node styles and force the defaults. Default `false`. */
	readonly forceDefaultStyles?: boolean | undefined;
}
