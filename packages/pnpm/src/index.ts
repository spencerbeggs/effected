/**
 * Everything pnpm owns alone, over the npm vocabulary it shares:
 * {@link ReleaseAgeGate} (`minimumReleaseAge` and
 * `minimumReleaseAgeExclude`), {@link PnpmSettings} (the settings
 * `pnpm config get` reports, merged in pnpm's precedence) and
 * {@link PnpmMatcher} (the package-name pattern lists pnpm reads through
 * `@pnpm/matcher`), and the native `pnpm-lock.yaml` documents:
 * {@link PnpmLockDocument} (the lockfile document), {@link PnpmEnvDocument}
 * (the env preamble ahead of it) and {@link PnpmExtension} (the lockfile
 * header pnpm alone records).
 *
 * @packageDocumentation
 */

export { PnpmEnvDocument } from "./PnpmEnvDocument.js";
export { type PnpmCatalogs, PnpmExtension } from "./PnpmExtension.js";
export { PnpmLockDocument } from "./PnpmLockDocument.js";
export { PnpmMatcher } from "./PnpmMatcher.js";
export {
	type PnpmSettingOrigin,
	PnpmSettings,
	PnpmSettingsError,
	type PnpmSettingsLoadOptions,
	type PnpmSettingsSource,
	type PnpmSettingsSources,
} from "./PnpmSettings.js";
export { PartialReleaseAgeGate, ReleaseAgeGate } from "./ReleaseAgeGate.js";
