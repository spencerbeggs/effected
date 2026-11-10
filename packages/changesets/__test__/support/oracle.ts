import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The oracle tests' loaders for `@changesets/get-release-plan`'s own
 * dependencies (`@changesets/config`, `@changesets/pre`, `@changesets/read`,
 * `@changesets/parse`, `@manypkg/get-packages`). They are not this package's devDependencies, so
 * each is imported from beside `get-release-plan`, the copy it resolves
 * itself, through its manifest's `"."` export.
 */
const getReleasePlanDir = realpathSync(
	fileURLToPath(new URL("../../node_modules/@changesets/get-release-plan", import.meta.url)),
);

/** A dependency of `@changesets/get-release-plan`, loaded from beside it as it loads one. */
export const sibling = async <A>(name: string): Promise<A> => {
	const dir = join(getReleasePlanDir, "..", "..", name);
	const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { exports: { ".": string } };
	return (await import(pathToFileURL(join(dir, manifest.exports["."])).href)) as A;
};

/**
 * `@changesets/parse`, found the way `@changesets/read` (one of those
 * dependencies) finds it: from beside `@changesets/read`.
 */
export const loadParse = async (): Promise<(contents: string) => { releases: unknown; summary: string }> => {
	const readDir = realpathSync(join(getReleasePlanDir, "..", "read"));
	const dir = join(readDir, "..", "parse");
	const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { exports: { ".": string } };
	const module = (await import(pathToFileURL(join(dir, manifest.exports["."])).href)) as {
		parseChangesetFile: (contents: string) => { releases: unknown; summary: string };
	};
	return module.parseChangesetFile;
};

/** The oracle's own shapes, which come from untyped dynamic imports. */
// biome-ignore lint/suspicious/noExplicitAny: the oracle's own shapes come from untyped dynamic imports
export type Any = any;
