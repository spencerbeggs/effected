// The facade over the vendored engine (see internal/volume.ts for the port
// header and the adaptation ledger pointer).

import type { PlatformError } from "effect";
import { Effect, FileSystem, Layer } from "effect";
import * as internal from "./internal/volume.js";

/**
 * A volume seed: absolute POSIX paths mapped to file contents.
 *
 * @remarks
 * String values are UTF-8 encoded; `Uint8Array` values are written verbatim.
 * Parent directories are created recursively before each file is written, so a
 * seed never has to list directories — and cannot express an *empty* one; call
 * `makeDirectory` on the built filesystem for that.
 *
 * @public
 */
export interface MemoryFileSystemSeed {
	readonly [path: string]: string | Uint8Array;
}

const encoder = new TextEncoder();

const seedVolume = (
	fs: FileSystem.FileSystem,
	seed: MemoryFileSystemSeed,
): Effect.Effect<void, PlatformError.PlatformError> =>
	Effect.gen(function* () {
		for (const [path, content] of Object.entries(seed)) {
			const separator = path.lastIndexOf("/");
			const parent = separator <= 0 ? "/" : path.slice(0, separator);
			if (parent !== "/") {
				yield* fs.makeDirectory(parent, { recursive: true });
			}
			yield* fs.writeFile(path, typeof content === "string" ? encoder.encode(content) : content);
		}
	});

/**
 * An in-memory implementation of core Effect's `FileSystem` service: an
 * isolated virtual POSIX volume — files, directories, symlinks, hard links,
 * open descriptors, temporary resources, globbing, watching — behind the
 * standard `FileSystem.FileSystem` key.
 *
 * @remarks
 * The founding contract is **honest absence**: reading, statting, or opening
 * (without a create flag) a path nothing seeded fails typed with a `NotFound`
 * `SystemError` — the volume never fabricates content for a path nothing
 * arranged.
 *
 * Behavioral notes shared by every constructor:
 *
 * - Each built filesystem is one isolated volume; separately built layers
 *   share nothing. Reusing one layer *value* shares one volume through layer
 *   memoization — use `Layer.fresh` (or build another layer) when each
 *   consumer needs its own volume.
 * - Relative paths resolve from the virtual root `/`: the `FileSystem`
 *   contract has no working-directory operation.
 * - `access` checks existence only; its `readable`/`writable`/`ok` options are
 *   deliberately ignored, because the volume models no process identity and
 *   permission bits are metadata.
 * - Malformed input fails through the typed `PlatformError` channel, never as
 *   a defect; pathological directory or brace-nesting depth fails typed at the
 *   engine's nesting bound.
 *
 * @example
 * ```ts
 * import { MemoryFileSystem } from "@effected/memfs";
 * import { Effect, FileSystem } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const fs = yield* FileSystem.FileSystem;
 *   return yield* fs.readFileString("/repo/package.json");
 * });
 *
 * const SeededFs = MemoryFileSystem.layerWith({
 *   "/repo/package.json": `{ "name": "fixture" }`,
 * });
 *
 * program.pipe(Effect.provide(SeededFs));
 * ```
 *
 * @public
 */
export class MemoryFileSystem {
	/**
	 * Builds a `FileSystem` service backed by a fresh, empty in-memory volume.
	 */
	static readonly make: Effect.Effect<FileSystem.FileSystem> = internal.make;

	/**
	 * Builds a `FileSystem` service backed by a fresh volume pre-populated from
	 * `seed`.
	 *
	 * @remarks
	 * Fails typed when the seed contradicts itself — for example a file seeded
	 * at a path another entry needs as a directory. Everything absent from the
	 * seed stays absent: reads of unseeded paths fail `NotFound`.
	 *
	 * @param seed - Absolute POSIX paths mapped to file contents.
	 */
	static readonly makeWith = (
		seed: MemoryFileSystemSeed,
	): Effect.Effect<FileSystem.FileSystem, PlatformError.PlatformError> =>
		Effect.gen(function* () {
			const fs = yield* internal.make;
			yield* seedVolume(fs, seed);
			return fs;
		});

	/**
	 * Provides `FileSystem.FileSystem` backed by a fresh, empty volume.
	 *
	 * @remarks
	 * One layer value builds one volume; wrap in `Layer.fresh` for per-consumer
	 * isolation.
	 */
	static readonly layer: Layer.Layer<FileSystem.FileSystem> = internal.layer;

	/**
	 * Provides `FileSystem.FileSystem` backed by a fresh volume pre-populated
	 * from `seed`.
	 *
	 * @remarks
	 * A parameterized layer factory mints a fresh reference per call, and layers
	 * memoize by reference — bind the result to a `const` and reuse it rather
	 * than calling `layerWith(...)` at each composition site. A contradictory
	 * seed is a test-wiring bug and **dies** with the underlying typed error as
	 * its cause; use {@link MemoryFileSystem.makeWith} to handle seeding
	 * failures in the error channel instead.
	 *
	 * @param seed - Absolute POSIX paths mapped to file contents.
	 */
	static readonly layerWith = (seed: MemoryFileSystemSeed): Layer.Layer<FileSystem.FileSystem> =>
		Layer.effect(FileSystem.FileSystem, Effect.orDie(MemoryFileSystem.makeWith(seed)));

	private constructor() {}
}
