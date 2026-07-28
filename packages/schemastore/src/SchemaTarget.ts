import type { Schema } from "effect";
import type { SchemaVersion } from "./SchemaVersioning.js";

/**
 * A single schema publication target: an Effect Schema source paired with
 * the identity and destination it is serialized under. A repo generating
 * SchemaStore artifacts declares one target per emitted document (the
 * extraction source's `{schema, $id, path}` triples, generalized).
 *
 * Not a `Schema.Class`: a target carries a live Effect Schema value, which
 * is program wiring rather than serializable data.
 *
 * @public
 */
export interface SchemaTarget {
	/** The Effect Schema source the document is generated from. */
	readonly schema: Schema.Constraint;
	/** The canonical `$id` URL the generated document declares. */
	readonly $id: string;
	/** The catalog/file base name (`name.json` / `name-<version>.json`). */
	readonly name: string;
	/** The destination path the document is written to (phase-2 `SchemaFile`). */
	readonly path: string;
	/** The version label, for versioned catalog mode. Omit for unversioned. */
	readonly version?: SchemaVersion;
}

/**
 * Constructors for `SchemaTarget` values.
 *
 * @public
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: deliberate — the class carries only statics and a private constructor, so it contributes no instance members to the merge; the interface (above) remains the sole shape of a SchemaTarget value.
export class SchemaTarget {
	private constructor() {}

	/**
	 * Builds a target. `$id`, `name` and `path` must be non-empty — an
	 * empty identity is a wiring mistake and throws.
	 */
	static make(options: {
		readonly schema: Schema.Constraint;
		readonly $id: string;
		readonly name: string;
		readonly path: string;
		readonly version?: SchemaVersion;
	}): SchemaTarget {
		for (const key of ["$id", "name", "path"] as const) {
			if (options[key].length === 0) {
				throw new Error(`SchemaTarget.make requires a non-empty "${key}"`);
			}
		}
		return {
			schema: options.schema,
			$id: options.$id,
			name: options.name,
			path: options.path,
			...(options.version !== undefined ? { version: options.version } : {}),
		};
	}
}
