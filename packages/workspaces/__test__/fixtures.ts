// In-memory filesystem fixtures.
//
// `FileSystem.layerNoop` and `Path.layer` both come from `effect` core, so the
// whole package tests without `@effect/platform-node`. A suite-boundary
// `layer(...)` cannot vary per test, so each distinct tree gets its own
// `layer(...)` block — that is the house shape.

import { Effect, FileSystem, Layer, Path, PlatformError } from "effect";

/** A virtual tree: absolute path → file contents. Directories are implied by their files. */
export type Tree = Readonly<Record<string, string>>;

const directoriesOf = (tree: Tree): Set<string> => {
	const dirs = new Set<string>();
	for (const file of Object.keys(tree)) {
		let dir = file.slice(0, file.lastIndexOf("/"));
		while (dir.length > 0) {
			dirs.add(dir);
			dir = dir.slice(0, dir.lastIndexOf("/"));
		}
		dirs.add("/");
	}
	return dirs;
};

/** Knobs for making a fixture tree misbehave in specific, realistic ways. */
export interface FileSystemOptions {
	/**
	 * Directories whose `readDirectory` fails with `PermissionDenied` — the case
	 * a "treat every failure as an empty directory" enumerator silently loses.
	 */
	readonly unreadable?: ReadonlySet<string>;
	/**
	 * Files that EXIST but whose `readFileString` fails with `PermissionDenied` —
	 * the case a `orElseSucceed(() => "")` fallback makes indistinguishable from
	 * an empty file.
	 */
	readonly unreadableFiles?: ReadonlySet<string>;
}

/**
 * A `FileSystem` over a virtual tree, implementing exactly the four operations
 * this package uses: `exists`, `readFileString`, `readDirectory`, `stat`.
 */
export const fileSystem = (tree: Tree, options: FileSystemOptions = {}): Layer.Layer<FileSystem.FileSystem> => {
	const dirs = directoriesOf(tree);
	const unreadable = options.unreadable ?? new Set<string>();
	const unreadableFiles = options.unreadableFiles ?? new Set<string>();

	// The v4 constructor is `PlatformError.systemError`, not a `new SystemError` —
	// `SystemError` is the reason payload, `PlatformError` is the failure.
	const notFound = (path: string) =>
		Effect.fail(
			PlatformError.systemError({
				_tag: "NotFound",
				module: "FileSystem",
				method: "stat",
				pathOrDescriptor: path,
			}),
		);

	return FileSystem.layerNoop({
		exists: (path: string) => Effect.succeed(Object.hasOwn(tree, path) || dirs.has(path)),

		readFileString: (path: string) => {
			if (unreadableFiles.has(path)) {
				return Effect.fail(
					PlatformError.systemError({
						_tag: "PermissionDenied",
						module: "FileSystem",
						method: "readFileString",
						pathOrDescriptor: path,
					}),
				);
			}
			return Object.hasOwn(tree, path) ? Effect.succeed(tree[path]) : notFound(path);
		},

		readDirectory: (path: string) => {
			if (unreadable.has(path)) {
				return Effect.fail(
					PlatformError.systemError({
						_tag: "PermissionDenied",
						module: "FileSystem",
						method: "readDirectory",
						pathOrDescriptor: path,
					}),
				);
			}
			if (!dirs.has(path)) return notFound(path);
			const prefix = path === "/" ? "/" : `${path}/`;
			const entries = new Set<string>();
			for (const candidate of [...Object.keys(tree), ...dirs]) {
				if (!candidate.startsWith(prefix) || candidate === path) continue;
				const rest = candidate.slice(prefix.length);
				const head = rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : rest;
				if (head.length > 0) entries.add(head);
			}
			return Effect.succeed([...entries].sort());
		},

		stat: (path: string) => {
			if (dirs.has(path)) return Effect.succeed({ type: "Directory" } as FileSystem.File.Info);
			if (Object.hasOwn(tree, path)) return Effect.succeed({ type: "File" } as FileSystem.File.Info);
			return notFound(path);
		},
	});
};

/** A `FileSystem` + `Path` layer over a virtual tree — the platform half of every suite. */
export const platform = (tree: Tree, options: FileSystemOptions = {}): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	Layer.mergeAll(fileSystem(tree, options), Path.layer);

/** A root `package.json` declaring npm-style workspaces. */
export const rootManifest = (patterns: ReadonlyArray<string>, extra: Record<string, unknown> = {}): string =>
	JSON.stringify({ name: "root", version: "0.0.0", private: true, workspaces: patterns, ...extra });

/** A member `package.json`. */
export const manifest = (name: string, fields: Record<string, unknown> = {}): string =>
	JSON.stringify({ name, version: "1.0.0", ...fields });
