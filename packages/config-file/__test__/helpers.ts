import type { MemoryFileSystemSeed, MemoryFileSystemVolume } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { FileSystem, Layer } from "effect";
import { Effect, PlatformError } from "effect";

/**
 * A memfs volume the write-path tests can inspect after the program has run,
 * plus the directories `makeDirectory` was asked to create.
 */
export interface RecordingFs {
	readonly layer: Layer.Layer<FileSystem.FileSystem>;
	readonly volume: MemoryFileSystemVolume;
	readonly mkdirs: ReadonlyArray<string>;
}

/**
 * A pinned memfs volume seeded with `seed`. `makeDirectory` carries a memfs
 * spy, which always delegates, so `mkdirs` records every requested directory
 * while the directory really is created. The spy runs when the call EXECUTES,
 * never when it is built.
 */
export const recordingFs = (seed: MemoryFileSystemSeed = {}): RecordingFs => {
	const mkdirs: Array<string> = [];
	const handle = MemoryFileSystem.makeSync(seed, {
		spies: { makeDirectory: (path) => void mkdirs.push(path) },
	});
	return { layer: handle.layer, volume: handle.volume, mkdirs };
};

/**
 * A read-only host: every write fails with the typed `PlatformError` a node
 * adapter raises for `EROFS` (node maps that errno to the `Unknown` tag). A
 * `makeDirectory` call is a DEFECT — if `write` ever started creating
 * directories, the test dies rather than quietly passing.
 */
export const hostileFs = (): RecordingFs => {
	const readOnly = (method: string, path: string) =>
		Effect.fail(
			PlatformError.systemError({
				_tag: "Unknown",
				module: "FileSystem",
				method,
				syscall: "open",
				pathOrDescriptor: path,
				description: "EROFS: read-only file system",
			}),
		);
	const handle = MemoryFileSystem.makeSync(
		{},
		{
			faults: {
				writeFile: (path) =>
					Effect.fail(
						PlatformError.systemError({
							_tag: "Unknown",
							module: "FileSystem",
							method: "writeFile",
							syscall: "open",
							pathOrDescriptor: path,
							description: "EROFS: read-only file system",
						}),
					),
				// The atomic write goes through a temp file beside the target, so `open` is where a read-only host refuses.
				open: (path) => readOnly("open", path),
				rename: (from) => readOnly("rename", from),
				makeDirectory: MemoryFileSystem.die(new Error("hostileFs: makeDirectory must never be called")),
			},
		},
	);
	return { layer: handle.layer, volume: handle.volume, mkdirs: [] };
};
