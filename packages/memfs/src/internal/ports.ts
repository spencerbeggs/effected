// KIT EXTENSION (sync port). The `node:fs` synchronous subset over the literal
// inspection view. Absence throws a node-shaped error built by `nodeErrno`:
// the only failure channel a synchronous signature has.
import type {
	MemoryFileSystemDirent,
	MemoryFileSystemPortStats,
	MemoryFileSystemPromisesFileSystem,
	MemoryFileSystemSyncFileSystem,
	MemoryFileSystemVolume,
	MemoryFileSystemVolumeStat,
} from "../MemoryFileSystem.js";
import { nodeErrno } from "./errno.js";

// The port is defined in `stat` terms, so it FOLLOWS symbolic links — unlike
// the literal inspection view it is built on. `MAX_LINK_HOPS` mirrors the
// ELOOP guard a real filesystem applies; the budget is ONE counter shared by
// the whole resolution (recursive target walks included), so a cycle spread
// across nested link targets terminates as ELOOP.
const MAX_LINK_HOPS = 40;

type Resolved = { readonly path: string } | { readonly code: "ENOENT" | "ENOTDIR" | "ELOOP" };

interface HopBudget {
	hops: number;
}

const walk = (volume: MemoryFileSystemVolume, path: string, followFinal: boolean, budget: HopBudget): Resolved => {
	// Resolution is per COMPONENT, not just the final one: `/links/pkg/a.json`
	// has to follow the link at `/links/pkg` before it can see `a.json`, exactly
	// as a real filesystem walks a path.
	let current = "";
	const parts = path.split("/").filter((part) => part !== "" && part !== ".");
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === "..") {
			// `..` under a non-directory is ENOTDIR, as the kernel reports it.
			const here = volume.lstat(current === "" ? "/" : current);
			if (here !== undefined && here.kind !== "directory") return { code: "ENOTDIR" };
			// Applied to the RESOLVED location, so ".." after a link ascends from
			// the target rather than from the link's own parent.
			current = current.slice(0, Math.max(0, current.lastIndexOf("/")));
			continue;
		}
		// A component under something that is not a directory is ENOTDIR, not absence.
		const parent = volume.lstat(current === "" ? "/" : current);
		if (parent !== undefined && parent.kind !== "directory") return { code: "ENOTDIR" };
		let candidate = `${current}/${part}`;
		if (i < parts.length - 1 || followFinal) {
			for (;;) {
				const target = volume.readLink(candidate);
				if (target === undefined) break;
				budget.hops += 1;
				if (budget.hops > MAX_LINK_HOPS) return { code: "ELOOP" };
				const resolved = walk(volume, target.startsWith("/") ? target : `${current}/${target}`, true, budget);
				if ("code" in resolved) return resolved;
				candidate = resolved.path;
			}
		}
		if (volume.lstat(candidate) === undefined) return { code: "ENOENT" };
		current = candidate;
	}
	return { path: current === "" ? "/" : current };
};

/**
 * Resolves `path` the way `stat` (or, with `followFinal: false`, `lstat`) does,
 * reporting WHY it is absent: `ENOENT`, `ENOTDIR` (a component under a
 * non-directory) or `ELOOP` (too many links).
 */
export const resolvePath = (volume: MemoryFileSystemVolume, path: string, followFinal = true): Resolved =>
	walk(volume, path, followFinal, { hops: 0 });

const portStats = (s: MemoryFileSystemVolumeStat): MemoryFileSystemPortStats => ({
	isFile: () => s.kind === "file",
	isDirectory: () => s.kind === "directory",
	isSymbolicLink: () => s.kind === "symlink",
	mtimeMs: s.mtimeMs,
	size: s.size,
});

const statOf = (volume: MemoryFileSystemVolume, path: string, syscall: "stat" | "lstat", follow: boolean) => {
	const r = resolvePath(volume, path, follow);
	if ("code" in r) throw nodeErrno(r.code, syscall, path);
	const s = volume.lstat(r.path);
	if (s === undefined) throw nodeErrno("ENOENT", syscall, path);
	return portStats(s);
};

/**
 * Wraps each named member of `port` so its handler runs first: a handler may
 * throw, return a replacement, or return `undefined` to delegate.
 */
export const withFaults = <Port extends object>(
	port: Port,
	faults: Partial<Record<keyof Port, (...args: ReadonlyArray<unknown>) => unknown>> | undefined,
): Port => {
	if (faults === undefined) return port;
	const out = Object.assign({}, port) as unknown as Record<string, unknown>;
	for (const [name, handler] of Object.entries(faults)) {
		const original = (port as Record<string, (...args: ReadonlyArray<unknown>) => unknown>)[name];
		if (handler === undefined || original === undefined) continue;
		out[name] = (...args: ReadonlyArray<unknown>) => {
			const replaced = (handler as (...a: ReadonlyArray<unknown>) => unknown)(...args);
			return replaced === undefined ? original(...args) : replaced;
		};
	}
	return out as Port;
};

// The `syscall` on each thrown error is the one node reports for the same call:
// `open` for readFile (`read` when the target is a directory), `scandir` for
// readDirectory, `stat`/`lstat` for the stat pair.
export const makeSyncFileSystem = (volume: MemoryFileSystemVolume): MemoryFileSystemSyncFileSystem => ({
	exists: (path) => !("code" in resolvePath(volume, path)),
	readFile: (path) => {
		const r = resolvePath(volume, path);
		if ("code" in r) throw nodeErrno(r.code, "open", path);
		const text = volume.text(r.path);
		if (text === undefined) {
			// Reading a directory as a file is EISDIR in `readFileSync`;
			// anything else that is not a regular file is ENOTDIR.
			throw volume.isDirectory(r.path) ? nodeErrno("EISDIR", "read", path) : nodeErrno("ENOTDIR", "open", path);
		}
		return text;
	},
	readDirectory: (path) => {
		const r = resolvePath(volume, path);
		if ("code" in r) throw nodeErrno(r.code, "scandir", path);
		const names = volume.readDirectory(r.path);
		if (names === undefined) throw nodeErrno("ENOTDIR", "scandir", path);
		return names;
	},
	isDirectory: (path) => {
		const r = resolvePath(volume, path);
		return !("code" in r) && volume.isDirectory(r.path);
	},
	stat: (path) => statOf(volume, path, "stat", true),
	lstat: (path) => statOf(volume, path, "lstat", false),
});

const settle = <A>(f: () => A): Promise<A> => {
	try {
		return Promise.resolve(f());
	} catch (e) {
		return Promise.reject(e);
	}
};

export const makePromisesFileSystem = (volume: MemoryFileSystemVolume): MemoryFileSystemPromisesFileSystem => {
	const sync = makeSyncFileSystem(volume);
	function readdir(path: string): Promise<ReadonlyArray<string>>;
	function readdir(
		path: string,
		options: { readonly withFileTypes: true },
	): Promise<ReadonlyArray<MemoryFileSystemDirent>>;
	function readdir(
		path: string,
		options?: { readonly withFileTypes?: boolean },
	): Promise<ReadonlyArray<string> | ReadonlyArray<MemoryFileSystemDirent>> {
		return settle(() => {
			const names = sync.readDirectory(path);
			if (options?.withFileTypes !== true) return names;
			const r = resolvePath(volume, path);
			const base = "code" in r ? path : r.path;
			return names.map((name): MemoryFileSystemDirent => {
				// Literal: a link is reported as a link, as `readdir` dirents do.
				const kind = volume.lstat(`${base === "/" ? "" : base}/${name}`)?.kind;
				return {
					name,
					isFile: () => kind === "file",
					isDirectory: () => kind === "directory",
					isSymbolicLink: () => kind === "symlink",
				};
			});
		});
	}
	return {
		readdir,
		stat: (path) => settle(() => sync.stat(path)),
		lstat: (path) => settle(() => sync.lstat(path)),
		readFile: (path, _encoding) => settle(() => sync.readFile(path)),
	};
};
