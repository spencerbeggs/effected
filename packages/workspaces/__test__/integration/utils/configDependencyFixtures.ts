// On-disk fixtures for the config-dependency resolution ladder: a fake
// `node_modules/.pnpm-config/<name>` install, a fake pnpm store `links/` tree,
// and the `.modules.yaml` that points one at the other. Real filesystem by
// necessity — the ladder reads through `node:fs`, never the effect
// `FileSystem`, because the store is real even when a test's FileSystem is not.

import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** A pnpmfile whose hook injects `hooked-dep` at `range` into the default catalog — the value proves WHICH file ran. */
export const pnpmfileInjecting = (range: string): string =>
	[
		"export const hooks = {",
		"\tupdateConfig(config) {",
		`\t\treturn { ...config, catalog: { ...(config.catalog ?? {}), "hooked-dep": "${range}" } };`,
		"\t},",
		"};",
		"",
	].join("\n");

/** The CommonJS spelling of {@link pnpmfileInjecting}, for a `pnpmfile.js` / `pnpmfile.cjs` candidate. */
export const pnpmfileInjectingCjs = (range: string): string =>
	[
		'"use strict";',
		"exports.hooks = {",
		"\tupdateConfig(config) {",
		`\t\treturn { ...config, catalog: { ...(config.catalog ?? {}), "hooked-dep": "${range}" } };`,
		"\t},",
		"};",
		"",
	].join("\n");

/** Write `dir/package.json` with `name` and `version`, creating the directory. */
export const writeManifest = (dir: string, name: string, version: string | undefined): void => {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "package.json"), JSON.stringify(version === undefined ? { name } : { name, version }));
};

/** The `<root>/node_modules/.pnpm-config/<name>` directory. */
export const installedDir = (root: string, name: string): string => join(root, "node_modules", ".pnpm-config", name);

/**
 * Install `name@version` under `.pnpm-config` as a REAL directory (not a
 * symlink), with an optional pnpmfile. `pnpmfile` is `[filename, source]`.
 */
export const installConfigDependency = (
	root: string,
	name: string,
	version: string | undefined,
	pnpmfile?: readonly [filename: string, source: string],
): string => {
	const dir = installedDir(root, name);
	writeManifest(dir, name, version);
	if (pnpmfile !== undefined) writeFileSync(join(dir, pnpmfile[0]), pnpmfile[1]);
	return dir;
};

/** The `<store>/links/<name>/<version>/<hash>/node_modules/<name>` directory. */
export const storeLinkDir = (store: string, name: string, version: string, hash: string): string =>
	join(store, "links", name, version, hash, "node_modules", name);

/**
 * Populate a fake store with `name@version` under `hash`, with an optional
 * pnpmfile. Returns the package directory.
 */
export const storeConfigDependency = (
	store: string,
	name: string,
	version: string,
	hash: string,
	pnpmfile?: readonly [filename: string, source: string],
): string => {
	const dir = storeLinkDir(store, name, version, hash);
	writeManifest(dir, name, version);
	if (pnpmfile !== undefined) writeFileSync(join(dir, pnpmfile[0]), pnpmfile[1]);
	return dir;
};

/** Symlink `.pnpm-config/<name>` at the store's copy, the way pnpm installs a config dependency. */
export const linkConfigDependency = (root: string, name: string, target: string): void => {
	const link = installedDir(root, name);
	mkdirSync(dirname(link), { recursive: true });
	symlinkSync(target, link, "dir");
};

/** Write `<root>/node_modules/.modules.yaml` naming `store` as pnpm does (quoted keys). */
export const writeModulesYaml = (root: string, store: string): void => {
	const dir = join(root, "node_modules");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, ".modules.yaml"), `"layoutVersion": 5\n"storeDir": ${JSON.stringify(store)}\n`);
};
