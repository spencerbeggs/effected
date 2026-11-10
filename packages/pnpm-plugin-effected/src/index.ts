import { catalogs as declared } from "rolldown-pnpm-config/virtual/catalogs";

/**
 * The catalogs a consumer installs, as the plugin's `updateConfig` hook presents
 * them to pnpm: `effected` (the Effect family and the kit) and `effected:build`
 * (the build chain `effected package build` runs, and the toolchain a package
 * builds against), each with a `:peers` twin whose ranges are floored to their
 * minor for use in `peerDependencies`.
 *
 * @public
 */
export const catalogs: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
	["effected", new Map(declared.get("effected") ?? [])],
	["effected:peers", new Map(declared.get("effected:peers") ?? [])],
	["effected:build", new Map(declared.get("effected:build") ?? [])],
	["effected:build:peers", new Map(declared.get("effected:build:peers") ?? [])],
]);
