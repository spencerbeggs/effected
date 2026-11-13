/**
 * The pnpm 12 settings catalog: {@link PnpmSettingsCatalog}, one
 * {@link PnpmSetting} per setting pnpm reads, and {@link readSetting}, a typed
 * read of one setting from `PnpmSettings`.
 *
 * @remarks
 * A subpath of its own: the catalog is one large object no bundler can
 * tree-shake, so the package root never reaches it.
 *
 * @packageDocumentation
 */

export type { PnpmSetting, PnpmSettingKind, PnpmSettingLocation } from "./settings/PnpmSetting.js";
export { type PnpmSettingName, type PnpmSettingType, PnpmSettingsCatalog } from "./settings/PnpmSettingsCatalog.js";
export { readSetting } from "./settings/typedRead.js";
