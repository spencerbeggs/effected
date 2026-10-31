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
 * The catalogs `savvy.build.ts` declares, folded into the one a consumer sees.
 * The declarations stay split because `overridesFromCatalogs` and the `upgrade`
 * CLI work per catalog: the Effect family is pinned graph-wide, the kit is not.
 * The `:peers` catalogs serve this repo's own published peer floors, through the
 * root `pnpm-workspace.yaml` that `pnpm:export` writes; a consumer's packed peer
 * takes the `effected` range, since `pnpm pack` runs no hook.
 */
const FOLDED = "effected";
const ABSORBED = ["effect"] as const;
const HIDDEN = ["effect:peers", "effected:peers"] as const;

function fold(config: PnpmConfig): PnpmConfig {
	const catalogs = config.catalogs;
	if (catalogs === undefined) return config;
	const out: CatalogMap = { ...catalogs };
	const merged: Record<string, string> = {};
	for (const name of ABSORBED) Object.assign(merged, out[name]);
	// The consumer's own `effected` entries win, as they do in the generated merge.
	Object.assign(merged, out[FOLDED]);
	out[FOLDED] = merged;
	for (const name of [...ABSORBED, ...HIDDEN]) delete out[name];
	return { ...config, catalogs: out };
}

/**
 * The plugin's pnpm hooks: the generated `updateConfig`, then the catalog fold.
 *
 * @public
 */
export const hooks = {
	updateConfig(config: PnpmConfig): PnpmConfig | Promise<PnpmConfig> {
		const result = generated.updateConfig(config as never) as unknown as PnpmConfig | Promise<PnpmConfig>;
		return result instanceof Promise ? result.then(fold) : fold(result);
	},
};
