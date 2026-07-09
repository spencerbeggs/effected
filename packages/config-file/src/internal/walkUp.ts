import type { Path } from "effect";
import { Effect, Option } from "effect";

/**
 * Ascend from `start` toward the filesystem root, yielding each directory.
 * Stops after `stopAt` (inclusive) when given, and always stops at the root.
 *
 * Bounded by construction: `Path.dirname` is a fixpoint at the root, so the
 * loop terminates. `maxDepth` is a belt-and-braces guard against a pathological
 * `Path` implementation.
 */
export const ascend = (
	path: Path.Path,
	start: string,
	options?: { readonly stopAt?: string; readonly maxDepth?: number },
): ReadonlyArray<string> => {
	const maxDepth = options?.maxDepth ?? 256;
	const dirs: Array<string> = [];
	let current = start;
	for (let depth = 0; depth < maxDepth; depth++) {
		dirs.push(current);
		if (options?.stopAt !== undefined && current === options.stopAt) break;
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return dirs;
};

/**
 * Find the first existing candidate produced by `candidatesFor` across the
 * ascending directory chain. Nearer directories win.
 *
 * @remarks
 * Reused for two shapes: probing filename candidates directly under each
 * ascended directory (`upwardWalk`, and the subpath probe once a root is
 * found), and locating a root marker by passing `(dir) => [dir]` as
 * `candidatesFor` alongside a marker-detection predicate as `exists`
 * (`gitRoot`, `workspaceRoot`).
 */
export const findUpward = (
	dirs: ReadonlyArray<string>,
	candidatesFor: (dir: string) => ReadonlyArray<string>,
	exists: (candidate: string) => Effect.Effect<boolean, unknown>,
): Effect.Effect<Option.Option<string>, unknown> =>
	Effect.gen(function* () {
		for (const dir of dirs) {
			for (const candidate of candidatesFor(dir)) {
				if (yield* exists(candidate)) return Option.some(candidate);
			}
		}
		return Option.none();
	});
