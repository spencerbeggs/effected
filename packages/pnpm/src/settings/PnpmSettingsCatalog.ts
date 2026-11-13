import type { PeerDependencyRules, VersioningConfig } from "@effected/pnpm";
import { build } from "./catalog/build.js";
import { cli } from "./catalog/cli.js";
import { dependencyResolution } from "./catalog/dependency-resolution.js";
import { network } from "./catalog/network.js";
import { nodeModules } from "./catalog/node-modules.js";
import { other } from "./catalog/other.js";
import { peerDependencies } from "./catalog/peer-dependencies.js";
import { publish } from "./catalog/publish.js";
import { store } from "./catalog/store.js";
import { tasks } from "./catalog/tasks.js";
import { versioning } from "./catalog/versioning.js";
import { workspace } from "./catalog/workspace.js";
import type { PnpmSetting } from "./PnpmSetting.js";

/**
 * Every setting pnpm 12 reads, keyed by its camelCase name: the schema it
 * decodes through, its kind, a description, the sources pnpm reads it from,
 * its default and its docs anchor.
 *
 * @remarks
 * The catalog is the settings pnpm 12's config crate deserializes from
 * `pnpm-workspace.yaml`, the global `config.yaml` and the machine-level
 * sources, plus every setting pnpm's settings docs document. It leaves out
 * the five build settings pnpm 12 recognises but never applies
 * (`onlyBuiltDependencies`, `onlyBuiltDependenciesFile`,
 * `neverBuiltDependencies`, `ignoredBuiltDependencies`, `executionEnv`; use
 * `allowBuilds`) and settings of other pnpm majors.
 *
 * The object is frozen, holds a few hundred schemas, and is one value a bundler
 * cannot tree-shake, which is why it ships from `@effected/pnpm/settings` and
 * never from the package root. A consumer's merge or enforcement policy is laid
 * over it, never stored in it.
 *
 * @example
 * ```ts
 * import { PnpmSettingsCatalog } from "@effected/pnpm/settings";
 *
 * const linker = PnpmSettingsCatalog.nodeLinker;
 * console.log(linker.kind, linker.locations);
 * // => union [ 'workspace', 'env' ]
 * ```
 *
 * @public
 */
export const PnpmSettingsCatalog = Object.freeze({
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
 * The name of a setting in {@link PnpmSettingsCatalog}.
 *
 * @public
 */
export type PnpmSettingName = keyof typeof PnpmSettingsCatalog;

/**
 * The decoded type of a setting in {@link PnpmSettingsCatalog}.
 *
 * @typeParam K - The setting.
 * @public
 */
export type PnpmSettingType<K extends PnpmSettingName> = (typeof PnpmSettingsCatalog)[K]["schema"]["Type"];
