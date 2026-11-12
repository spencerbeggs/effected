import type { SchemastoreConfig } from "@effected/schemastore";
import { SchemastoreVersion } from "@effected/schemastore";
import { Option, Schema } from "effect";

// An unbuilt source run reads this, and it says nothing about which release a
// value came from.
const UNBUILT = "0.0.0";

const FoundVersion = Schema.Struct({
	/** What carries the stamp: `config`, or a schema's hosted identity. */
	where: Schema.String,
	/** The stamped version. */
	version: Schema.String,
});

/**
 * A config whose values came from a different `@effected/schemastore` than the
 * one this tool was built against.
 *
 * @public
 */
export class VersionMismatch extends Schema.Class<VersionMismatch>("VersionMismatch")({
	/** The version of the copy of `@effected/schemastore` the tool was built against. */
	tool: Schema.String,
	/** Every stamp that differs from `tool`. */
	found: Schema.Array(FoundVersion),
	/** Names both versions and how to align them. */
	message: Schema.String,
}) {}

/**
 * The run refused a version mismatch, before generating anything.
 *
 * @public
 */
export class VersionMismatchError extends Schema.TaggedError<VersionMismatchError>()("VersionMismatchError", {
	/** The version of the copy of `@effected/schemastore` the tool was built against. */
	tool: Schema.String,
	/** Every stamp that differs from `tool`. */
	found: Schema.Array(FoundVersion),
	/** Names both versions and how to align them. */
	message: Schema.String,
}) {}

/**
 * Compares the `@effected/schemastore` versions stamped on a config's values
 * with the version this tool was built against.
 *
 * @remarks
 * The catalog normally keeps the two equal, but a partial bump can leave an older
 * copy beside a newer one. A value from another copy is read only through
 * `SchemastoreVersion.of`, because it may lack this copy's methods. A value with
 * no stamp cannot be compared and is passed over, and so is `"0.0.0"` on either
 * side, which is an unbuilt source run. Two copies at one version are
 * indistinguishable, and are not the case this check targets.
 *
 * @public
 */
export class VersionCheck {
	private constructor() {}

	/**
	 * The mismatch, or `Option.none()` when the stamps agree. `tool` defaults to
	 * this copy's `SchemastoreVersion.current`.
	 */
	static inspect(config: SchemastoreConfig, tool: string = SchemastoreVersion.current): Option.Option<VersionMismatch> {
		if (tool === UNBUILT) {
			return Option.none();
		}
		const stamped = [
			{ where: "config", stamp: SchemastoreVersion.of(config) },
			...config.schemas.map((schema) => ({
				where: `schema "${schema.name}" hosted identity`,
				stamp: SchemastoreVersion.of(schema.hosted),
			})),
		];
		const found = stamped.flatMap(({ where, stamp }) =>
			Option.isSome(stamp) && stamp.value !== UNBUILT && stamp.value !== tool ? [{ where, version: stamp.value }] : [],
		);
		if (found.length === 0) {
			return Option.none();
		}
		const lines = found.map(({ where, version }) => `${where}: ${version}`).join(", ");
		return Option.some(
			VersionMismatch.make({
				tool,
				found,
				message: `The tool uses @effected/schemastore ${tool}, but the config's values come from another version (${lines}). Build the config's values with the authoring surface @effected/plugin exports (defineSchemastore, HostedSchema, SchemaTarget and the rest), which is the tool's own copy, or align @effected/schemastore with the version @effected/plugin carries, as catalog:effected does.`,
			}),
		);
	}
}
