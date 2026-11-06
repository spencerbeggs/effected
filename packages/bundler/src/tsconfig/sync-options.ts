import { existsSync, readFileSync } from "node:fs";
import * as nodePath from "node:path";
import type { TsconfigLoaderSyncOptions } from "@effected/tsconfig-json";

/**
 * The consumer-supplied sync operations backing every `TsconfigLoaderSync` call in this
 * package: Node's `existsSync`/`readFileSync` satisfy the loader's `SyncFileSystem`, and
 * `node:path` satisfies `SyncPath` verbatim.
 *
 * @internal
 */
export const tsconfigSyncOptions: TsconfigLoaderSyncOptions = {
	fileSystem: { exists: existsSync, readFile: (p) => readFileSync(p, "utf8") },
	path: nodePath,
};
