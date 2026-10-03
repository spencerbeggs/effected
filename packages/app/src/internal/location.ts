import type { AppDirKind } from "@effected/xdg";
import { AppDirs, AppDirsError } from "@effected/xdg";
import { Effect, FileSystem, Path } from "effect";

/** The app directories a database file may live in. */
export type DatabaseDirectory = Extract<AppDirKind, "state" | "data" | "cache">;

/**
 * Ensure `<kind dir>[/<subdir>]` exists and return it — the ensure-before-open
 * half of every database layer here. The subdirectory's `mkdir -p` reports on
 * the same typed `AppDirsError` channel as `ensure*`, tagged with the directory
 * kind it sits under, so a failure stays a value and never a defect.
 */
export const ensureLocation = (
	kind: DatabaseDirectory,
	subdir: string | undefined,
): Effect.Effect<string, AppDirsError, AppDirs | Path.Path | FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const appDirs = yield* AppDirs;
		const base = yield* kind === "state"
			? appDirs.ensureState
			: kind === "data"
				? appDirs.ensureData
				: appDirs.ensureCache;
		if (subdir === undefined) return base;

		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const target = path.join(base, ...subdir.split("/"));
		yield* fs
			.makeDirectory(target, { recursive: true })
			.pipe(Effect.mapError((cause) => new AppDirsError({ directory: kind, path: target, cause })));
		return target;
	});
