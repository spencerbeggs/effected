// `nodeRunSync`'s implementation over INJECTED node operations, so its cleanup
// paths can be observed directly in a test (every opened descriptor closed,
// the temporary directory removed, a throwing spawn reported rather than
// thrown). `node-sync.ts` binds it to the real `node:` functions; nothing here
// imports a platform module.

import type { SyncRun, SyncRunResult } from "../RunOnce.js";

/** The node operations `nodeRunSync` performs — `node:fs`, `node:os` and `node:child_process` satisfy it. */
export interface NodeRunOps {
	readonly spawnSync: (
		command: string,
		args: ReadonlyArray<string>,
		options: {
			readonly stdio: ReadonlyArray<"ignore" | "inherit" | number>;
			readonly windowsHide: boolean;
			readonly cwd?: string;
			readonly windowsVerbatimArguments?: boolean;
		},
	) => { readonly error?: Error | undefined; readonly status: number | null };
	readonly mkdtempSync: (prefix: string) => string;
	readonly openSync: (path: string, flags: string) => number;
	readonly closeSync: (fd: number) => void;
	readonly rmSync: (path: string, options: { readonly recursive: boolean; readonly force: boolean }) => void;
	readonly fstatSync: (fd: number) => { readonly size: number };
	readonly readSync: (fd: number, buffer: Uint8Array, offset: number, length: number, position: number) => number;
	readonly tmpdir: () => string;
}

const decoder = new TextDecoder();

/** The trailing `max` bytes of the file behind `fd`, decoded as UTF-8. */
const tail = (ops: NodeRunOps, fd: number, max: number): string => {
	const size = ops.fstatSync(fd).size;
	const length = Math.min(size, max);
	const buffer = new Uint8Array(length);
	ops.readSync(fd, buffer, 0, length, size - length);
	return decoder.decode(buffer);
};

/** A process that could not start, reported the way `spawnSync` reports one. */
const failedToStart = (error: unknown): SyncRunResult => ({ error, status: null, stdout: "", stderr: "" });

/** Builds the `SyncRun` over `ops`. See `nodeRunSync` in `node-sync.ts` for the contract. */
export const makeNodeRunSync =
	(ops: NodeRunOps): SyncRun =>
	(command, args, options) => {
		const passed = {
			...(options.cwd === undefined ? {} : { cwd: options.cwd }),
			...(options.windowsVerbatimArguments === undefined
				? {}
				: { windowsVerbatimArguments: options.windowsVerbatimArguments }),
		};
		// `spawnSync` THROWS (rather than reporting `error`) for an argument it
		// refuses outright — a NUL byte in argv, say. That is still a process that
		// could not start, so it is reported the same way.
		if (options.stdio === "inherit") {
			try {
				const result = ops.spawnSync(command, args, {
					stdio: ["ignore", "inherit", "inherit"],
					windowsHide: true,
					...passed,
				});
				return {
					...(result.error === undefined ? {} : { error: result.error }),
					status: result.status,
					stdout: "",
					stderr: "",
				};
			} catch (error) {
				return failedToStart(error);
			}
		}
		let dir: string | undefined;
		let out: number | undefined;
		let err: number | undefined;
		try {
			dir = ops.mkdtempSync(`${ops.tmpdir()}/effected-run-`);
			out = ops.openSync(`${dir}/stdout`, "w+");
			err = ops.openSync(`${dir}/stderr`, "w+");
			const result = ops.spawnSync(command, args, { stdio: ["ignore", out, err], windowsHide: true, ...passed });
			return {
				...(result.error === undefined ? {} : { error: result.error }),
				status: result.status,
				stdout: tail(ops, out, options.maxOutputBytes),
				stderr: tail(ops, err, options.maxOutputBytes),
			};
		} catch (error) {
			return failedToStart(error);
		} finally {
			// Every path: whatever was opened is closed, whatever was created removed.
			for (const fd of [out, err]) {
				if (fd !== undefined) {
					try {
						ops.closeSync(fd);
					} catch {
						// Already closed or never usable; nothing to release.
					}
				}
			}
			if (dir !== undefined) {
				try {
					ops.rmSync(dir, { recursive: true, force: true });
				} catch {
					// Best effort: a temporary directory the OS will reap.
				}
			}
		}
	};
