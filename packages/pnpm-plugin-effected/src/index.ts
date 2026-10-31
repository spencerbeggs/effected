import { catalogs as declared } from "rolldown-pnpm-config/virtual/catalogs";

/**
 * The one catalog a consumer installs, `effected`: the Effect family and the
 * kit, folded from the catalogs `savvy.build.ts` declares, exactly as the
 * plugin's `updateConfig` hook presents them to pnpm.
 *
 * @public
 */
export const catalogs: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
	["effected", new Map([...(declared.get("effect") ?? []), ...(declared.get("effected") ?? [])])],
]);
