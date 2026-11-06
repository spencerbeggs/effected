import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer } from "effect";
import { ConfigValidationError } from "../errors.js";

/**
 * A `bundledPackages` entry that is a workspace sibling, located at its built declarations.
 *
 * @public
 */
export interface BundledSibling {
	/** The package name. */
	readonly name: string;
	/** The absolute `dist/prod/<canonical group>/pkg` directory holding its declarations. */
	readonly pkgDir: string;
	/** Absolute declaration files of its nested subpaths, which `<name>/*` cannot reach: emitted names are flattened. */
	readonly nestedExports: Readonly<Record<string, string>>;
}

/** The package a `bundledPackages` entry belongs to: an entry may name a subpath, since tsdown matches them exactly. */
export const packageNameOf = (entry: string): string =>
	entry
		.split("/")
		.slice(0, entry.startsWith("@") ? 2 : 1)
		.join("/");

/** Bound once: the platform layer is stateless and layers memoize by reference. */
const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const rootLayer = WorkspaceRoot.layer.pipe(Layer.provide(platform));

/** The workspace root above `cwd`, canonical; absent for a package outside any workspace. */
const findWorkspaceRoot = (cwd: string): Promise<string | undefined> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const workspaceRoot = yield* WorkspaceRoot;
			return yield* workspaceRoot.find(cwd);
		}).pipe(
			Effect.provide(rootLayer),
			Effect.map((root) => realpathSync(root)),
			Effect.catch(() => Effect.void.pipe(Effect.as(undefined))),
		),
	);

/**
 * The directory `name` links to when that is a sibling: the first `node_modules/<name>` found from `cwd` up to the
 * root, realpathed into the root and outside any `node_modules`. A registry package and a `file:` link to another
 * checkout both fail that, and are inlined the ordinary way.
 */
const siblingDirOf = (name: string, cwd: string, root: string): string | undefined => {
	let dir = realpathSync(cwd);
	for (;;) {
		const link = join(dir, "node_modules", name);
		if (existsSync(link)) {
			const target = realpathSync(link);
			const segments = relative(root, target).split(sep);
			return segments[0] === ".." || segments.includes("node_modules") ? undefined : target;
		}
		if (dir === root || dirname(dir) === dir) return undefined;
		dir = dirname(dir);
	}
};

/** The group a sibling's `targets.json` names canonical, by the meta pass's rule; `npm` when it has none to read. */
const canonicalGroupOf = (siblingDir: string, name: string): string => {
	try {
		const { groups } = JSON.parse(readFileSync(join(siblingDir, "dist", "prod", "targets.json"), "utf-8")) as {
			groups: ReadonlyArray<{ id: string; name: string }>;
		};
		return (groups.find((group) => group.name === name) ?? groups[0])?.id ?? "npm";
	} catch {
		return "npm";
	}
};

/** Nested subpaths of the sibling's emitted manifest, each to its absolute declaration file. */
const nestedExportsOf = (pkgDir: string, name: string): Readonly<Record<string, string>> => {
	let exportsMap: unknown;
	try {
		exportsMap = (JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8")) as { exports?: unknown }).exports;
	} catch {
		return {};
	}
	if (typeof exportsMap !== "object" || exportsMap === null) return {};
	const nested: Record<string, string> = {};
	for (const [key, value] of Object.entries(exportsMap)) {
		const types = (value as { types?: unknown } | null)?.types;
		if (/^\.\/[^*]*\/[^*]*$/.test(key) && typeof types === "string") {
			nested[`${name}${key.slice(1)}`] = join(pkgDir, types);
		}
	}
	return nested;
};

/**
 * Finds the workspace siblings among `names` and locates each one's built declarations.
 *
 * @remarks
 * Names that are not siblings are left out, and nothing is read when `names` is empty. An entry naming a subpath
 * locates the package it belongs to.
 *
 * @throws {@link ConfigValidationError} when a sibling has no built `index.d.ts`.
 * @public
 */
export async function resolveBundledSiblings(
	cwd: string,
	names: ReadonlyArray<string>,
): Promise<ReadonlyArray<BundledSibling>> {
	if (names.length === 0) return [];
	const root = await findWorkspaceRoot(cwd);
	if (root === undefined) return [];
	const siblings: BundledSibling[] = [];
	for (const name of new Set(names.map(packageNameOf))) {
		const siblingDir = siblingDirOf(name, cwd, root);
		if (siblingDir === undefined) continue;
		const pkgDir = join(siblingDir, "dist", "prod", canonicalGroupOf(siblingDir, name), "pkg");
		if (!existsSync(join(pkgDir, "index.d.ts"))) {
			throw new ConfigValidationError({
				path: "bundledPackages",
				reason: `"${name}" is a workspace sibling with no built declarations at ${join(pkgDir, "index.d.ts")}. Build ${name} first; a turbo build task that inlines a sibling's types needs dependsOn: ["^build"] in that package's own turbo.json.`,
			});
		}
		siblings.push({ name, pkgDir, nestedExports: nestedExportsOf(pkgDir, name) });
	}
	return siblings;
}

/**
 * The tsconfig `paths` map resolving each sibling, and nothing else, to its built declarations.
 *
 * @public
 */
export function siblingPaths(siblings: ReadonlyArray<BundledSibling>): Record<string, ReadonlyArray<string>> {
	const paths: Record<string, ReadonlyArray<string>> = {};
	for (const { name, pkgDir, nestedExports } of siblings) {
		paths[name] = [join(pkgDir, "index.d.ts")];
		paths[`${name}/*`] = [join(pkgDir, "*.d.ts")];
		for (const [subpath, file] of Object.entries(nestedExports)) paths[subpath] = [file];
	}
	return paths;
}
