// The one source-tree walker behind SourceBoundary.scan and the ImportGraph
// checks, so they cannot drift on symlink loops, node_modules, dangling
// links, declaration files or what counts as a source file at all.

import { Effect, FileSystem, Option, Path } from "effect";

/** The file extensions a walk reads when the caller names none. */
export const DEFAULT_EXTENSIONS: ReadonlyArray<string> = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

/** Declaration files: always skipped, whatever extensions the caller names. */
export const DECLARATION = /\.d\.[cm]?ts$/;

/** One source file a walk found. */
export interface SourceFile {
	/** The path relative to the walk root, with `/` separators whatever the platform's. */
	readonly file: string;
	/** The path the walk reached the file at, in the platform's separator. */
	readonly path: string;
}

/** Options for {@link walkSources}. */
export interface WalkOptions {
	/** The directory to walk. */
	readonly root: string;
	/** File extensions to keep; declaration files are always skipped. */
	readonly extensions: ReadonlyArray<string>;
}

/**
 * Every source file under `root`, in walk order.
 *
 * @remarks
 * Walks with an explicit stack, visiting each real directory once (via
 * `realPath`), so a symlink loop terminates and a linked directory is not
 * read twice. `node_modules` is never entered. A missing root fails; it never
 * walks nothing. A dangling symlink under the root is skipped, having nothing
 * to read; any other entry that cannot be read fails the walk.
 */
export const walkSources = Effect.fn("walkSources")(function* (options: WalkOptions) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const posix = (relative: string): string => relative.split(path.sep).join("/");
	const found: Array<SourceFile> = [];
	const visited = new Set<string>();
	const pending: Array<string> = [options.root];
	while (pending.length > 0) {
		const directory = pending.pop();
		if (directory === undefined) break;
		const real = yield* fs.realPath(directory);
		if (visited.has(real)) continue;
		visited.add(real);
		for (const name of yield* fs.readDirectory(directory)) {
			const full = path.join(directory, name);
			// stat follows links, so a dangling one fails NotFound; it has nothing to
			// read, so skip it. A NotFound on an entry that is not a link still fails:
			// nothing may drop out of the walk silently.
			const entry = yield* fs.stat(full).pipe(
				Effect.map(Option.some),
				Effect.catch((error) =>
					error.reason._tag === "NotFound"
						? fs.readLink(full).pipe(
								Effect.as(Option.none<FileSystem.File.Info>()),
								Effect.mapError(() => error),
							)
						: Effect.fail(error),
				),
			);
			if (Option.isNone(entry)) continue;
			const info = entry.value;
			if (info.type === "Directory") {
				if (name !== "node_modules") pending.push(full);
				continue;
			}
			if (
				info.type !== "File" ||
				DECLARATION.test(name) ||
				!options.extensions.some((extension) => name.endsWith(extension))
			) {
				continue;
			}
			found.push({ file: posix(path.relative(options.root, full)), path: full });
		}
	}
	return found;
});
