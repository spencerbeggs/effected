import type { Option, Schema } from "effect";

/**
 * A source pnpm 12 reads a setting from: the project's `pnpm-workspace.yaml`
 * (`"workspace"`), an `.npmrc` file (`"npmrc"`), pnpm's global `config.yaml`
 * (`"global"`), or a `PNPM_CONFIG_*` environment variable (`"env"`).
 *
 * @remarks
 * `"npmrc"` records where pnpm reads a setting, not a source this package
 * reads: `PnpmSettings` and `PnpmSettingsCatalog.read` take nothing from an
 * `.npmrc` file. Read the npmrc half of a registry, proxy or TLS setting with
 * `@effected/npm`'s `NpmConfig`.
 *
 * @public
 */
export type PnpmSettingLocation = "workspace" | "npmrc" | "global" | "env";

/**
 * The broad shape of a setting's value, for rendering documentation and
 * synthesizing samples: the descriptor kinds `rolldown-pnpm-config` uses,
 * plus `"stringRecordRecord"` for the one shape they had no kind for.
 *
 * @remarks
 * `"enum"` is a closed set of strings; `"union"` mixes value types (a boolean
 * or a word, a word or an object); `"object"` is a mapping with named keys.
 * `"stringRecordRecord"` is a mapping of mappings from strings to strings, the
 * shape of `catalogs` (catalog name, then dependency name, then range); a
 * consumer that only knows the older kinds can read it as `"unknownRecord"`.
 *
 * @public
 */
export type PnpmSettingKind =
	| "boolean"
	| "number"
	| "string"
	| "enum"
	| "union"
	| "stringArray"
	| "stringRecord"
	| "booleanRecord"
	| "unknownRecord"
	| "stringArrayRecord"
	| "stringRecordRecord"
	| "object";

/**
 * How pnpm 12 reads a setting's `PNPM_CONFIG_*` variable.
 *
 * @remarks
 * - `"json"`: a JSON document, typed strictly (`true`, never `yes` or
 *   `"true"`); a value that does not parse is ignored.
 * - `"text"`: the value as written.
 * - `"jsonOrText"`: a JSON document, else the value as a JSON string; an
 *   enumerated setting reads `hoisted` and `"hoisted"` alike.
 * - `"flag"`: as `"jsonOrText"`, except that a value that matches nothing reads
 *   as `true` (`verifyDepsBeforeRun`).
 * - `"subkeys"`: the section is read from one variable per key
 *   (`PNPM_CONFIG_NODE_PACKAGE_MAP_MODE`), never under the setting's own name.
 *
 * @public
 */
export type PnpmSettingEnvFormat = "json" | "text" | "jsonOrText" | "flag" | "subkeys";

/**
 * One pnpm 12 setting: what it accepts and where pnpm reads it, as plain data.
 *
 * @remarks
 * The entry carries facts about pnpm only. Merge strategy and enforcement are
 * a consumer's policy over the catalog, not part of an entry.
 *
 * The schema decodes a value as it reaches pnpm from a YAML file (a boolean
 * also from the words pnpm 12 coerces, a number also from canonical digits),
 * and rejects what pnpm 12's config crate refuses. A setting pnpm reads with
 * an explicit `null` meaning "clear the inherited value" accepts `null`.
 *
 * @typeParam A - The decoded value.
 * @public
 */
export interface PnpmSetting<A> {
	/** The camelCase key, as written in `pnpm-workspace.yaml`. */
	readonly name: string;
	/** Decodes the setting's value. */
	readonly schema: Schema.Codec<A, unknown>;
	/** The broad shape of the value. */
	readonly kind: PnpmSettingKind;
	/** What the setting does, in one or two sentences. */
	readonly description: string;
	/** The sources pnpm 12 reads the setting from; empty when it reads it from none. */
	readonly locations: ReadonlyArray<PnpmSettingLocation>;
	/** How pnpm parses the setting's environment variable; absent when pnpm reads none. */
	readonly envFormat?: PnpmSettingEnvFormat;
	/** pnpm's default, when it is one fixed value; `None` when it is computed or absent. */
	readonly default: Option.Option<unknown>;
	/**
	 * Where pnpm's docs describe the setting, as `settings/<page>#<heading id>`
	 * relative to the docs root; empty when pnpm's settings docs do not.
	 */
	readonly anchor: string;
}
