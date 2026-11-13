/**
 * The pnpm 12 settings catalog: {@link PnpmSettingsCatalog}, one
 * {@link PnpmSetting} per setting pnpm reads in
 * `PnpmSettingsCatalog.entries`, and `PnpmSettingsCatalog.read`, a typed read of
 * one setting from `PnpmSettings`.
 *
 * @remarks
 * A subpath of its own: the catalog is one large object no bundler can
 * tree-shake, so the package root never reaches it.
 *
 * @packageDocumentation
 */

export type {
	PnpmSetting,
	PnpmSettingEnvFormat,
	PnpmSettingKind,
	PnpmSettingLocation,
} from "./settings/PnpmSetting.js";
export { type PnpmSettingName, type PnpmSettingType, PnpmSettingsCatalog } from "./settings/PnpmSettingsCatalog.js";
