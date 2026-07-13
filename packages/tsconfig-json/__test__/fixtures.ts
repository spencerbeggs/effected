import { Effect, FileSystem, Layer, Path, PlatformError } from "effect";

/**
 * An in-memory fixture filesystem for the resolution suites. The map is
 * absolute file path -> file contents; a "directory" exists only implicitly,
 * as the parent of a file key, so a bare directory path is never present. That
 * matches the resolution engine's file-existence contract (config *files* are
 * probed, never directories).
 *
 * `exists` is map membership; `readFileString` returns the contents or fails
 * with a `NotFound` `PlatformError` whose constructor is copied verbatim from
 * the core `FileSystem.makeNoop` example (`FileSystem.ts`), so a not-found flows
 * through the typed platform channel exactly as a real filesystem would. Task 8
 * and Task 9 reuse this builder.
 */
export const fixtureFs = (tree: ReadonlyMap<string, string>): Layer.Layer<FileSystem.FileSystem> =>
	FileSystem.layerNoop({
		exists: (path: string) => Effect.succeed(tree.has(path)),
		readFileString: (path: string) => {
			const hit = tree.get(path);
			return hit === undefined
				? Effect.fail(
						PlatformError.systemError({
							_tag: "NotFound",
							module: "FileSystem",
							method: "readFileString",
							description: "File not found",
							pathOrDescriptor: path,
						}),
					)
				: Effect.succeed(hit);
		},
	});

/** The fixture filesystem merged with a POSIX `Path`, the layer every resolution suite provides. */
export const fixtureLayer = (tree: ReadonlyMap<string, string>): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	Layer.mergeAll(fixtureFs(tree), Path.layer);
