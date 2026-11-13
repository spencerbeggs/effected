// Pure helpers shared by record-pnpm-oracle.ts and the fixture guard test. Never shipped.

import { isAbsolute, resolve, sep } from "node:path";

/** One release-plan line of `pnpm change status`: `  name: cur → new (bump, via cause+cause)`. */
export const PLAN_LINE = /^\s+(\S+): (\S+) → (\S+) \(([^,)]+), via ([^)]+)\)\s*$/;

/**
 * Resolve a prelude path inside the scratch copy. Rejects an absolute path, any
 * `..` segment, and any result that does not sit strictly under `work`, so a
 * prelude can never create, overwrite or delete a file outside the copy.
 */
export const containedPath = (work: string, relative: string): string => {
	if (isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
		throw new Error(`prelude path ${JSON.stringify(relative)} must be relative and free of ".."`);
	}
	const target = resolve(work, relative);
	if (!target.startsWith(work + sep)) {
		throw new Error(`prelude path ${JSON.stringify(relative)} escapes the scratch copy`);
	}
	return target;
};
