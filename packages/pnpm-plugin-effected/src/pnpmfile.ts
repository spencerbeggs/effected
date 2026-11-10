import { hooks as generated } from "rolldown-pnpm-config/virtual/pnpmfile";

type CatalogMap = Record<string, Record<string, string>>;

/**
 * The config pnpm hands `updateConfig`. The virtual module types `catalogs` as a
 * `Map`, but pnpm passes, and the generated merge returns, a plain record.
 *
 * @public
 */
export interface PnpmConfig {
	readonly catalogs?: CatalogMap | undefined;
	readonly [key: string]: unknown;
}

/**
 * The plugin's pnpm hooks: the generated `updateConfig`, unchanged.
 *
 * @remarks
 * It serves all four declared catalogs. `effected` and `effected:build` pin each
 * Effect-family member at its exact override version and are for dependencies;
 * `effected:peers` and `effected:build:peers` floor each range to its minor
 * (`~4.<minor>.0`) and are for peers. `pnpm pack` writes a `catalog:` peer as the
 * catalog's value, so a peer spelled `catalog:effected` would publish an exact
 * version.
 *
 * @public
 */
export const hooks = {
	updateConfig(config: PnpmConfig): PnpmConfig | Promise<PnpmConfig> {
		return generated.updateConfig(config as never) as unknown as PnpmConfig | Promise<PnpmConfig>;
	},
};
