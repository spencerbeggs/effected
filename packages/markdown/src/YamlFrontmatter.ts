import { Yaml } from "@effected/yaml";
import { Effect } from "effect";
import type { FrontmatterCodec } from "./Frontmatter.js";
import { FrontmatterDecodeError, FrontmatterFormatMismatchError } from "./Frontmatter.js";

/**
 * The yaml frontmatter codec, over `@effected/yaml`.
 *
 * @remarks
 * Decodes a `---`-fenced capture's raw value with `Yaml.parse`, so the yaml
 * engine's input hardening — the alias-expansion budget and the nesting depth
 * cap — fails through the typed channel: a hostile frontmatter block surfaces
 * as a {@link FrontmatterDecodeError} carrying the `YamlParseError`
 * structurally, never a defect. An empty capture decodes to `null`, yaml's
 * empty-document value.
 *
 * `@effected/yaml` is an optional peer — importing this module is what
 * requires it; a consumer who never touches yaml frontmatter never loads the
 * yaml engine.
 *
 * @public
 */
export const YamlFrontmatter: FrontmatterCodec = {
	format: "yaml",
	decode: (node) =>
		node.format !== "yaml"
			? Effect.fail(new FrontmatterFormatMismatchError({ expected: "yaml", actual: node.format }))
			: Yaml.parse(node.value).pipe(Effect.mapError((cause) => new FrontmatterDecodeError({ format: "yaml", cause }))),
};
