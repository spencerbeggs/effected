/**
 * The Node.js binding for the sync tool-discovery facade — a ready-made
 * `SyncSpawn` over `node:child_process`, so adopting `makeToolDiscoverySync`
 * is one import.
 *
 * Deliberately a **separate subpath** (`@effected/commands/node-sync`), not
 * part of the main entry: the main entry imports nothing platform-shaped (the
 * spawner arrives through `R`), and re-exporting this from it would put a
 * `node:child_process` import in front of every consumer, including the ones
 * that never run a sync probe.
 *
 * @example
 * ```ts
 * import { Tool, makeToolDiscoverySync } from "@effected/commands";
 * import { nodeSpawnSync } from "@effected/commands/node-sync";
 *
 * const discovery = makeToolDiscoverySync({ spawn: nodeSpawnSync });
 * discovery.isAvailable(Tool.named("git"));
 * ```
 *
 * @packageDocumentation
 */

import { spawnSync } from "node:child_process";
import type { SyncSpawn } from "./ToolDiscoverySync.js";

// This module is an ENTRY POINT, so re-exporting is allowed (and required):
// the spawn types appear in this entry's public declarations.
export type { SyncSpawn, SyncSpawnResult } from "./ToolDiscoverySync.js";

/**
 * `SyncSpawn` over `node:child_process.spawnSync`.
 *
 * @remarks
 * argv only, never a shell, so a tool name is never interpolated into a
 * command line. stdin is the null device, so a probe can never sit waiting on
 * input, and stderr is discarded — discovery reads stdout and the exit status
 * only. A missing executable comes back as `error` (`ENOENT`), which discovery
 * reads as absence. No timeout is imposed, matching `ToolDiscovery`; wrap
 * `spawnSync` yourself with one for tools that might hang.
 *
 * @public
 */
export const nodeSpawnSync: SyncSpawn = (command, args, options) =>
	spawnSync(command, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		windowsHide: true,
		...(options.cwd === undefined ? {} : { cwd: options.cwd }),
	});
