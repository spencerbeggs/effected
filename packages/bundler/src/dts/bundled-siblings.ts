import { WorkspaceRoot } from "@effected/workspaces";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path } from "effect";
import { ConfigValidationError } from "../errors.js";
import { existsLikeNode } from "../internal/exists.js";

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

/** The workspace root above `cwd`, canonical; absent for a package outside any workspace. */
const findWorkspaceRoot = (cwd: string): Effect.Effect<string | undefined, never, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		// No workspace above `cwd` is the standalone case. Realpathing the root it found fails the build, as it did.
		const root = yield* Effect.flatMap(WorkspaceRoot, (workspaceRoot) => workspaceRoot.find(cwd)).pipe(
			Effect.provide(WorkspaceRoot.layer),
			Effect.option,
		);
		if (root._tag === "None") return undefined;
		return yield* (yield* FileSystem.FileSystem).realPath(root.value).pipe(Effect.orDie);
	});

/**
 * The directory `name` links to when that is a sibling: the first `node_modules/<name>` found from `cwd` up to the
 * root, realpathed into the root and outside any `node_modules`. A registry package and a `file:` link to another
 * checkout both fail that, and are inlined the ordinary way.
 */
const siblingDirOf = Effect.fnUntraced(function* (
	name: string,
	cwd: string,
	root: string,
): Effect.fn.Return<string | undefined, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	let dir = yield* fs.realPath(cwd);
	for (;;) {
		const link = path.join(dir, "node_modules", name);
		if (yield* existsLikeNode(link)) {
			const target = yield* fs.realPath(link);
			const segments = path.relative(root, target).split(path.sep);
			return segments[0] === ".." || segments.includes("node_modules") ? undefined : target;
		}
		if (dir === root || path.dirname(dir) === dir) return undefined;
		dir = path.dirname(dir);
	}
});

/** Reads and parses a JSON file; absent, unreadable or malformed reads as `undefined`. */
const readJson = (file: string): Effect.Effect<unknown, never, FileSystem.FileSystem> =>
	Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(file)).pipe(
		Effect.flatMap((text) => Effect.try(() => JSON.parse(text) as unknown)),
		Effect.orElseSucceed(() => undefined),
	);

/** The group a sibling's `targets.json` names canonical, by the meta pass's rule; `npm` when it has none to read. */
const canonicalGroupOf = (
	siblingDir: string,
	name: string,
	path: Path.Path,
): Effect.Effect<string, never, FileSystem.FileSystem> =>
	Effect.map(readJson(path.join(siblingDir, "dist", "prod", "targets.json")), (parsed) => {
		// A shape the old `try` read would have thrown on falls back the same way.
		try {
			const { groups } = parsed as { groups: ReadonlyArray<{ id: string; name: string }> };
			return (groups.find((group) => group.name === name) ?? groups[0])?.id ?? "npm";
		} catch {
			return "npm";
		}
	});

/** Nested subpaths of the sibling's emitted manifest, each to its absolute declaration file. */
const nestedExportsOf = (
	pkgDir: string,
	name: string,
	path: Path.Path,
): Effect.Effect<Readonly<Record<string, string>>, never, FileSystem.FileSystem> =>
	Effect.map(readJson(path.join(pkgDir, "package.json")), (parsed) => {
		const exportsMap = (parsed as { exports?: unknown } | null | undefined)?.exports;
		if (typeof exportsMap !== "object" || exportsMap === null) return {};
		const nested: Record<string, string> = {};
		for (const [key, value] of Object.entries(exportsMap)) {
			const types = (value as { types?: unknown } | null)?.types;
			if (/^\.\/[^*]*\/[^*]*$/.test(key) && typeof types === "string") {
				nested[`${name}${key.slice(1)}`] = path.join(pkgDir, types);
			}
		}
		return nested;
	});

/**
 * Finds the workspace siblings among `names` and locates each one's built declarations.
 *
 * @remarks
 * Names that are not siblings are left out, and nothing is read when `names` is empty. An entry naming a subpath
 * locates the package it belongs to.
 *
 * Fails {@link ConfigValidationError} when a sibling has no built `index.d.ts`.
 * @public
 */
export const resolveBundledSiblings: (
	cwd: string,
	names: ReadonlyArray<string>,
) => Effect.Effect<
	ReadonlyArray<BundledSibling>,
	ConfigValidationError | PlatformError.PlatformError,
	FileSystem.FileSystem | Path.Path
> = Effect.fnUntraced(function* (cwd: string, names: ReadonlyArray<string>) {
	if (names.length === 0) return [];
	const root = yield* findWorkspaceRoot(cwd);
	if (root === undefined) return [];
	const path = yield* Path.Path;
	const siblings: BundledSibling[] = [];
	for (const name of new Set(names.map(packageNameOf))) {
		const siblingDir = yield* siblingDirOf(name, cwd, root);
		if (siblingDir === undefined) continue;
		const pkgDir = path.join(siblingDir, "dist", "prod", yield* canonicalGroupOf(siblingDir, name, path), "pkg");
		if (!(yield* existsLikeNode(path.join(pkgDir, "index.d.ts")))) {
			return yield* new ConfigValidationError({
				path: "bundledPackages",
				reason: `"${name}" is a workspace sibling with no built declarations at ${path.join(pkgDir, "index.d.ts")}. Build ${name} first; a turbo build task that inlines a sibling's types needs dependsOn: ["^build"] in that package's own turbo.json.`,
			});
		}
		siblings.push({ name, pkgDir, nestedExports: yield* nestedExportsOf(pkgDir, name, path) });
	}
	return siblings;
});

/**
 * The tsconfig `paths` map resolving each sibling, and nothing else, to its built declarations.
 *
 * @public
 */
export function siblingPaths(
	siblings: ReadonlyArray<BundledSibling>,
	{ join }: Path.Path,
): Record<string, ReadonlyArray<string>> {
	const paths: Record<string, ReadonlyArray<string>> = {};
	for (const { name, pkgDir, nestedExports } of siblings) {
		paths[name] = [join(pkgDir, "index.d.ts")];
		paths[`${name}/*`] = [join(pkgDir, "*.d.ts")];
		for (const [subpath, file] of Object.entries(nestedExports)) paths[subpath] = [file];
	}
	return paths;
}
