import { Effect, FileSystem, Layer } from "effect";

/**
 * An in-memory `FileSystem` seeded with `files`; anything else is ENOENT.
 *
 * Read-only: it implements exactly the operations the read path exercises, so a
 * test that unexpectedly writes fails loudly rather than silently succeeding.
 */
export const memoryFs = (files: Record<string, string>): Layer.Layer<FileSystem.FileSystem> =>
	Layer.succeed(FileSystem.FileSystem, {
		exists: (p: string) => Effect.succeed(Object.hasOwn(files, p)),
		readFileString: (p: string) =>
			Object.hasOwn(files, p) ? Effect.succeed(files[p] as string) : Effect.fail(new Error(`ENOENT: ${p}`)),
	} as unknown as FileSystem.FileSystem);

/** The shape {@link recordingFs} and {@link hostileFs} both return. */
export interface RecordingFs {
	readonly layer: Layer.Layer<FileSystem.FileSystem>;
	readonly files: Record<string, string>;
	readonly mkdirs: Array<string>;
}

/** Records every write and every mkdir so the tests can assert on them. */
export const recordingFs = (files: Record<string, string>): RecordingFs => {
	const mkdirs: Array<string> = [];
	const fs = {
		exists: (p: string) => Effect.succeed(Object.hasOwn(files, p)),
		readFileString: (p: string) =>
			Object.hasOwn(files, p) ? Effect.succeed(files[p] as string) : Effect.fail(new Error(`ENOENT: ${p}`)),
		writeFileString: (p: string, content: string) =>
			Effect.sync(() => {
				files[p] = content;
			}),
		makeDirectory: (p: string) =>
			Effect.sync(() => {
				mkdirs.push(p);
			}),
	} as unknown as FileSystem.FileSystem;
	return { layer: Layer.succeed(FileSystem.FileSystem, fs), files, mkdirs };
};

/**
 * A host whose every write is rejected. `makeDirectory` is absent on purpose:
 * if `write` ever started creating directories, this would throw rather than
 * quietly pass.
 */
export const hostileFs = (): RecordingFs => {
	const fs = {
		exists: () => Effect.succeed(false),
		writeFileString: () => Effect.fail(new Error("EROFS")),
	} as unknown as FileSystem.FileSystem;
	return { layer: Layer.succeed(FileSystem.FileSystem, fs), files: {}, mkdirs: [] };
};
