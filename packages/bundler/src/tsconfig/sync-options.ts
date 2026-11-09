// Debt, not a kept exception (#1254): these `node:fs` ops back `TsconfigLoaderSync` for the tiers not yet moved onto
// `FileSystem`, `dts/resolved-tsconfig.ts` (the tsdown passes' tsconfigs) and `meta/api-extractor.ts` and
// `meta/tsconfig-resolver.ts` (the meta pass). Converting those tiers retires this module; see `okf/modules/bundler.md`.
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
