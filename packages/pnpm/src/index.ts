/**
 * Everything pnpm owns alone, over the npm vocabulary it shares:
 * {@link ReleaseAgeGate} (`minimumReleaseAge` and
 * `minimumReleaseAgeExclude`), {@link PnpmSettings} (the settings
 * `pnpm config get` reports, merged in pnpm's precedence),
 * {@link PnpmNpmConfig} (pnpm's registry, proxy and TLS view as an
 * `@effected/npm` `NpmConfig`) and
 * {@link PnpmMatcher} (the package-name pattern lists pnpm reads through
 * `@pnpm/matcher`), {@link OverrideKey} (the `overrides` selector grammar),
 * {@link PeerDependencyRules} (the `peerDependencyRules` block),
 * {@link PnpmWorkspaceFile} (the `pnpm-workspace.yaml` editor), and the native `pnpm-lock.yaml` documents:
 * {@link PnpmLockDocument} (the lockfile document), {@link PnpmEnvDocument}
 * (the env preamble ahead of it) and {@link PnpmExtension} (the lockfile
 * header pnpm alone records).
 *
 * @packageDocumentation
 */

export { OverrideKey, OverrideKeyError } from "./OverrideKey.js";
export { PeerDependencyRules } from "./PeerDependencyRules.js";
export { PnpmEnvDocument } from "./PnpmEnvDocument.js";
export { type PnpmCatalogs, PnpmExtension } from "./PnpmExtension.js";
export { PnpmLockDocument } from "./PnpmLockDocument.js";
export { PnpmMatcher } from "./PnpmMatcher.js";
export { PnpmNpmConfig, type PnpmNpmConfigSources } from "./PnpmNpmConfig.js";
export {
	type PnpmSettingOrigin,
	PnpmSettings,
	PnpmSettingsError,
	type PnpmSettingsLoadOptions,
	type PnpmSettingsSource,
	type PnpmSettingsSources,
} from "./PnpmSettings.js";
export { PnpmWorkspaceFile, PnpmWorkspaceFileError } from "./PnpmWorkspaceFile.js";
export { PartialReleaseAgeGate, ReleaseAgeGate } from "./ReleaseAgeGate.js";
export { Epic, VersioningConfig } from "./VersioningConfig.js";
