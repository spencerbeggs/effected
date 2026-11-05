import { Effect, FileSystem, Path } from "effect";

/**
 * Decides whether a caller-supplied path stays inside a root.
 *
 * @remarks
 * Audience: a handler that must refuse a path outside its workspace before
 * reading or writing it. Neither form fails: "outside" is the answer `false`,
 * and the filesystem is required in `R` from core, never owned here.
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
	 * `/repo`) is outside.
	 */
	static isWithinLexical(path: Path.Path, root: string, candidate: string): boolean {
		const base = path.resolve(root);
		const target = path.resolve(candidate);
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
	 * with `realPath` and the missing tail is appended, so a path about to be
	 * created is judged by where its parent really is. The answer falls back to
	 * {@link PathContainment.isWithinLexical} only when the root's own real path
	 * cannot be read. A dangling link on the way is treated as absent, so seed
	 * or create its target before relying on the verdict for a path beneath it.
	 */
	static readonly isWithin = (
		root: string,
		candidate: string,
	): Effect.Effect<boolean, never, FileSystem.FileSystem | Path.Path> =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const realRoot = yield* fs.realPath(path.resolve(root)).pipe(Effect.option);
			if (realRoot._tag === "None") {
				return PathContainment.isWithinLexical(path, root, candidate);
			}
			let existing = path.resolve(candidate);
			const tail: Array<string> = [];
			for (;;) {
				const real = yield* fs.realPath(existing).pipe(Effect.option);
				if (real._tag === "Some") {
					return PathContainment.isWithinLexical(path, realRoot.value, path.join(real.value, ...tail));
				}
				const parent = path.dirname(existing);
				if (parent === existing) {
					return false;
				}
				tail.unshift(path.basename(existing));
				existing = parent;
			}
		});
}
