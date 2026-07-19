import { Jsonc } from "@effected/jsonc";
import { Effect } from "effect";
import type { FrontmatterCodec } from "./Frontmatter.js";
import { FrontmatterDecodeError, FrontmatterFormatMismatchError } from "./Frontmatter.js";

/**
 * The json frontmatter codec, over `@effected/jsonc`.
 *
 * @remarks
 * Decodes a `---json`-fenced capture's raw value with `Jsonc.parse`, so the
 * jsonc engine's nesting depth cap fails through the typed channel: a hostile
 * frontmatter block surfaces as a {@link FrontmatterDecodeError} carrying the
 * `JsoncParseError` structurally, never a defect. JSONC being a JSON
 * superset, comments and trailing commas in a json capture decode rather than
 * fail — deliberate leniency, matching the kit's one JSON-family engine. An
 * empty capture fails typed: unlike yaml and toml, JSON has no
 * empty-document value.
 *
 * `@effected/jsonc` is an optional peer — importing this module is what
 * requires it; a consumer who never touches json frontmatter never loads the
 * jsonc engine.
 *
 * @public
 */
export const JsonFrontmatter: FrontmatterCodec = {
	format: "json",
	decode: (node) =>
		node.format !== "json"
			? Effect.fail(new FrontmatterFormatMismatchError({ expected: "json", actual: node.format }))
			: Jsonc.parse(node.value).pipe(Effect.mapError((cause) => new FrontmatterDecodeError({ format: "json", cause }))),
};
