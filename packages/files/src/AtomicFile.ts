// Atomic replacement of one file: write a temp file beside the target, sync it,
// then rename it into place, so a reader or a crash sees the old content or the
// new content and never a truncated file. A target the caller may not write is
// refused first, as a plain write would. A symlinked target is followed by
// default or replaced on request; a link realPath cannot follow is written
// through directly when following. FileSystem and Path arrive through R; this
// package owns no filesystem backend.

import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Random, Result } from "effect";

/**
 * Options for {@link AtomicFile.write}.
 *
 * @public
 */
export interface AtomicFileOptions {
	/**
	 * What a symbolic link at `target` itself means. Defaults to `"follow"`.
	 *
	 * @remarks
	 * - `"follow"` writes to the file behind the link and keeps the link, which
	 *   is right for a dotfile-style target a user links in on purpose. A link
	 *   `realPath` cannot follow (a dangling one) is written through directly,
	 *   without atomicity, creating the file wherever the link points.
	 * - `"replace"` treats the link as the entry to replace: the temp file is
	 *   created in the link's own directory and the rename replaces the link
	 *   with a regular file, so the file it pointed to is never read, checked
	 *   or written, and a dangling link creates nothing at its destination. The
	 *   link's destination contributes no permission bits. Use it when a tool
	 *   may run in a checkout nobody has reviewed, where a committed symlink
	 *   could point a write outside the workspace.
	 *
	 * Either way only the last path component is governed: a symlinked parent
	 * directory is traversed as with any path. Confine the target first (for
	 * example with `@effected/walker`'s `confineReal`) when the parents are not
	 * trusted either.
	 *
	 * Any other value is a defect.
	 */
	readonly links?: "follow" | "replace";
}

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
	 * the new content, whole. Under the default `links: "follow"`, a link
	 * `realPath` cannot follow is the one exception: it is written through
	 * directly.
	 *
	 * @remarks
	 * The content goes to a temp file named `.effected-<random>.tmp` in the
	 * target's directory, is synced, and is renamed over the target. A failure or
	 * an interruption before the rename removes the temp and leaves the target
	 * untouched. A temp name that is already taken fails `AlreadyExists` and leaves
	 * that file alone.
	 *
	 * A symlinked target keeps its link by default: the write lands on the file
	 * the link points to. Pass `{ links: "replace" }` to replace the link itself
	 * instead, live or dangling, without touching what it points to; see
	 * {@link AtomicFileOptions}. An existing file keeps its permission bits, and
	 * one the caller may not write is refused with `PermissionDenied` before any
	 * temp is created. A string is written as UTF-8 and bytes are written
	 * verbatim. Parent directories are not created; an absent parent fails
	 * `NotFound`.
	 *
	 * Limits:
	 *
	 * - The directory needs write permission. A read-only directory fails loudly;
	 *   there is no non-atomic fallback.
	 * - A hard link is broken: the target's name gets a new inode, and other names
	 *   for the old one keep the old content.
	 * - The directory is not synced, so the rename itself may not survive power
	 *   loss.
	 * - A rename creates a new inode, so ownership, ACLs and extended attributes
	 *   of the old file are not kept.
	 * - A killed process can leave a `.effected-*.tmp` file behind.
	 * - Under `"follow"`, a link `realPath` cannot follow (dangling, or with a
	 *   symlink before `..` in its text under Node) is written through directly,
	 *   without atomicity.
	 * - Windows can refuse the rename while a reader holds the file.
	 *
	 * @param target - The file to replace or create.
	 * @param content - The complete new content.
	 * @param options - How a symbolic link at `target` is treated.
	 * @returns An `Effect` that completes once `target` holds `content`, or fails
	 * with the `PlatformError` of the step that failed.
	 */
	static readonly write: (
		target: string,
		content: string | Uint8Array,
		options?: AtomicFileOptions,
	) => Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> = Effect.fn(
		"AtomicFile.write",
	)(function* (target: string, content: string | Uint8Array, options?: AtomicFileOptions) {
		const links = options?.links ?? "follow";
		if (links !== "follow" && links !== "replace") {
			return yield* Effect.die(
				new Error(`AtomicFile.write: links must be "follow" or "replace", received ${JSON.stringify(links)}`),
			);
		}
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;

		let final = target;
		if (links === "follow") {
			// The rename must land on the file behind any symlinks, so the link survives. A link realPath cannot follow is
			// written through, which leaves its resolution to the filesystem: Node's realpath applies link text lexically.
			const real = yield* Effect.result(fs.realPath(target));
			if (Result.isFailure(real)) {
				if (real.failure.reason._tag !== "NotFound") return yield* Effect.fail(real.failure);
				const link = yield* Effect.result(fs.readLink(target));
				if (Result.isSuccess(link)) return yield* fs.writeFile(target, bytes);
			} else {
				final = real.success;
			}
		}

		// The mode comes from the inode the rename replaces: the resolved file under "follow" (stat), the entry at the target
		// itself under "replace" (lstat). A link being replaced is not a file whose mode or writability matters, so it
		// contributes neither, and the file it points to is never consulted.
		const mode = yield* (links === "replace" ? fs.lstat(final) : fs.stat(final)).pipe(
			Effect.map((info): number | undefined => (info.type === "SymbolicLink" ? undefined : info.mode & 0o7777)),
			Effect.catch((error) => (error.reason._tag === "NotFound" ? Effect.succeed(undefined) : Effect.fail(error))),
		);
		// A rename needs only the directory's permission, so without this a read-only file would be replaced where a plain
		// write refuses. Ask the platform, never the mode bits: ACLs and ownership decide too.
		if (mode !== undefined) yield* fs.access(final, { writable: true });
		const suffix = yield* Random.nextIntBetween(0, 0x7fffffff);
		const temp = path.join(path.dirname(final), `.effected-${suffix.toString(36)}.tmp`);

		// The temp is ours to remove only once our open made it: `wx` failing means it is another writer's. Uninterruptible
		// so an interrupt cannot land between the open and arming the cleanup, which would leak the temp.
		let opened = false;
		yield* Effect.gen(function* () {
			yield* Effect.scoped(
				Effect.gen(function* () {
					const file = yield* fs.open(temp, mode === undefined ? { flag: "wx" } : { flag: "wx", mode }).pipe(
						Effect.tap(() =>
							Effect.sync(() => {
								opened = true;
							}),
						),
						Effect.uninterruptible,
					);
					yield* file.writeAll(bytes);
					yield* file.sync;
				}),
			);
			// open's mode is subject to umask, so it can land narrower than the original.
			if (mode !== undefined) yield* fs.chmod(temp, mode);
			yield* fs.rename(temp, final);
		}).pipe(Effect.onError(() => (opened ? fs.remove(temp, { force: true }).pipe(Effect.ignore) : Effect.void)));
	});
}
