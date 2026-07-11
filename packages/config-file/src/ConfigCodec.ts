import type { Effect } from "effect";
import { Schema } from "effect";

/**
 * Indicates that a codec failed to parse or stringify configuration content.
 *
 * @remarks
 * The underlying failure is preserved structurally in `cause` — it is never
 * stringified. Route on the `"ConfigCodecError"` tag with `Effect.catchTag`.
 *
 * @public
 */
export class ConfigCodecError extends Schema.TaggedErrorClass<ConfigCodecError>()("ConfigCodecError", {
	/** The codec that failed, e.g. `"json"`. */
	codec: Schema.String,
	/** Which direction failed. */
	operation: Schema.Literals(["parse", "stringify"]),
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `${this.codec} ${this.operation} failed`;
	}
}

/**
 * A pluggable configuration file codec: how to turn file content into a value
 * and back.
 *
 * @remarks
 * `E` is the codec's error channel. It defaults to {@link ConfigCodecError};
 * decorator codecs such as `EncryptedCodec` and `ConfigMigration.make` widen it
 * rather than flattening their own failures into a string.
 *
 * The four built-in codecs — `JsonCodec`, `JsoncCodec`, `YamlCodec` and
 * `TomlCodec` — are free-standing named exports, one per module, and are
 * deliberately never collected into a namespace object. Collecting them would
 * make this module a dispatch table: referencing it at all would reach every
 * codec, and every codec would reach its parsing engine, so importing the JSON
 * codec alone would drag the JSONC, YAML and TOML engines into the bundle.
 * Name the one codec you use and a bundler drops the rest.
 *
 * @public
 */
export interface ConfigCodec<E = ConfigCodecError> {
	readonly name: string;
	readonly parse: (raw: string) => Effect.Effect<unknown, E>;
	readonly stringify: (value: unknown) => Effect.Effect<string, E>;
}
