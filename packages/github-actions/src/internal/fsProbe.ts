/**
 * "Is there a file / a directory at this path?" — the probe the installers
 * ask before deciding whether to reinstall, skip or fail typed.
 *
 * @internal
 */

import type { FileSystem } from "effect";
import { Effect } from "effect";

/**
 * The entry's type, or `undefined` when nothing readable is there. Absence
 * and unreadability collapse together on purpose: every caller's next move
 * (reinstall, write the shim, fail `layoutUnexpected`) is the same for both.
 *
 * @internal
 */
export const typeAt = (fs: FileSystem.FileSystem, path: string): Effect.Effect<FileSystem.File.Type | undefined> =>
	Effect.map(Effect.option(fs.stat(path)), (info) => (info._tag === "Some" ? info.value.type : undefined));
