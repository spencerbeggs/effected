import type { Option, Schema } from "effect";

/**
 * A source pnpm 12 reads a setting from: the project's `pnpm-workspace.yaml`
 * (`"workspace"`), an `.npmrc` file (`"npmrc"`), pnpm's global `config.yaml`
 * (`"global"`), or a `PNPM_CONFIG_*` environment variable (`"env"`).
 *
 * @public
 */
export type PnpmSettingLocation = "workspace" | "npmrc" | "global" | "env";

/**
 * The broad shape of a setting's value, for rendering documentation and
 * synthesizing samples: one of the descriptor kinds `rolldown-pnpm-config`
 * already uses, so its descriptors can be laid over the catalog unchanged.
 *
 * @remarks
 * `"enum"` is a closed set of strings; `"union"` mixes value types (a boolean
 * or a word, a word or an object); `"object"` is a mapping with named keys.
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
	| "object";

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
	/** pnpm's default, when it is one fixed value; `None` when it is computed or absent. */
	readonly default: Option.Option<unknown>;
	/**
	 * Where pnpm's docs describe the setting, as `settings/<page>#<heading id>`
	 * relative to the docs root; empty when pnpm's settings docs do not.
	 */
	readonly anchor: string;
}
