/**
 * Everything pnpm owns alone, over the npm vocabulary it shares:
 * {@link ReleaseAgeGate} (`minimumReleaseAge` and
 * `minimumReleaseAgeExclude`), {@link PnpmSettings} (the settings
 * `pnpm config get` reports, merged in pnpm's precedence) and
 * {@link PnpmMatcher} (the package-name pattern lists pnpm reads through
 * `@pnpm/matcher`).
 *
 * @packageDocumentation
 */

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
