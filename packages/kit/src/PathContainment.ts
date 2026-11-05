import { Effect, FileSystem, Path } from "effect";

/** Link hops followed before a candidate is judged outside (a loop never settles). */
const MAX_LINK_HOPS = 40;

/** Whether a platform failure means "nothing is there", the only failure read as absent. */
const isNotFound = (error: { readonly reason?: { readonly _tag: string } }): boolean =>
	error.reason?._tag === "NotFound";

/**
 * Decides whether a caller-supplied path stays inside a root.
 *
 * @remarks
 * Audience: a handler that must refuse a path outside its workspace before
 * reading or writing it. Neither form fails: "outside" is the answer `false`,
 * and the filesystem is required in `R` from core, never owned here. A
 * relative `candidate` is resolved against `root`, never the process working
 * directory.
 *
 * {@link PathContainment.isWithinLexical} is pure and compares spellings, so a
 * link inside the root that points out is invisible to it. Use
 * {@link PathContainment.isWithin} for anything that will touch the disk.
 *
 * @public
 */
export class PathContainment {
	private constructor() {}

	/**
	 * Whether `candidate` is `root` or lies under it, comparing resolved
	 * spellings only (`..` segments and trailing separators are normalised;
	 * links are not followed). A sibling sharing a prefix (`/repo-other` against
	 * `/repo`) is outside. A relative `candidate` is resolved against `root`.
	 */
	static isWithinLexical(path: Path.Path, root: string, candidate: string): boolean {
		const base = path.resolve(root);
		const target = path.resolve(base, candidate);
		if (target === base) {
			return true;
		}
		const relative = path.relative(base, target);
		return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
	}

	/**
	 * Whether `candidate` is `root` or lies under it once links are resolved.
	 *
	 * @remarks
	 * The candidate need not exist: its nearest existing ancestor is resolved
	 * with `realPath` and the missing tail appended, so a path about to be
	 * created is judged by where its parent really is. A component that is a
	 * dangling link is followed to where it points (a link out of the root is
	 * outside even when its target is absent), up to a fixed number of hops;
	 * a loop is outside.
	 *
	 * Fails closed: only a `NotFound` counts as absent. Any other failure on a
	 * candidate component (permission denied, a link loop, a non-directory
	 * parent) answers `false`. The lexical answer stands in only when the root's
	 * own real path is `NotFound`; any other failure reading it is `false`.
	 *
	 * A point-in-time check: the filesystem can change between this answer and
	 * the read or write it guards.
	 */
	static readonly isWithin = (
		root: string,
		candidate: string,
	): Effect.Effect<boolean, never, FileSystem.FileSystem | Path.Path> =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const base = path.resolve(root);
			const realRoot = yield* Effect.result(fs.realPath(base));
			if (realRoot._tag === "Failure") {
				return isNotFound(realRoot.failure) && PathContainment.isWithinLexical(path, root, candidate);
			}
			let existing = path.resolve(base, candidate);
			let tail: ReadonlyArray<string> = [];
			let hops = 0;
			for (;;) {
				const real = yield* Effect.result(fs.realPath(existing));
				if (real._tag === "Success") {
					return PathContainment.isWithinLexical(path, realRoot.success, path.join(real.success, ...tail));
				}
				if (!isNotFound(real.failure)) {
					return false;
				}
				const link = yield* Effect.result(fs.readLink(existing));
				if (link._tag === "Success") {
					hops += 1;
					if (hops > MAX_LINK_HOPS) {
						return false;
					}
					// Resolve against the canonical parent: an earlier component may itself be a
					// link, and `..` in a relative target climbs from where the parent really is.
					const parent = yield* Effect.result(fs.realPath(path.dirname(existing)));
					if (parent._tag === "Failure") {
						return false;
					}
					existing = path.resolve(parent.success, link.success, ...tail);
					tail = [];
					continue;
				}
				if (!isNotFound(link.failure)) {
					return false;
				}
				const parent = path.dirname(existing);
				if (parent === existing) {
					return false;
				}
				tail = [path.basename(existing), ...tail];
				existing = parent;
			}
		});
}
