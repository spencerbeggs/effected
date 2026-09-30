// KIT EXTENSION (sync port). The `node:fs` synchronous subset over the literal
// inspection view. Absence throws a node-shaped error built by `nodeErrno`:
// the only failure channel a synchronous signature has.
import type { MemoryFileSystemSyncFileSystem, MemoryFileSystemVolume } from "../MemoryFileSystem.js";
import { nodeErrno } from "./errno.js";

// The port is defined in `stat` terms, so it FOLLOWS symbolic links — unlike
// the literal inspection view it is built on. `MAX_LINK_HOPS` mirrors the
// ELOOP guard a real filesystem applies; a cycle resolves to absence rather
// than spinning.
const MAX_LINK_HOPS = 40;

const resolveLinks = (volume: MemoryFileSystemVolume, path: string): string | undefined => {
	// Resolution is per COMPONENT, not just the final one: `/links/pkg/a.json`
	// has to follow the link at `/links/pkg` before it can see `a.json`, exactly
	// as a real filesystem walks a path. Resolving only the last component makes
	// every path *underneath* a symlinked directory read as absent.
	let current = "";
	let hops = 0;
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			// Applied to the RESOLVED location, so ".." after a link ascends from
			// the target rather than from the link's own parent.
			current = current.slice(0, Math.max(0, current.lastIndexOf("/")));
			continue;
		}
		let candidate = `${current}/${part}`;
		for (;;) {
			const target = volume.readLink(candidate);
			if (target === undefined) break;
			hops += 1;
			if (hops > MAX_LINK_HOPS) return undefined;
			candidate = target.startsWith("/") ? target : `${current}/${target}`;
		}
		if (!volume.has(candidate)) return undefined;
		current = candidate;
	}
	const final = current === "" ? "/" : current;
	return volume.has(final) ? final : undefined;
};

export const makeSyncFileSystem = (volume: MemoryFileSystemVolume): MemoryFileSystemSyncFileSystem => {
	// A dangling link is ABSENT to this port, matching `existsSync`, even though
	// the literal view reports the link itself as present.
	const resolved = (path: string) => resolveLinks(volume, path);
	return {
		exists: (path) => resolved(path) !== undefined,
		readFile: (path) => {
			const target = resolved(path);
			if (target === undefined) {
				throw nodeErrno("ENOENT", "readFile", path);
			}
			const text = volume.text(target);
			if (text === undefined) {
				// Reading a directory as a file is EISDIR in `readFileSync`;
				// anything else that is not a regular file is ENOTDIR.
				throw nodeErrno(volume.isDirectory(target) ? "EISDIR" : "ENOTDIR", "readFile", path);
			}
			return text;
		},
		readDirectory: (path) => {
			const target = resolved(path);
			if (target === undefined) {
				throw nodeErrno("ENOENT", "readDirectory", path);
			}
			const names = volume.readDirectory(target);
			if (names === undefined) {
				throw nodeErrno("ENOTDIR", "readDirectory", path);
			}
			return names;
		},
		isDirectory: (path) => {
			const target = resolved(path);
			return target !== undefined && volume.isDirectory(target);
		},
	};
};
