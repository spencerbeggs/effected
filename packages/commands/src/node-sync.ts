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
import { randomBytes } from "node:crypto";
import {
	closeSync,
	fstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import process from "node:process";
import { requireResolve } from "./internal/anchor.js";
import { makeNodeRunSync } from "./internal/nodeRunSync.js";
import type { PrebuiltHost, PrebuiltTarget } from "./PrebuiltBinary.js";
import type { ProcessLivenessShape, RunOnceCommandHost, RunOnceFileSystem, SyncRun } from "./RunOnce.js";
import type { SyncSpawn } from "./ToolDiscoverySync.js";

export type { ModuleLoadOptions, ModuleResolveOptions } from "./ModuleResolution.js";
export { ModuleResolution } from "./ModuleResolution.js";
export type { PrebuiltHost, PrebuiltTarget } from "./PrebuiltBinary.js";
export type {
	ProcessLivenessShape,
	RunOnceCommandHost,
	RunOnceFileSystem,
	RunOnceSyncHost,
	SyncRun,
	SyncRunResult,
} from "./RunOnce.js";
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

/** The running Node's libc on Linux, from the process report header; absent elsewhere or when unknown. */
const nodeLibc = (): PrebuiltTarget["libc"] => {
	if (process.platform !== "linux") return undefined;
	try {
		const header = (process.report?.getReport() as { readonly header?: { readonly glibcVersionRuntime?: unknown } })
			?.header;
		if (header === undefined) return undefined;
		return typeof header.glibcVersionRuntime === "string" ? "glibc" : "musl";
	} catch {
		return undefined;
	}
};

/**
 * `PrebuiltHost` for the running Node process, resolving from `anchor`.
 *
 * @remarks
 * `anchor` must be a module of the package that DECLARES the optional
 * dependencies — pass that module's `import.meta.url`. `require.resolve` finds
 * an optional dependency only from inside its declaring package (a transitive
 * optional dependency is never hoisted where another package could see it), so
 * the kit cannot supply the anchor itself. The target is `process.platform` and
 * `process.arch`, plus the libc on Linux: glibc when the process report names a
 * glibc runtime, musl otherwise.
 *
 * @public
 */
export const nodePrebuiltHost = (anchor: string | URL): PrebuiltHost => {
	const libc = nodeLibc();
	return {
		target: { platform: process.platform, arch: process.arch, ...(libc === undefined ? {} : { libc }) },
		resolve: (specifier) => requireResolve(specifier, anchor),
	};
};

/**
 * `ProcessLivenessShape` for the running Node process: `process.pid`,
 * `os.hostname()`, and a signal-0 probe.
 *
 * @remarks
 * `process.kill(pid, 0)` sends nothing; it answers whether `pid` exists. An
 * `EPERM` answer means the process exists but belongs to another user — alive,
 * and never ours to take over. Any other failure (`ESRCH`) means it is gone. A
 * plain synchronous value, not a layer: the `Effect` form takes it through
 * `ProcessLiveness.layerFrom(nodeProcessLiveness)`.
 *
 * @public
 */
export const nodeProcessLiveness: ProcessLivenessShape = {
	pid: process.pid,
	host: hostname(),
	isAlive: (pid) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === "EPERM";
		}
	},
};

const errnoCode = (error: unknown): unknown => (error as NodeJS.ErrnoException | undefined)?.code;

/**
 * `RunOnceFileSystem` over `node:fs`.
 *
 * @remarks
 * `createExclusive` is an `O_EXCL` create (`"wx"`); a write that fails after
 * the create removes what it created, so a half-initialized lock is never left
 * behind for every later caller to wait out.
 *
 * @public
 */
export const nodeRunOnceFileSystem: RunOnceFileSystem = {
	makeDirectory: (path) => {
		mkdirSync(path, { recursive: true });
	},
	readText: (path) => {
		try {
			return readFileSync(path, "utf8");
		} catch (error) {
			if (errnoCode(error) === "ENOENT") return undefined;
			throw error;
		}
	},
	createExclusive: (path, text) => {
		let fd: number;
		try {
			fd = openSync(path, "wx");
		} catch (error) {
			if (errnoCode(error) === "EEXIST") return false;
			throw error;
		}
		try {
			writeSync(fd, text);
		} catch (error) {
			closeSync(fd);
			rmSync(path, { force: true });
			throw error;
		}
		closeSync(fd);
		return true;
	},
	writeText: (path, text) => writeFileSync(path, text),
	remove: (path) => rmSync(path, { force: true }),
	mtimeMs: (path) => {
		try {
			return statSync(path).mtimeMs;
		} catch (error) {
			if (errnoCode(error) === "ENOENT") return undefined;
			throw error;
		}
	},
	readDirectory: (path) => readdirSync(path),
	rename: (from, to) => {
		try {
			renameSync(from, to);
			return true;
		} catch (error) {
			if (errnoCode(error) === "ENOENT") return false;
			throw error;
		}
	},
};

/**
 * `SyncRun` over `node:child_process.spawnSync`.
 *
 * @remarks
 * argv only, never a shell; stdin is the null device. Under `"capture"` each
 * stream goes to a private temporary FILE, not a pipe, so no amount of output
 * can trip `spawnSync`'s buffer limit and kill a successful build; the
 * trailing `maxOutputBytes` of each are read back and the files removed. No
 * timeout is imposed.
 *
 * @public
 */
export const nodeRunSync: SyncRun = makeNodeRunSync({
	spawnSync,
	mkdtempSync,
	openSync,
	closeSync,
	rmSync,
	fstatSync,
	readSync,
	tmpdir,
});

/** Blocks the calling thread for `ms` — `Atomics.wait` on a private buffer, which Node permits on the main thread. */
const blockFor = (ms: number): void => {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/**
 * `RunOnceCommandHost` for the running Node process: `nodeRunOnceFileSystem`,
 * `nodeProcessLiveness`, `Date.now`, an `Atomics.wait` sleep, a 96-bit
 * `crypto.randomBytes` nonce and `nodeRunSync`. Satisfies `RunOnceSyncHost`.
 *
 * @public
 */
export const nodeRunOnceHost: RunOnceCommandHost = {
	fs: nodeRunOnceFileSystem,
	liveness: nodeProcessLiveness,
	now: () => Date.now(),
	sleep: blockFor,
	nonce: () => randomBytes(12).toString("hex"),
	run: nodeRunSync,
};
