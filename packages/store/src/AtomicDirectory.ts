// Atomic replacement of a whole on-disk directory: stage the file set in a
// sibling directory, then swap it into place with two renames, so a reader
// never observes a half-written or half-removed tree. FileSystem and Path
// arrive through R; store owns no filesystem backend.

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
 * - `validate` — `root` names no directory of its own (it normalises to a
 *   basename of `.` or `..`), or a file path is empty, absolute, or climbs
 *   out of the directory. Nothing was touched.
 * - `clear` — leftover staging or a leftover old tree from an earlier run
 *   could not be removed. The live directory is untouched.
 * - `stage` — the staging directory could not be created.
 * - `write` — a file, or one of its parent directories, could not be
 *   written into staging. The live directory is untouched.
 * - `promote` — one of the two renames failed. If the first (live to
 *   `.<name>.old`) failed, the live directory is untouched; if the second
 *   (staging to live) failed, the live directory is absent, with the old
 *   tree complete in `.<name>.old` and the new one complete in staging.
 *   No tree is ever partial; the next call puts the old tree back under
 *   `root` before it stages, then writes again.
 * - `cleanup` — the new tree is live and complete, but removing the old
 *   one from `.<name>.old` failed. The next call removes it, so a caller
 *   that only needs the new tree in place may treat this as success.
 *
 * `path` is the path the step was working on: the offending relative path
 * for a file's `validate`, the root as given for the root's, and an
 * absolute or root-relative path otherwise. `cause` keeps the underlying
 * failure, usually a `PlatformError`.
 *
 * @public
 */
export class AtomicDirectoryError extends Schema.TaggedError<AtomicDirectoryError>()("AtomicDirectoryError", {
	/** The step that failed. */
	operation: Schema.Literals(["validate", "clear", "stage", "write", "promote", "cleanup"]),
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

/** `path` without trailing `/` or `\`, so a root's basename is its own name; a loop, since the regex form backtracks on long runs. */
const stripTrailingSeparators = (path: string): string => {
	let end = path.length;
	while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) end -= 1;
	return path.slice(0, end);
};

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
	 * the old tree, the new one, or briefly none, but never a partial tree.
	 *
	 * @remarks
	 * The choreography, in order:
	 *
	 * 1. `root` is normalised (`/cache/pkg/.` is `/cache/pkg`), and a root
	 *    whose basename is then `.` or `..` fails with operation
	 *    `"validate"`. Every file path is validated too: an empty path, an
	 *    absolute path, or one that climbs out of the directory fails with
	 *    `"validate"`. Nothing on disk is touched until both pass.
	 * 2. Two siblings of `root` are used: the staging directory
	 *    `.<name>.staging` and the retired tree `.<name>.old` (so `/cache/pkg`
	 *    stages in `/cache/.pkg.staging`). Both are owned by the writer, and
	 *    any leftover of either from an earlier crash is removed with force.
	 * 3. Staging is created, even for an empty file set, so the promotion
	 *    always has a directory to move and an empty set yields an empty
	 *    directory.
	 * 4. Each file is written into staging, creating its parent directories.
	 * 5. The live directory, if present, is renamed to `.<name>.old`, staging
	 *    is renamed into its place, and then `.<name>.old` is removed.
	 *
	 * **Same filesystem.** Staging and the old tree are siblings precisely so
	 * both renames stay on one filesystem, where each is atomic. A `root`
	 * whose parent is a mount point for a different filesystem than `root`
	 * itself breaks that guarantee; such a layout is not supported.
	 *
	 * **The brief-absence window.** Between the two renames `root` does not
	 * exist. A concurrent reader in that window sees the directory as
	 * missing, never as a partial tree, so a cache reader should treat
	 * absence as a miss. The two renames run uninterruptibly, so a fiber
	 * interrupt (a timeout, a closing scope) cannot land between them. The
	 * old tree is removed only after it has left `root`, so no reader sees
	 * it half-deleted. A failure or crash between the renames leaves `root`
	 * absent, the old tree complete in `.<name>.old` and the new one complete
	 * in staging; the next call renames the old tree back under `root`
	 * before it stages, so the absence lasts only until the next write
	 * begins, then writes again.
	 *
	 * **One writer per root.** The sibling names are fixed, which is what
	 * lets a later call clean up after a crashed one, so two concurrent
	 * writers to the same `root` race each other. Serialize writes to one
	 * `root`.
	 *
	 * A filesystem root such as `/` has no sibling to stage in and is a
	 * defect. A relative `root` resolves against the process working
	 * directory, as every `FileSystem` call does.
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

		const normalised = path.normalize(root);
		const target = normalised.length > 1 ? stripTrailingSeparators(normalised) : normalised;
		const name = path.basename(target);
		if (name === "." || name === "..") {
			return yield* new AtomicDirectoryError({
				operation: "validate",
				path: root,
				cause: new Error("the root must name a directory of its own, not . or .."),
			});
		}
		if (name === "" || path.dirname(target) === target) {
			return yield* Effect.die(
				new Error(`AtomicDirectory.write: root must name a directory below a parent, received ${JSON.stringify(root)}`),
			);
		}
		const staging = path.join(path.dirname(target), `.${name}.staging`);
		const retired = path.join(path.dirname(target), `.${name}.old`);

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
		// A run that crashed between its two renames left the only complete old
		// tree in `.<name>.old` and `root` absent: put it back before staging,
		// so readers see the old tree, not a miss, while this call stages.
		if (
			(yield* fs.exists(retired).pipe(step("clear", retired))) &&
			!(yield* fs.exists(target).pipe(step("clear", target)))
		) {
			yield* fs.rename(retired, target).pipe(step("clear", retired));
		}
		yield* fs.remove(retired, { recursive: true, force: true }).pipe(step("clear", retired));
		yield* fs.makeDirectory(staging, { recursive: true }).pipe(step("stage", staging));
		for (const [relative, content] of entries) {
			const full = path.join(staging, relative);
			yield* fs.makeDirectory(path.dirname(full), { recursive: true }).pipe(step("write", full));
			yield* (typeof content === "string" ? fs.writeFileString(full, content) : fs.writeFile(full, content)).pipe(
				step("write", full),
			);
		}
		// One unit: an interrupt between the two renames would strand `root` absent.
		yield* Effect.uninterruptible(
			Effect.gen(function* () {
				if (yield* fs.exists(target).pipe(step("promote", target))) {
					yield* fs.rename(target, retired).pipe(step("promote", target));
				}
				yield* fs.rename(staging, target).pipe(step("promote", target));
			}),
		);
		yield* fs.remove(retired, { recursive: true, force: true }).pipe(step("cleanup", retired));
	});
}
