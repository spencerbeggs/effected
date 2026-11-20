import type { PlatformError } from "effect";
import { Effect, FileSystem, Path } from "effect";

export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((byte, index) => byte === b[index]);

/** Copies `from` over `to` unless they already match, and says whether it copied. */
export const syncFile = Effect.fnUntraced(function* (from: string, to: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	if ((yield* fs.exists(to)) && sameBytes(yield* fs.readFile(from), yield* fs.readFile(to))) return false;
	yield* fs.makeDirectory(path.dirname(to), { recursive: true });
	yield* fs.copyFile(from, to);
	return true;
});

/** An entry {@link walkEntries} found, relative to its base. A symlink is a leaf, whatever it points at. */
interface TreeEntry {
	readonly path: string;
	readonly symlink: boolean;
}

/** Every file and symlink under `directory`, relative to `base`. Links are never followed, so the walk stays inside. */
const walkEntries = (
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

/** Removes a file and each parent up to `root` that it leaves empty. */
const removeStale = Effect.fnUntraced(function* (file: string, root: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	yield* fs.remove(file, { force: true });
	let parent = path.dirname(file);
	while (parent !== root && (yield* fs.exists(parent)) && (yield* fs.readDirectory(parent)).length === 0) {
		yield* fs.remove(parent, { recursive: true });
		parent = path.dirname(parent);
	}
});

/**
 * Makes `to` match `from`: copies what is new or changed, and removes what `from` no longer has.
 *
 * A symlink under `to`, or `to` itself as one, is removed as a link before anything is copied, so neither a write nor
 * a removal reaches whatever it points at.
 */
export const syncDirectory = Effect.fnUntraced(function* (from: string, to: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const linked = yield* fs.lstat(to).pipe(
		Effect.map((info) => info.type === "SymbolicLink"),
		Effect.catchTag("PlatformError", (error) =>
			error.reason._tag === "NotFound" ? Effect.succeed(false) : Effect.fail(error),
		),
	);
	if (linked) yield* fs.remove(to);
	const sourceFiles = yield* walk(from, from);
	const sources = new Set(sourceFiles);
	for (const entry of yield* walkEntries(to, to)) {
		if (entry.symlink || !sources.has(entry.path)) yield* removeStale(path.join(to, entry.path), to);
	}
	let copied = 0;
	let skipped = 0;
	for (const file of sourceFiles) {
		if (yield* syncFile(path.join(from, file), path.join(to, file))) copied++;
		else skipped++;
	}
	return { copied, skipped };
});
