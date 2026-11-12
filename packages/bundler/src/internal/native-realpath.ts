// `node:fs` rather than `FileSystem`: the one call is `realpathSync.native`, realpath(3). Core `FileSystem.realPath`
// runs Node's JavaScript `fs.realpath`, which keeps the caller's spelling on a case-insensitive volume and resolves a
// `..` after a symlink lexically, where realpath(3) returns the on-disk case and resolves it physically. A dts-emit
// tsconfig names its base and file set by the canonical path tsgo looks projects up by, so these names must be the
// native ones. They name host-disk files tsgo reads, so no provided filesystem can stand in for them.
import { realpathSync } from "node:fs";
import { Effect } from "effect";

/**
 * The host's realpath(3) of `path`, failing with whatever `realpathSync.native` throws.
 *
 * @internal
 */
export const nativeRealPath = (path: string): Effect.Effect<string, unknown> =>
	Effect.try({ try: () => realpathSync.native(path), catch: (cause) => cause });
