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
 * `lib/build/pnpm-config.plugin.ts` declares one catalog, `effected`, and its `:peers` twin. The
 * twin serves this repo's own published peer floors, through the root
 * `pnpm-workspace.yaml` that `pnpm:export` writes; a consumer never needs it,
 * since its packed peer takes the `effected` range (`pnpm pack` runs no hook),
 * so the hook hides it and a consumer sees exactly one catalog.
 */
const HIDDEN = ["effected:peers"] as const;

function hide(config: PnpmConfig): PnpmConfig {
	const catalogs = config.catalogs;
	if (catalogs === undefined) return config;
	const out: CatalogMap = { ...catalogs };
	for (const name of HIDDEN) delete out[name];
	return { ...config, catalogs: out };
}

/**
 * The plugin's pnpm hooks: the generated `updateConfig`, then hiding the peers catalog.
 *
 * @public
 */
export const hooks = {
	updateConfig(config: PnpmConfig): PnpmConfig | Promise<PnpmConfig> {
		const result = generated.updateConfig(config as never) as unknown as PnpmConfig | Promise<PnpmConfig>;
		return result instanceof Promise ? result.then(hide) : hide(result);
	},
};
