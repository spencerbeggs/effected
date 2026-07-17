/**
 * The Node.js binding for the sync entry points — ready-made `SyncFileSystem`
 * and `SyncPath` operations over `node:fs` / `node:path`, so adopting
 * `findWorkspaceRootSync` / `getWorkspacePackagesSync` is one import instead
 * of four hand-wired one-liners.
 *
 * Deliberately a **separate subpath** (`@effected/workspaces/node-sync`), not
 * part of the main entry: the main entry imports nothing platform-shaped, and
 * re-exporting these from it would drag `node:*` imports into every consumer —
 * including the ones supplying their own operations (a win32-explicit `path`,
 * a Bun or Deno binding, a test fake). Import this module only where Node's
 * built-ins are the platform you mean; `nodePath` is the running platform's
 * `node:path`, so on Windows the paths handed back are win32 paths.
 *
 * @example
 * ```ts
 * import { findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";
 * import { nodeSyncOps } from "@effected/workspaces/node-sync";
 *
 * const root = findWorkspaceRootSync(nodeSyncOps);
 * const packages = root === null ? [] : getWorkspacePackagesSync(root, nodeSyncOps);
 * ```
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import type { SyncFileSystem, SyncPath, WorkspacesSyncOptions } from "./WorkspacesSync.js";

// This module is an ENTRY POINT, so re-exporting is allowed (and required):
// api-extractor models each entry as its own surface, and the three op types
// appear in this entry's public declarations — without the re-export the
// build reports ae-forgotten-export for all three. It also lets a consumer
// type against the subpath alone.
export type { SyncFileSystem, SyncPath, WorkspacesSyncOptions } from "./WorkspacesSync.js";

/**
 * `SyncFileSystem` over `node:fs`.
 *
 * @remarks
 * `existsSync` never throws, satisfying `exists`'s must-not-throw contract;
 * the other three may throw and every throw lands in the sync entry points'
 * documented degraded-skip semantics.
 *
 * @public
 */
export const nodeFileSystem: SyncFileSystem = {
	exists: existsSync,
	readFile: (p) => readFileSync(p, "utf8"),
	readDirectory: (p) => readdirSync(p),
	isDirectory: (p) => statSync(p).isDirectory(),
};

/**
 * `SyncPath` as the running platform's `node:path` — win32 semantics on
 * Windows, posix elsewhere. Pass `node:path/win32` or `node:path/posix`
 * yourself to pin a dialect.
 *
 * @public
 */
export const nodePath: SyncPath = path;

/**
 * The complete Node-bound options bag for `findWorkspaceRootSync` and
 * `getWorkspacePackagesSync` — {@link nodeFileSystem} plus {@link nodePath}.
 * Spread it to add the per-call extras: `{ ...nodeSyncOps, cwd }`.
 *
 * @public
 */
export const nodeSyncOps: WorkspacesSyncOptions = {
	fileSystem: nodeFileSystem,
	path: nodePath,
};
