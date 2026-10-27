/**
 * The Node.js binding for the synchronous walk — a ready-made
 * `WalkerSyncFileSystem` over `node:fs` and `WalkerSyncPath` over `node:path`,
 * so adopting `descendSync` is one import.
 *
 * Deliberately a **separate subpath** (`@effected/walker/node-sync`), not part
 * of the main entry: the main entry takes its platform through `R` (or, for the
 * sync forms, from the caller) and imports nothing platform-shaped.
 *
 * @example
 * ```ts
 * import { GlobPattern } from "@effected/glob";
 * import { descendSync } from "@effected/walker";
 * import { nodeWalkerSyncOps } from "@effected/walker/node-sync";
 * import { Result } from "effect";
 *
 * const pattern = Result.getOrThrow(GlobPattern.compileResult("src/**"));
 * const files = descendSync(pattern, { cwd: process.cwd(), ...nodeWalkerSyncOps });
 * ```
 *
 * @packageDocumentation
 */

import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import * as path from "node:path";
import type { WalkerSyncFileSystem, WalkerSyncOps, WalkerSyncPath } from "./DescendSync.js";

// This module is an ENTRY POINT, so re-exporting is allowed (and required):
// the port types appear in this entry's public declarations.
export type { WalkerSyncFileSystem, WalkerSyncOps, WalkerSyncPath, WalkerSyncStats } from "./DescendSync.js";

/**
 * `WalkerSyncFileSystem` over `node:fs`: `readdirSync`, `statSync`,
 * `lstatSync`, `realpathSync`.
 *
 * @public
 */
export const nodeWalkerFileSystem: WalkerSyncFileSystem = {
	readDirectory: (p) => readdirSync(p),
	stat: (p) => statSync(p),
	lstat: (p) => lstatSync(p),
	realPath: (p) => realpathSync(p),
};

/**
 * `WalkerSyncPath` over `node:path` (the host platform's separator).
 *
 * @public
 */
export const nodeWalkerPath: WalkerSyncPath = { join: path.join };

/**
 * Both bindings, to spread into `descendSync` options.
 *
 * @public
 */
export const nodeWalkerSyncOps: WalkerSyncOps = { fileSystem: nodeWalkerFileSystem, path: nodeWalkerPath };
