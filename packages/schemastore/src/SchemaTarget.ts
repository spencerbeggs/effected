import type { Schema } from "effect";
import { Result } from "effect";
import type { SchemaVersion } from "./SchemaVersioning.js";
import { SchemaVersioning } from "./SchemaVersioning.js";

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
	/**
	 * The catalog/file base name (`name.json` / `name-<version>.json`).
	 *
	 * Only the catalog path consumes it — a target that merely emits a file
	 * to `path` needs no name, and inventing one to
	 * satisfy the constructor duplicates the basename with no invariant
	 * tying the two together. Required whenever `version` is present, since
	 * versioned catalog naming is defined in terms of it.
	 */
	readonly name?: string;
	/** The destination path the document is written to (`SchemaFile`). */
	readonly path: string;
	/**
	 * The version label, for versioned catalog mode. Omit for unversioned.
	 *
	 * It carries a second meaning the catalog does not: presence of a
	 * **pinned** label (one with no prerelease) declares that consumers pin
	 * this document's URL, so `SchemaPipeline.run` refuses to rewrite it in
	 * place when its validation contract changes — bump `version`, `$id` and
	 * `path` together instead, or pass `contractChanges: "allow"`. That is
	 * only coherent when the version participates in `path`
	 * (`schemas/<version>/<name>-<version>.json`): a versioned target at a
	 * fixed path compares the same file forever, and bumping `version` does
	 * not move it. A prerelease label declares its own instability and is
	 * rewritten in place.
	 */
	readonly version?: SchemaVersion;
	/**
	 * Whether a consumer already depends on this document at this label.
	 *
	 * @remarks
	 * The lifecycle switch the drift policy reads: an unpublished target is
	 * always regenerated in place, a published one is held to the configured
	 * drift tolerance. Defaults to `false`. The library's own
	 * `contractChanges: "block-versioned"` policy keys on a pinned `version`,
	 * not on this flag — the CLI is what reads it.
	 */
	readonly published: boolean;
	/**
	 * Options passed through to {@link StoreDocument.fromSchema} (and, from
	 * there, core's `Schema.toJsonSchemaDocument`).
	 *
	 * A target-level field rather than a pipeline-wide default keeps each
	 * document's generation contract self-describing, so
	 * {@link SchemaPipeline} reproduces a document deterministically
	 * regardless of core's own default — for example, an `onExcessProperty`
	 * setting of `"ignore"` reopens a document's objects, which
	 * {@link StoreDocument.fromSchema} closes by default. See
	 * {@link StoreDocumentOptions.jsonSchema} for that default and the
	 * `includeAnnotationKey` gate this option is also subject to.
	 */
	readonly jsonSchema?: Schema.ToJsonSchemaOptions;
	/**
	 * Forwarded to {@link StoreDocumentOptions.rootAnnotations}; a
	 * target-level field for the same self-describing reason as
	 * `jsonSchema`.
	 */
	readonly rootAnnotations?: Readonly<Record<string, unknown>>;
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
	 * Builds an unversioned target. `name` is optional — only catalog
	 * naming reads it, so a target that merely emits a file needs none.
	 */
	static make(options: {
		readonly schema: Schema.Constraint;
		readonly $id: string;
		readonly name?: string;
		readonly path: string;
		readonly published?: boolean;
		readonly jsonSchema?: Schema.ToJsonSchemaOptions;
		readonly rootAnnotations?: Readonly<Record<string, unknown>>;
	}): SchemaTarget;
	/**
	 * Builds a versioned target. `name` is **required** here: versioned
	 * catalog naming is `name-<version>.json`, so a version without a name
	 * cannot be resolved — the overload pair makes that unrepresentable
	 * rather than a runtime throw. `version` also accepts a plain string
	 * label, parsed via {@link SchemaVersioning.parseResult}.
	 */
	static make(options: {
		readonly schema: Schema.Constraint;
		readonly $id: string;
		readonly name: string;
		readonly path: string;
		readonly version: SchemaVersion | string;
		readonly published?: boolean;
		readonly jsonSchema?: Schema.ToJsonSchemaOptions;
		readonly rootAnnotations?: Readonly<Record<string, unknown>>;
	}): SchemaTarget;
	/**
	 * Builds a target. `$id` and `path` must be non-empty — an empty
	 * identity is a wiring mistake and throws, as does an empty `name` when
	 * one is given. The `name`-with-`version` invariant is enforced by the
	 * overloads above; the runtime check remains for untyped callers. A
	 * string `version` that fails {@link SchemaVersioning.parseResult} throws,
	 * naming the invalid label.
	 */
	static make(options: {
		readonly schema: Schema.Constraint;
		readonly $id: string;
		readonly name?: string;
		readonly path: string;
		readonly version?: SchemaVersion | string;
		readonly published?: boolean;
		readonly jsonSchema?: Schema.ToJsonSchemaOptions;
		readonly rootAnnotations?: Readonly<Record<string, unknown>>;
	}): SchemaTarget {
		for (const key of ["$id", "path"] as const) {
			if (options[key].length === 0) {
				throw new Error(`SchemaTarget.make requires a non-empty "${key}"`);
			}
		}
		if (options.name !== undefined && options.name.length === 0) {
			throw new Error('SchemaTarget.make requires a non-empty "name" when one is given');
		}
		if (options.version !== undefined && options.name === undefined) {
			throw new Error(
				'SchemaTarget.make requires a "name" when "version" is given (catalog naming is name-<version>.json)',
			);
		}
		const version =
			options.version === undefined
				? undefined
				: Result.getOrThrowWith(
						SchemaVersioning.parseResult(options.version),
						(error) =>
							new Error(`SchemaTarget.make received an invalid version label "${options.version}": ${error.message}`),
					);
		return {
			schema: options.schema,
			$id: options.$id,
			path: options.path,
			published: options.published ?? false,
			...(options.name !== undefined ? { name: options.name } : {}),
			...(version !== undefined ? { version } : {}),
			...(options.jsonSchema !== undefined ? { jsonSchema: options.jsonSchema } : {}),
			...(options.rootAnnotations !== undefined ? { rootAnnotations: options.rootAnnotations } : {}),
		};
	}
}
