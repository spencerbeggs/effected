import type { ConfigCodec } from "@effected/config-file";
import { ConfigCodecError } from "@effected/config-file";
import { Yaml } from "@effected/yaml";
import { Effect } from "effect";

/**
 * A `ConfigCodec` backed by `@effected/yaml`.
 *
 * @remarks
 * `@effected/yaml`'s input hardening — an alias-expansion budget guarding
 * against "billion laughs" alias bombs, and a collection-nesting depth cap —
 * fails through the typed error channel, so a hostile config file surfaces
 * as a `ConfigCodecError` rather than crashing the process. Both directions
 * preserve the underlying failure structurally in `cause` — never
 * stringified.
 *
 * @public
 */
export const YamlCodec: ConfigCodec = {
	name: "yaml",
	parse: (raw) =>
		Yaml.parse(raw).pipe(
			Effect.mapError((cause) => new ConfigCodecError({ codec: "yaml", operation: "parse", cause })),
		),
	stringify: (value) =>
		Yaml.stringify(value).pipe(
			Effect.mapError((cause) => new ConfigCodecError({ codec: "yaml", operation: "stringify", cause })),
		),
};
