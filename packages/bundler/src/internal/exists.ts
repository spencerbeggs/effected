import { Effect, FileSystem } from "effect";

/**
 * Whether a path exists, with `existsSync`'s semantics: every error reads as absent. `FileSystem.exists` answers
 * `false` only for `NotFound` and fails on the rest, so a parent segment that is a file (`ENOTDIR`, a `BadResource`)
 * or a denied `access` (`EACCES`) would surface where the ported code read "not there". The one place that rule
 * lives; a site that wants the stricter answer calls `FileSystem.exists` itself.
 *
 * @internal
 */
export const existsLikeNode = (path: string): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
	Effect.flatMap(FileSystem.FileSystem, (fs) => fs.exists(path)).pipe(Effect.orElseSucceed(() => false));
