// Atomic replacement of a whole on-disk directory: stage the file set in a
// sibling directory, then swap it into place, so a reader never observes a
// half-written tree. FileSystem and Path arrive through R; store owns no
// filesystem backend.

import { Effect, FileSystem, Path, Schema } from "effect";
import { causeMessage } from "./internal/causeMessage.js";

/**
 * The file set {@link AtomicDirectory.write} lays down: pairs of a path
 * relative to the directory and the file's content.
 *
 * @remarks
 * Any iterable of pairs works, so a `Map`, an array of tuples and
 * `Object.entries(record)` all fit. Text is written as UTF-8; bytes are
 * written verbatim. A later pair for the same path overwrites an earlier one.
 *
 * @public
 */
export type AtomicDirectoryFiles = Iterable<readonly [path: string, content: string | Uint8Array]>;

/**
 * {@link AtomicDirectory.write} could not lay down or promote a directory.
 *
 * @remarks
 * `operation` names the step that failed:
 *
 * - `validate` — a file path is empty, absolute, or climbs out of the
 *   directory. Nothing was touched.
 * - `clear` — leftover staging from an earlier run could not be removed.
 * - `stage` — the staging directory could not be created.
 * - `write` — a file, or one of its parent directories, could not be
 *   written into staging. The live directory is untouched.
 * - `promote` — removing the live directory or renaming staging into its
 *   place failed. A failure here can leave the live directory absent, with
 *   the complete new tree still in staging; it is never half-written. The
 *   next call clears the staging and writes again.
 *
 * `path` is the path the step was working on: the offending relative path
 * for `validate`, an absolute or root-relative path otherwise. `cause` keeps
 * the underlying failure, usually a `PlatformError`.
 *
 * @public
 */
export class AtomicDirectoryError extends Schema.TaggedError<AtomicDirectoryError>()("AtomicDirectoryError", {
	/** The step that failed. */
	operation: Schema.Literals(["validate", "clear", "stage", "write", "promote"]),
	/** The path the step was working on. */
	path: Schema.String,
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		const detail = causeMessage(this.cause);
		const head = `atomic directory ${this.operation} failed for ${JSON.stringify(this.path)}`;
		return detail === undefined ? head : `${head}: ${detail}`;
	}
}

/**
 * Atomic whole-directory replacement over core `FileSystem`.
 *
 * @remarks
 * A static class with a private constructor, so each static keeps its TSDoc
 * in the built declarations.
 *
 * @public
 */
export class AtomicDirectory {
	private constructor() {}

	/**
	 * Replace the directory at `root` with exactly `files`, so a reader sees
	 * either the old tree or the new one, never a partial write.
	 *
	 * @remarks
	 * The choreography, in order:
	 *
	 * 1. Every file path is validated first. An empty path, an absolute path,
	 *    or one that climbs out of the directory fails with operation
	 *    `"validate"` before anything on disk is touched.
	 * 2. The staging directory is the sibling `.<name>.staging` next to `root`
	 *    (so `/cache/pkg` stages in `/cache/.pkg.staging`). Leftover staging
	 *    from an earlier crash is removed.
	 * 3. Staging is created, even for an empty file set, so the promotion
	 *    always has a directory to move and an empty set yields an empty
	 *    directory.
	 * 4. Each file is written into staging, creating its parent directories.
	 * 5. The live directory is removed, if present, and staging is renamed
	 *    into its place.
	 *
	 * **Same filesystem.** Staging is a sibling precisely so the final
	 * `rename` stays on one filesystem, where it is atomic. A `root` whose
	 * parent is a mount point for a different filesystem than `root` itself
	 * breaks that guarantee; such a layout is not supported.
	 *
	 * **The brief-absence window.** Between removing the live directory and
	 * renaming staging in, `root` does not exist. A concurrent reader in that
	 * window sees the directory as missing, never half-written, so a cache
	 * reader should treat absence as a miss. A failure or crash inside the
	 * window leaves `root` absent with the complete new tree in staging; the
	 * next call clears it and writes again.
	 *
	 * **One writer per root.** The staging name is fixed, which is what lets a
	 * later call clean up after a crashed one, so two concurrent writers to
	 * the same `root` race each other. Serialize writes to one `root`.
	 *
	 * A `root` with no name of its own (a filesystem root such as `/`) has no
	 * sibling to stage in and is a defect. `root` is used as given; a
	 * relative one resolves against the process working directory, as every
	 * `FileSystem` call does.
	 *
	 * @example
	 * ```ts
	 * import { AtomicDirectory } from "@effected/store";
	 * import { Effect } from "effect";
	 *
	 * const program = AtomicDirectory.write(
	 *   "/var/cache/app/packages/left-pad",
	 *   new Map([
	 *     ["package.json", '{"name":"left-pad"}'],
	 *     ["lib/index.d.ts", "export {};"],
	 *   ]),
	 * );
	 * // provide FileSystem and Path at the edge, e.g. NodeServices.layer
	 * ```
	 *
	 * @param root - The directory to replace.
	 * @param files - The complete new contents, as relative path and content pairs.
	 * @returns An `Effect` that completes once `root` holds exactly `files`,
	 * or fails with {@link AtomicDirectoryError}.
	 */
	static readonly write: (
		root: string,
		files: AtomicDirectoryFiles,
	) => Effect.Effect<void, AtomicDirectoryError, FileSystem.FileSystem | Path.Path> = Effect.fn(
		"AtomicDirectory.write",
	)(function* (root: string, files: AtomicDirectoryFiles) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const name = path.basename(root);
		if (name === "" || path.dirname(root) === root) {
			return yield* Effect.die(
				new Error(`AtomicDirectory.write: root must name a directory below a parent, received ${JSON.stringify(root)}`),
			);
		}
		const staging = path.join(path.dirname(root), `.${name}.staging`);

		const entries = Array.from(files);
		for (const [relative] of entries) {
			const full = path.join(staging, relative);
			const back = path.relative(staging, full);
			const escapes =
				relative === "" ||
				path.isAbsolute(relative) ||
				back === "" ||
				back === ".." ||
				back.startsWith(`..${path.sep}`) ||
				path.isAbsolute(back);
			if (escapes) {
				return yield* new AtomicDirectoryError({
					operation: "validate",
					path: relative,
					cause: new Error("a file path must be relative and stay inside the directory"),
				});
			}
		}

		const step =
			(operation: AtomicDirectoryError["operation"], at: string) =>
			<A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, AtomicDirectoryError> =>
				Effect.mapError(effect, (cause) => new AtomicDirectoryError({ operation, path: at, cause }));

		yield* fs.remove(staging, { recursive: true, force: true }).pipe(step("clear", staging));
		yield* fs.makeDirectory(staging, { recursive: true }).pipe(step("stage", staging));
		for (const [relative, content] of entries) {
			const full = path.join(staging, relative);
			yield* fs.makeDirectory(path.dirname(full), { recursive: true }).pipe(step("write", full));
			yield* (typeof content === "string" ? fs.writeFileString(full, content) : fs.writeFile(full, content)).pipe(
				step("write", full),
			);
		}
		yield* fs.remove(root, { recursive: true, force: true }).pipe(step("promote", root));
		yield* fs.rename(staging, root).pipe(step("promote", root));
	});
}
