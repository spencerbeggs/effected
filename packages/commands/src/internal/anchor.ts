// Anchored CommonJS resolution — the one place `createRequire` is called.
//
// Node-only: reachable from `./node-sync` and never from `.`, which
// `__test__/entrypoints.test.ts` pins. Shared by `ModuleResolution` and
// `nodePrebuiltHost`, because both answer "resolve this specifier as the
// module at `from` would".

import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** A path or a `file:` URL (string or object) as a filesystem path. */
export const toPath = (location: string | URL): string =>
	location instanceof URL || location.startsWith("file:") ? fileURLToPath(location) : location;

/** Whether `path` names an existing directory. Never throws. */
const isDirectory = (path: string): boolean => {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
};

/**
 * The file `createRequire` must be anchored on for `from`.
 *
 * `createRequire` resolves from the DIRECTORY of the file it is given, so a
 * directory anchor needs a synthetic child: a path with a trailing separator is
 * a directory by spelling, and an existing directory is one by fact. Anything
 * else is a module file (which need not exist — only its directory matters).
 */
export const anchorFile = (from: string | URL): string => {
	const path = toPath(from);
	if (path.endsWith("/") || path.endsWith("\\") || isDirectory(path)) return join(path, "__effected_anchor__.js");
	return path;
};

/** A `require` anchored at `from` — build it once when resolving several specifiers from one place. */
export const requireFrom = (from: string | URL): NodeJS.Require => createRequire(anchorFile(from));

/** Resolves `specifier` as the module at `from` would through `require.resolve`. Throws like `require.resolve`. */
export const requireResolve = (specifier: string, from: string | URL): string => requireFrom(from).resolve(specifier);
