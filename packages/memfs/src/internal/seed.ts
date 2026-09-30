// KIT EXTENSION (seeding). The seed applier and the `root` option, kept out of
// the facade so every seeded constructor shares one path.
import type { FileSystem } from "effect";
import { Effect, Result } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { badArgument } from "effect/PlatformError";
import type { MemoryFileSystemOptions, MemoryFileSystemSeed, MemoryFileSystemSeedEntry } from "../MemoryFileSystem.js";

const encoder = new TextEncoder();

export const seedVolume = (fs: FileSystem.FileSystem, seed: MemoryFileSystemSeed): Effect.Effect<void, PlatformError> =>
	Effect.gen(function* () {
		for (const [path, entry] of Object.entries(seed)) {
			const separator = path.lastIndexOf("/");
			const parent = separator <= 0 ? "/" : path.slice(0, separator);
			if (parent !== "/") {
				yield* fs.makeDirectory(parent, { recursive: true });
			}
			if (typeof entry === "string" || entry instanceof Uint8Array) {
				yield* fs.writeFile(path, typeof entry === "string" ? encoder.encode(entry) : entry);
				continue;
			}
			switch (entry._tag) {
				case "MemoryFileSystemSeedFile": {
					const data = typeof entry.content === "string" ? encoder.encode(entry.content) : entry.content;
					yield* fs.writeFile(path, data, entry.mode !== undefined ? { mode: entry.mode } : undefined);
					// Applied after the write, which stamps the volume's clock. Both
					// times are set together because `utimes` takes the pair; a seed
					// that pins mtime without pinning atime would leave the two
					// disagreeing for no stated reason.
					//
					// A `Date`, NOT the bare number: `utimes` reads a numeric
					// argument as Unix SECONDS (as `fs.utimesSync` does), while this
					// option is epoch milliseconds — passing it through unconverted
					// silently multiplies every seeded time by 1000.
					if (entry.mtime !== undefined) {
						const stamp = new Date(entry.mtime);
						yield* fs.utimes(path, stamp, stamp);
					}
					break;
				}
				case "MemoryFileSystemSeedDirectory": {
					yield* fs.makeDirectory(path, { recursive: true });
					// Applied via chmod rather than makeDirectory's mode option so the
					// mode also lands when the directory already exists — e.g. created
					// implicitly as an earlier entry's parent.
					if (entry.mode !== undefined) {
						yield* fs.chmod(path, entry.mode);
					}
					break;
				}
				case "MemoryFileSystemSeedSymlink": {
					yield* fs.symlink(entry.target, path);
					break;
				}
			}
		}
	});

const normalizeAbsolute = (path: string): string => {
	const segments: Array<string> = [];
	for (const segment of path.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return `/${segments.join("/")}`;
};

/** Re-keys a seed under `root`; the error is a description of what was wrong. */
export const applyRoot = (
	seed: MemoryFileSystemSeed,
	root: string | undefined,
): Result.Result<{ readonly seed: MemoryFileSystemSeed; readonly root: string | undefined }, string> => {
	if (root === undefined) return Result.succeed({ seed, root: undefined });
	if (!root.startsWith("/")) return Result.fail(`root must be absolute, got "${root}"`);
	const base = normalizeAbsolute(root);
	const rooted: Record<string, MemoryFileSystemSeedEntry> = {};
	for (const [key, entry] of Object.entries(seed)) {
		if (key.startsWith("/")) return Result.fail(`seed key "${key}" is absolute but a root "${root}" was given`);
		rooted[key === "" ? base : normalizeAbsolute(`${base}/${key}`)] = entry;
	}
	return Result.succeed({ seed: rooted, root: base });
};

/** Applies the root, creates it, then seeds. A root error is a typed `BadArgument`. */
export const seedWith = (
	fs: FileSystem.FileSystem,
	seed: MemoryFileSystemSeed,
	options: MemoryFileSystemOptions | undefined,
): Effect.Effect<void, PlatformError> =>
	Effect.gen(function* () {
		const applied = applyRoot(seed, options?.root);
		if (Result.isFailure(applied)) {
			return yield* Effect.fail(badArgument({ module: "FileSystem", method: "seed", description: applied.failure }));
		}
		if (applied.success.root !== undefined) {
			yield* fs.makeDirectory(applied.success.root, { recursive: true });
		}
		yield* seedVolume(fs, applied.success.seed);
	});
