import { Effect, Schema } from "effect";

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
 * @public
 */
export interface ConfigCodec<E = ConfigCodecError> {
	readonly name: string;
	readonly parse: (raw: string) => Effect.Effect<unknown, E>;
	readonly stringify: (value: unknown) => Effect.Effect<string, E>;
}

const json: ConfigCodec = {
	name: "json",
	parse: (raw) =>
		Effect.try({
			try: () => JSON.parse(raw) as unknown,
			catch: (cause) => new ConfigCodecError({ codec: "json", operation: "parse", cause }),
		}),
	stringify: (value) =>
		Effect.try({
			try: () => JSON.stringify(value, null, 2),
			catch: (cause) => new ConfigCodecError({ codec: "json", operation: "stringify", cause }),
		}),
};

/**
 * Built-in codecs. Only the zero-dependency JSON codec ships in core; JSONC,
 * YAML and TOML codecs live in their own adapter packages.
 *
 * @public
 */
export const ConfigCodec = { json } as const;
