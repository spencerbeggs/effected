import type { AppDirKind } from "@effected/xdg";
import { AppDirs, AppDirsError } from "@effected/xdg";
import { Effect, FileSystem, Path } from "effect";
import { badFilename, badSubdir } from "./filename.js";

/** The app directories a database file may live in. */
export type DatabaseDirectory = Extract<AppDirKind, "state" | "data" | "cache">;

/** Where a database file goes: resolved, nothing created. */
export interface Location {
	readonly kind: DatabaseDirectory;
	/** The directory holding the file: the kind's directory, or the subdir under it. */
	readonly dir: string;
	/** The absolute file path. */
	readonly file: string;
	/** Whether `dir` is a subdirectory that needs its own `mkdir -p`. */
	readonly nested: boolean;
}

/**
 * Resolve a database file's location from the ambient `AppDirs`, guarding the
 * path options, and creating NOTHING. The single derivation behind both the
 * `location` statics and the layers, so a reported path and an opened path
 * cannot disagree. A bad `filename` or `subdir` dies, naming `context`.
 */
export const resolveLocation = (
	context: string,
	kind: DatabaseDirectory,
	subdir: string | undefined,
	filename: string,
): Effect.Effect<Location, never, AppDirs | Path.Path> =>
	Effect.gen(function* () {
		const invalid = badFilename(context, filename) ?? (subdir === undefined ? undefined : badSubdir(context, subdir));
		if (invalid !== undefined) return yield* Effect.die(invalid);

		const appDirs = yield* AppDirs;
		const path = yield* Path.Path;
		const base = appDirs.dirs[kind];
		const dir = subdir === undefined ? base : path.join(base, ...subdir.split("/"));
		return { kind, dir, file: path.join(dir, filename), nested: subdir !== undefined };
	});

/**
 * Create a resolved location's directory — the ensure-before-open half of every
 * database layer here. The kind's own `ensure*` runs first; a subdirectory's
 * `mkdir -p` then reports on the same typed `AppDirsError` channel, tagged with
 * the directory kind it sits under, so a failure stays a value, never a defect.
 */
export const ensureLocation = (
	location: Location,
): Effect.Effect<void, AppDirsError, AppDirs | FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const appDirs = yield* AppDirs;
		yield* location.kind === "state"
			? appDirs.ensureState
			: location.kind === "data"
				? appDirs.ensureData
				: appDirs.ensureCache;
		if (!location.nested) return;

		const fs = yield* FileSystem.FileSystem;
		yield* fs
			.makeDirectory(location.dir, { recursive: true })
			.pipe(Effect.mapError((cause) => new AppDirsError({ directory: location.kind, path: location.dir, cause })));
	});
