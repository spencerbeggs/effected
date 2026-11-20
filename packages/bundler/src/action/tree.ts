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

/** Every file under `directory`, relative to `base`. */
export const walk = (
	directory: string,
	base: string,
): Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		if (!(yield* fs.exists(directory))) return [];
		const files: Array<string> = [];
		for (const name of yield* fs.readDirectory(directory)) {
			const full = path.join(directory, name);
			if ((yield* fs.stat(full)).type === "Directory") files.push(...(yield* walk(full, base)));
			else files.push(path.relative(base, full));
		}
		return files;
	});

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

/** Makes `to` match `from`: copies what is new or changed, and removes what `from` no longer has. */
export const syncDirectory = Effect.fnUntraced(function* (from: string, to: string) {
	const path = yield* Path.Path;
	const sourceFiles = yield* walk(from, from);
	let copied = 0;
	let skipped = 0;
	for (const file of sourceFiles) {
		if (yield* syncFile(path.join(from, file), path.join(to, file))) copied++;
		else skipped++;
	}
	const sources = new Set(sourceFiles);
	for (const file of yield* walk(to, to)) {
		if (!sources.has(file)) yield* removeStale(path.join(to, file), to);
	}
	return { copied, skipped };
});
