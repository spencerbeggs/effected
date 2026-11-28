// Atomic replacement of one file: write a temp file beside the target, sync it,
// then rename it into place, so a reader or a crash sees the old content or the
// new content and never a truncated file. A target the caller may not write is
// refused first, as a plain write would. A symlinked target is followed by
// default or replaced on request; a link realPath cannot follow is written
// through directly when following. A confined write (confineTo) refuses a link
// at the target or at any directory between the root and the target, and checks
// again immediately before the rename. FileSystem and Path arrive through R; this
// package owns no filesystem backend.

import { Effect, FileSystem, Path, PlatformError, Random, Result } from "effect";

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
	/**
	 * A directory the write must stay inside. Unset, the write is not confined.
	 *
	 * @remarks
	 * The root is trusted: it is resolved once with `realPath`, so a root that is
	 * itself a link (or sits under one) is fine. The target, resolved against
	 * the working directory, must lie strictly below the root as given or below
	 * its real path, and the root itself is refused. Then every directory from
	 * the root down to the target's directory must be a real directory, not a
	 * symbolic link, and the target must not be a link either: under a confined
	 * write a link at the target is refused unless `links` is `"replace"`, in
	 * which case the link entry is replaced as {@link AtomicFileOptions.links}
	 * describes. Passing `links: "follow"` with `confineTo` is a defect, since
	 * following the link is what confinement refuses.
	 *
	 * The temp file is written in the target's real directory. After the temp is
	 * written and synced, the same checks run again before the `chmod` that
	 * restores an existing mode (itself a path call) and once more immediately
	 * before the rename: every directory below the root is still not a link, the
	 * directory's `realPath` still equals the planned real path (so it is still
	 * inside the root's real path), and the target has not become a link. Any
	 * refusal fails a `PlatformError` whose reason is a `SystemError` tagged
	 * `PermissionDenied`, with `module: "AtomicFile"` and `method: "write"`, so
	 * an adopter's existing `mapError` keeps working and a confinement refusal
	 * is told apart from the filesystem's own by its `module`.
	 *
	 * What it closes: a link at the target or at any parent below the root that
	 * exists when the write starts, and one swapped in while the temp is being
	 * written. What it does not close: core `FileSystem` names files by path,
	 * with no directory handle (`openat`/`renameat`), so a swap in the instant
	 * between the last check and the `rename` call itself still lands the
	 * rename through the new link. The window is a few system calls wide,
	 * instead of the whole write. When the pre-rename check fails, the temp is
	 * left where it is rather than removed through a path that may now cross a
	 * link, so a `.effected-*.tmp` file can remain in the directory that was
	 * moved. A hard link at the target is not a symbolic link and is replaced as
	 * usual. The root itself is not re-resolved: a link swapped in above the
	 * root is caught only because the directory's `realPath` stops matching.
	 */
	readonly confineTo?: string;
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
	 * Pass `{ confineTo: root }` to keep the write inside `root`: a symbolic link
	 * at the target, or at any directory between `root` and the target, is
	 * refused, and the check runs again immediately before the rename. See
	 * {@link AtomicFileOptions.confineTo} for what that does and does not close.
	 *
	 * @param target - The file to replace or create.
	 * @param content - The complete new content.
	 * @param options - How a symbolic link at `target` is treated, and the root a
	 * confined write must stay inside.
	 * @returns An `Effect` that completes once `target` holds `content`, or fails
	 * with the `PlatformError` of the step that failed, or of the confinement
	 * check that refused it.
	 */
	static readonly write: (
		target: string,
		content: string | Uint8Array,
		options?: AtomicFileOptions,
	) => Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> = Effect.fn(
		"AtomicFile.write",
	)(function* (target: string, content: string | Uint8Array, options?: AtomicFileOptions) {
		const confineTo = options?.confineTo;
		const given = options?.links;
		if (given !== undefined && given !== "follow" && given !== "replace") {
			return yield* Effect.die(
				new Error(`AtomicFile.write: links must be "follow" or "replace", received ${JSON.stringify(given)}`),
			);
		}
		if (confineTo !== undefined && given === "follow") {
			return yield* Effect.die(new Error('AtomicFile.write: links "follow" cannot be combined with confineTo'));
		}
		if (confineTo !== undefined && typeof confineTo !== "string") {
			return yield* Effect.die(
				new Error(`AtomicFile.write: confineTo must be a string, received ${JSON.stringify(confineTo)}`),
			);
		}
		// Unset under confineTo, a link at the target is refused rather than followed or replaced.
		const links = given ?? (confineTo === undefined ? "follow" : "refuse");
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;

		let final = target;
		// Under confineTo, the check to repeat immediately before the rename.
		let verify: Effect.Effect<void, PlatformError.PlatformError> | undefined;
		if (confineTo !== undefined) {
			const plan = yield* planConfined(fs, path, target, confineTo, links === "replace");
			final = plan.final;
			verify = plan.verify;
		} else if (links === "follow") {
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
		// itself otherwise (lstat). A link being replaced is not a file whose mode or writability matters, so it
		// contributes neither, and the file it points to is never consulted.
		const mode = yield* (links === "follow" ? fs.stat(final) : fs.lstat(final)).pipe(
			Effect.map((info): number | undefined => (info.type === "SymbolicLink" ? undefined : info.mode & 0o7777)),
			Effect.catch((error) => (error.reason._tag === "NotFound" ? Effect.succeed(undefined) : Effect.fail(error))),
		);
		// A rename needs only the directory's permission, so without this a read-only file would be replaced where a plain
		// write refuses. Ask the platform, never the mode bits: ACLs and ownership decide too.
		if (mode !== undefined) yield* fs.access(final, { writable: true });
		const suffix = yield* Random.nextIntBetween(0, 0x7fffffff);
		const temp = path.join(path.dirname(final), `.effected-${suffix.toString(36)}.tmp`);

		// The temp is ours to remove only once our open made it: `wx` failing means it is another writer's. Uninterruptible
		// so an interrupt cannot land between the open and arming the cleanup, which would leak the temp. A failed
		// confinement check disarms it again: the temp's path may now cross a link, and removing through it would reach
		// outside the root.
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
			const confined =
				verify === undefined
					? Effect.void
					: verify.pipe(
							Effect.tapError(() =>
								Effect.sync(() => {
									opened = false;
								}),
							),
						);
			// open's mode is subject to umask, so it can land narrower than the original. Under confineTo the chmod is a path
			// call too, so the directory is checked before it as well as before the rename.
			if (mode !== undefined) {
				yield* confined;
				yield* fs.chmod(temp, mode);
			}
			yield* confined;
			yield* fs.rename(temp, final);
		}).pipe(Effect.onError(() => (opened ? fs.remove(temp, { force: true }).pipe(Effect.ignore) : Effect.void)));
	});
}

/** A confinement refusal: a `PermissionDenied` `PlatformError` from `AtomicFile.write` itself. */
const refuse = (target: string, description: string): PlatformError.PlatformError =>
	PlatformError.systemError({
		_tag: "PermissionDenied",
		module: "AtomicFile",
		method: "write",
		pathOrDescriptor: target,
		description,
	});

/**
 * Plans a confined write: the real final path and the check to repeat before the rename. The root is resolved once;
 * every directory below it is walked with `lstat` (never followed), and the directory's `realPath` must equal the path
 * built from the root's real path, which also catches a link swapped in above the root.
 */
const planConfined = Effect.fnUntraced(function* (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	target: string,
	confineTo: string,
	replaceLink: boolean,
) {
	const root = path.resolve(confineTo);
	const realRoot = yield* fs.realPath(root);
	const absolute = path.resolve(target);
	const inside = (base: string): string | undefined => {
		const relative = path.relative(base, absolute);
		return relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
			? undefined
			: relative;
	};
	const relative = inside(root) ?? inside(realRoot);
	if (relative === undefined) {
		return yield* Effect.fail(refuse(target, `the target is not inside confineTo (${confineTo})`));
	}
	const segments = relative.split(path.sep);
	const directories = segments.slice(0, -1).map((_, index) => path.join(realRoot, ...segments.slice(0, index + 1)));
	const directory = path.join(realRoot, ...segments.slice(0, -1));
	const final = path.join(realRoot, relative);

	const check = Effect.gen(function* () {
		for (const entry of directories) {
			const info = yield* fs.lstat(entry);
			if (info.type === "SymbolicLink") {
				return yield* Effect.fail(refuse(target, `a directory below confineTo is a symbolic link (${entry})`));
			}
		}
		const real = yield* fs.realPath(directory);
		if (real !== directory) {
			return yield* Effect.fail(
				refuse(target, `the target's directory resolves to ${real}, not ${directory} inside confineTo`),
			);
		}
		if (!replaceLink) {
			const info = yield* Effect.result(fs.lstat(final));
			if (Result.isFailure(info)) {
				if (info.failure.reason._tag !== "NotFound") return yield* Effect.fail(info.failure);
			} else if (info.success.type === "SymbolicLink") {
				return yield* Effect.fail(refuse(target, "the target is a symbolic link"));
			}
		}
	});
	yield* check;
	return { final, verify: check } as const;
});
