import type { PeerDependencyRules, PnpmSettings, PnpmSettingsError, VersioningConfig } from "@effected/pnpm";
import type { Option, Result } from "effect";
import { build } from "./internal/build.js";
import { cli } from "./internal/cli.js";
import { dependencyResolution } from "./internal/dependency-resolution.js";
import { network } from "./internal/network.js";
import { nodeModules } from "./internal/node-modules.js";
import { other } from "./internal/other.js";
import { peerDependencies } from "./internal/peer-dependencies.js";
import { publish } from "./internal/publish.js";
import { readThrough } from "./internal/read.js";
import { store } from "./internal/store.js";
import { tasks } from "./internal/tasks.js";
import { versioning } from "./internal/versioning.js";
import { workspace } from "./internal/workspace.js";
import type { PnpmSetting } from "./PnpmSetting.js";

/**
 * Every setting pnpm 12 reads, as data, and a typed read of one setting from
 * `PnpmSettings`.
 *
 * @remarks
 * {@link PnpmSettingsCatalog.entries} holds one {@link PnpmSetting} per setting
 * pnpm 12's config crate deserializes from `pnpm-workspace.yaml`, the global
 * `config.yaml` and the machine-level sources, plus every setting pnpm's
 * settings docs document. It leaves out the five build settings pnpm 12
 * recognises but never applies (`onlyBuiltDependencies`,
 * `onlyBuiltDependenciesFile`, `neverBuiltDependencies`,
 * `ignoredBuiltDependencies`, `executionEnv`; use `allowBuilds`) and settings
 * of other pnpm majors.
 *
 * The entries hold a few hundred schemas in one value a bundler cannot
 * tree-shake, which is why the catalog ships from `@effected/pnpm/settings`
 * and never from the package root. An entry carries facts about pnpm only; a
 * consumer's merge or enforcement policy is laid over it, never stored in it.
 *
 * @example
 * ```ts
 * import { PnpmSettingsCatalog } from "@effected/pnpm/settings";
 *
 * const linker = PnpmSettingsCatalog.entries.nodeLinker;
 * console.log(linker.kind, linker.locations);
 * // => union [ 'workspace', 'env' ]
 * ```
 *
 * @public
 */
export class PnpmSettingsCatalog {
	private constructor() {}

	/** Every pnpm 12 setting, keyed by its camelCase name; frozen. */
	static readonly entries = Object.freeze({
		...cli,
		...network,
		...dependencyResolution,
		...peerDependencies,
		...nodeModules,
		...store,
		...build,
		...other,
		...versioning,
		...workspace,
		...publish,
		...tasks,
		// The two settings whose values are the package's own classes. Naming them here
		// also lets the declarations refer to the root's classes through
		// `@effected/pnpm` instead of carrying copies of them.
	} satisfies {
		readonly peerDependencyRules: PnpmSetting<PeerDependencyRules>;
		readonly versioning: PnpmSetting<VersioningConfig>;
	});

	/**
	 * One setting from `settings`, decoded through its entry: the highest
	 * source pnpm 12 reads the setting from that sets it, or `None`.
	 *
	 * @remarks
	 * Only the sources in the entry's `locations` are consulted, in pnpm's
	 * order: the environment, then `pnpm-workspace.yaml`, then the global
	 * `config.yaml`. A `nodeLinker` in the global file is not read, as pnpm
	 * does not read it; neither is a `stateDir` in the workspace file. The
	 * `npmrc` location is never read: `PnpmSettings` carries no `.npmrc`
	 * values, which `@effected/npm`'s `NpmConfig` reads.
	 *
	 * An environment value is parsed by the entry's `envFormat`, as pnpm 12
	 * parses it: a `json` boolean is `true` or `false` exactly (`yes` and
	 * `TRUE` are ignored), a `text` setting is the value as written, a
	 * `jsonOrText` setting reads `hoisted` and `"hoisted"` alike. A value
	 * pnpm would ignore is skipped to the next source, and a `subkeys` section
	 * is not read from the environment at all. A file value that does not
	 * decode fails `"shape"` naming the setting, with the schema issue as the
	 * `cause`: pnpm 12 refuses such a file. A file's `null` is the value of a
	 * setting that accepts `null` (`scriptShell: null` clears an inherited
	 * shell) and unset for any other.
	 *
	 * @example
	 * ```ts
	 * import { PnpmSettings } from "@effected/pnpm";
	 * import { PnpmSettingsCatalog } from "@effected/pnpm/settings";
	 * import { Result } from "effect";
	 *
	 * const settings = Result.getOrThrow(
	 *   PnpmSettings.fromSourcesResult({ workspace: { text: "nodeLinker: hoisted\n" } }),
	 * );
	 * console.log(PnpmSettingsCatalog.read(settings, "nodeLinker"));
	 * // => a success holding Option.some("hoisted")
	 * ```
	 *
	 * @param settings - The merged settings sources.
	 * @param key - The setting.
	 */
	static read<K extends PnpmSettingName>(
		settings: PnpmSettings,
		key: K,
	): Result.Result<Option.Option<PnpmSettingType<K>>, PnpmSettingsError> {
		return readThrough(settings, PnpmSettingsCatalog.entries[key] as PnpmSetting<unknown>) as Result.Result<
			Option.Option<PnpmSettingType<K>>,
			PnpmSettingsError
		>;
	}
}

/**
 * The name of a setting in `PnpmSettingsCatalog.entries`.
 *
 * @public
 */
export type PnpmSettingName = keyof typeof PnpmSettingsCatalog.entries;

/**
 * The decoded type of a setting in `PnpmSettingsCatalog.entries`.
 *
 * @typeParam K - The setting.
 * @public
 */
export type PnpmSettingType<K extends PnpmSettingName> = (typeof PnpmSettingsCatalog.entries)[K]["schema"]["Type"];
