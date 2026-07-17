// In-memory filesystem fixtures for the descend suite.
//
// `FileSystem.layerNoop` and `Path.layer` both come from `effect` core, so the
// whole package tests without `@effect/platform-node`. A suite-boundary
// `layer(...)` cannot vary per test, so each distinct tree gets its own
// `layer(...)` block — that is the house shape.
//
// Faithful to the node backend where it matters to `descend`: `stat` FOLLOWS
// symlinks (a link to a file stats as a File, a dangling link fails NotFound),
// and `readLink` succeeds only on links — it is the walker's "is this a
// symlink" probe. `layerNoop`'s default `readLink` fails, so only the symlink
// entries here override it.

import { Effect, FileSystem, Layer, Path, PlatformError } from "effect";

/** A virtual tree: absolute path → file contents. Directories are implied by their files. */
export type Tree = Readonly<Record<string, string>>;

/** Knobs for making a fixture tree misbehave in specific, realistic ways. */
export interface FileSystemOptions {
	/** Directories whose `readDirectory` fails with `PermissionDenied` — the unreadable-subtree case. */
	readonly unreadable?: ReadonlySet<string>;
	/**
	 * Symlinks: link path → absolute target. The link appears in its parent's
	 * listing; `stat` resolves through it (a missing target is a dangling link
	 * and stats NotFound); `readLink` succeeds on it and nothing else.
	 */
	readonly symlinks?: Readonly<Record<string, string>>;
	/**
	 * Directories that vanish between their parent's listing and their own
	 * read: they appear in listings and `stat` as directories, but
	 * `readDirectory` fails NotFound — the benign-race case.
	 */
	readonly vanished?: ReadonlySet<string>;
}

const ancestorsInto = (dirs: Set<string>, leaf: string): void => {
	let dir = leaf.slice(0, leaf.lastIndexOf("/"));
	while (dir.length > 0) {
		dirs.add(dir);
		dir = dir.slice(0, dir.lastIndexOf("/"));
	}
	dirs.add("/");
};

const directoriesOf = (tree: Tree, symlinks: Readonly<Record<string, string>>, vanished: ReadonlySet<string>) => {
	const dirs = new Set<string>();
	for (const file of Object.keys(tree)) ancestorsInto(dirs, file);
	for (const link of Object.keys(symlinks)) ancestorsInto(dirs, link);
	for (const gone of vanished) {
		dirs.add(gone);
		ancestorsInto(dirs, gone);
	}
	return dirs;
};

/**
 * A `FileSystem` over a virtual tree, implementing exactly the three
 * operations `descend` uses: `stat`, `readDirectory`, `readLink`.
 */
export const fileSystem = (tree: Tree, options: FileSystemOptions = {}): Layer.Layer<FileSystem.FileSystem> => {
	const unreadable = options.unreadable ?? new Set<string>();
	const symlinks = options.symlinks ?? {};
	const vanished = options.vanished ?? new Set<string>();
	const dirs = directoriesOf(tree, symlinks, vanished);

	// The v4 constructor is `PlatformError.systemError`, not a `new SystemError` —
	// `SystemError` is the reason payload, `PlatformError` is the failure.
	const notFound = (method: "stat" | "readDirectory" | "readLink", path: string) =>
		Effect.fail(
			PlatformError.systemError({
				_tag: "NotFound",
				module: "FileSystem",
				method,
				pathOrDescriptor: path,
			}),
		);

	/** Resolve one symlink hop, node-`stat` style. */
	const resolved = (path: string): string => symlinks[path] ?? path;

	return FileSystem.layerNoop({
		stat: (path: string) => {
			const target = resolved(path);
			if (dirs.has(target)) return Effect.succeed({ type: "Directory" } as FileSystem.File.Info);
			if (Object.hasOwn(tree, target)) return Effect.succeed({ type: "File" } as FileSystem.File.Info);
			return notFound("stat", path);
		},

		readLink: (path: string) =>
			Object.hasOwn(symlinks, path) ? Effect.succeed(symlinks[path] as string) : notFound("readLink", path),

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
			if (vanished.has(path) || !dirs.has(path)) return notFound("readDirectory", path);
			const prefix = path === "/" ? "/" : `${path}/`;
			const entries = new Set<string>();
			for (const candidate of [...Object.keys(tree), ...Object.keys(symlinks), ...dirs]) {
				if (!candidate.startsWith(prefix) || candidate === path) continue;
				const rest = candidate.slice(prefix.length);
				const head = rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : rest;
				if (head.length > 0) entries.add(head);
			}
			return Effect.succeed([...entries].sort());
		},
	});
};

/** A `FileSystem` + `Path` layer over a virtual tree — the platform half of every suite. */
export const platform = (tree: Tree, options: FileSystemOptions = {}): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	Layer.mergeAll(fileSystem(tree, options), Path.layer);
