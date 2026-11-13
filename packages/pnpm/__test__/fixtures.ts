// Shared test fixtures: a memfs-backed platform over a virtual tree, with
// fault handlers for the two realistic failures `PnpmSettings.load` must
// surface typed rather than read as absence.

import { MemoryFileSystem } from "@effected/memfs";
import type { FileSystem } from "effect";
import { Effect, Layer, Path, PlatformError } from "effect";

/** A virtual tree: absolute path → file contents. Directories are implied by their files. */
export type Tree = Readonly<Record<string, string>>;

/** Knobs for making a fixture tree misbehave. */
export interface FileSystemOptions {
	/** Files that EXIST but whose `readFileString` fails with `PermissionDenied`. */
	readonly unreadableFiles?: ReadonlySet<string>;
	/** Paths whose `exists` probe fails with `PermissionDenied` rather than answering. */
	readonly unreadableExists?: ReadonlySet<string>;
}

const denied = (method: string, path: string) =>
	Effect.fail(
		PlatformError.systemError({
			_tag: "PermissionDenied",
			module: "FileSystem",
			method,
			pathOrDescriptor: path,
		}),
	);

/**
 * A `FileSystem` + `Path` layer over a virtual tree. Each fault handler
 * declines (`undefined`) for every path it does not name, delegating to the
 * volume, so only the named misbehaviour is simulated.
 */
export const platform = (
	tree: Tree,
	options: FileSystemOptions = {},
): Layer.Layer<FileSystem.FileSystem | Path.Path> => {
	const unreadableFiles = options.unreadableFiles ?? new Set<string>();
	const unreadableExists = options.unreadableExists ?? new Set<string>();
	return Layer.mergeAll(
		MemoryFileSystem.layerWith(tree, {
			faults: {
				exists: (path: string) => (unreadableExists.has(path) ? denied("access", path) : undefined),
				readFileString: (path: string) => (unreadableFiles.has(path) ? denied("readFileString", path) : undefined),
			},
		}),
		Path.layer,
	);
};

/** A member `package.json`. */
export const manifest = (name: string, fields: Record<string, unknown> = {}): string =>
	JSON.stringify({ name, version: "1.0.0", ...fields });
