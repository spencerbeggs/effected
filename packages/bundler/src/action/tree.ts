import type { PlatformError } from "effect";
import { Effect, FileSystem, Path } from "effect";

export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((byte, index) => byte === b[index]);

/** An entry {@link walkEntries} found, relative to its base. A symlink is a leaf, whatever it points at. */
export interface TreeEntry {
	readonly path: string;
	readonly symlink: boolean;
}

/** Every file and symlink under `directory`, relative to `base`. Links are never followed, so the walk stays inside. */
export const walkEntries = (
	directory: string,
	base: string,
): Effect.Effect<ReadonlyArray<TreeEntry>, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		if (!(yield* fs.exists(directory))) return [];
		const entries: Array<TreeEntry> = [];
		for (const name of yield* fs.readDirectory(directory)) {
			const full = path.join(directory, name);
			const { type } = yield* fs.lstat(full);
			if (type === "Directory") entries.push(...(yield* walkEntries(full, base)));
			else entries.push({ path: path.relative(base, full), symlink: type === "SymbolicLink" });
		}
		return entries;
	});

/** Every file under `directory`, relative to `base`. A symlink counts as one file and is never followed. */
export const walk = (
	directory: string,
	base: string,
): Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.map(walkEntries(directory, base), (entries) => entries.map((entry) => entry.path));
