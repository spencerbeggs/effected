// Atomic replacement of one file: write a temp file beside the target, sync it,
// then rename it into place, so a reader or a crash sees the old content or the
// new content and never a truncated file. FileSystem and Path arrive through R;
// this package owns no filesystem backend.

import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Random, Result } from "effect";

/** How many links a dangling chain may hop through before the write gives up. */
const MAX_LINK_HOPS = 40;

/**
 * The path the rename must land on: the file behind any symlinks, so the link
 * survives. `realPath` cannot resolve a dangling link, so that case is walked
 * by hand with `readLink`.
 */
const resolveFinalPath = (fs: FileSystem.FileSystem, path: Path.Path, target: string) =>
	Effect.gen(function* () {
		let current = target;
		for (let hops = 0; ; hops++) {
			const real = yield* Effect.result(fs.realPath(current));
			if (Result.isSuccess(real)) return real.success;
			if (real.failure.reason._tag !== "NotFound") return yield* Effect.fail(real.failure);

			const link = yield* Effect.result(fs.readLink(current));
			if (Result.isFailure(link)) return current;
			if (hops === MAX_LINK_HOPS) return yield* Effect.fail(real.failure);
			current = path.resolve(path.dirname(current), link.success);
		}
	});

/**
 * Atomic single-file writes over core `FileSystem` and `Path`.
 *
 * @remarks
 * A static class with a private constructor, so each static keeps its TSDoc in
 * the built declarations.
 *
 * @public
 */
export class AtomicFile {
	private constructor() {}

	/**
	 * Replace `target` with `content` so that a crash leaves the old content or
	 * the new content, whole.
	 *
	 * @remarks
	 * The content goes to a temp file named `.effected-<random>.tmp` in the
	 * target's directory, is synced, and is renamed over the target. A failure or
	 * an interruption before the rename removes the temp and leaves the target
	 * untouched.
	 *
	 * A symlinked target keeps its link: the write lands on the file the link
	 * points to, and a dangling link creates that file. An existing file keeps its
	 * permission bits. A string is written as UTF-8 and bytes are written verbatim.
	 * Parent directories are not created; an absent parent fails `NotFound`.
	 *
	 * Limits:
	 *
	 * - The directory needs write permission. A read-only directory fails loudly;
	 *   there is no non-atomic fallback.
	 * - A hard link is broken: the target's name gets a new inode, and other names
	 *   for the old one keep the old content.
	 * - The directory is not synced, so the rename itself may not survive power
	 *   loss.
	 * - A killed process can leave a `.effected-*.tmp` file behind.
	 * - Windows can refuse the rename while a reader holds the file.
	 *
	 * @param target - The file to replace or create.
	 * @param content - The complete new content.
	 * @returns An `Effect` that completes once `target` holds `content`, or fails
	 * with the `PlatformError` of the step that failed.
	 */
	static readonly write: (
		target: string,
		content: string | Uint8Array,
	) => Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> = Effect.fn(
		"AtomicFile.write",
	)(function* (target: string, content: string | Uint8Array) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const final = yield* resolveFinalPath(fs, path, target);
		const mode = yield* fs.stat(final).pipe(
			Effect.map((info): number | undefined => info.mode & 0o7777),
			Effect.catch((error) => (error.reason._tag === "NotFound" ? Effect.succeed(undefined) : Effect.fail(error))),
		);
		const suffix = yield* Random.nextIntBetween(0, 0x7fffffff);
		const temp = path.join(path.dirname(final), `.effected-${suffix.toString(36)}.tmp`);
		const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;

		yield* Effect.gen(function* () {
			yield* Effect.scoped(
				Effect.gen(function* () {
					const file = yield* fs.open(temp, mode === undefined ? { flag: "wx" } : { flag: "wx", mode });
					yield* file.writeAll(bytes);
					yield* file.sync;
				}),
			);
			// open's mode is subject to umask, so it can land narrower than the original.
			if (mode !== undefined) yield* fs.chmod(temp, mode);
			yield* fs.rename(temp, final);
		}).pipe(Effect.onError(() => fs.remove(temp, { force: true }).pipe(Effect.ignore)));
	});
}
