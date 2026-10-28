// A seed read from a real directory on disk. Node-only: reached from the
// `./node-sync` entry and never from `src/index.ts`, so the main entry stays
// free of `node:*` imports.

import * as NFS from "node:fs";
import * as NPath from "node:path";
import type {
	MemoryFileSystemSeed,
	MemoryFileSystemSeedDirectory,
	MemoryFileSystemSeedEntry,
	MemoryFileSystemSeedFile,
	MemoryFileSystemSeedSymlink,
} from "./MemoryFileSystem.js";

/**
 * Options for {@link NodeDirectorySeed.read}.
 *
 * @public
 */
export interface NodeDirectorySeedOptions {
	/**
	 * The absolute POSIX path the directory is mounted at in the volume.
	 *
	 * @remarks
	 * With it, every key is absolute (`mountAt` itself for the directory, then
	 * `mountAt/a.txt` and so on), for `layerWith(seed)`. Without it, every key is
	 * relative to the directory (`""` for the directory itself), for
	 * `layerWith(seed, { root })` — pass the root there, or the relative keys
	 * have nothing to join to. A relative `mountAt` throws a `RangeError`.
	 */
	readonly mountAt?: string | undefined;
	/**
	 * Copy each file's and directory's permission bits (`mode & 0o7777`).
	 * Defaults to `false`, which leaves the volume's own `0o644` / `0o755`.
	 *
	 * @remarks
	 * Off by default because the bits on a checkout depend on the host's umask
	 * and filesystem, so a suite asserting on them would pass on one machine and
	 * fail on another. Turn it on when the fixture's modes are the subject.
	 */
	readonly modes?: boolean | undefined;
	/**
	 * The largest file read, in bytes. Defaults to 16 MiB. A larger file throws
	 * `EFBIG` naming it, before its contents are read.
	 */
	readonly maxFileBytes?: number | undefined;
}

const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;

/** A node-shaped error: a message, a `code`, and the path it is about. */
const seedError = (code: string, path: string, message: string): Error =>
	Object.assign(new Error(`${code}: ${message}, '${path}'`), { code, path, syscall: "seed" });

// The ELOOP budget a real filesystem applies, shared by one link's whole
// resolution. Running out without a cycle cannot be proved inside: refused.
const MAX_LINK_HOPS = 40;

/** The separators a link's target text splits on: a backslash too where the host spells paths that way. */
const SEPARATORS = NPath.sep === "\\" ? /[\\/]/ : /\//;

/** How many directories below the root `real` sits; `real` is the root or inside it. */
const depthBelow = (realRoot: string, real: string): number => {
	const relative = NPath.relative(realRoot, real);
	return relative === "" ? 0 : relative.split(NPath.sep).length;
};

/**
 * Whether the segments still to resolve stay inside, read lexically from
 * `depth` — for the part of a path past a component the host cannot resolve,
 * where nothing exists to follow. A `..` above the root at any point escapes.
 */
const lexicallyInside = (depth: number, segments: ReadonlyArray<string>): boolean => {
	let at = depth;
	for (const segment of segments) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			at -= 1;
			if (at < 0) return false;
		} else {
			at += 1;
		}
	}
	return true;
};

type Resolution = { readonly path: string } | "escapes" | "unresolved";

interface LinkWalk {
	hops: number;
	readonly active: Set<string>;
}

/**
 * Resolves `target` from the real directory `from` one segment at a time on
 * the host, following every link on the way, and answers `"escapes"` the
 * moment any step leaves `realRoot` — even one that comes back in, because the
 * volume mounts the fixture alone and has no host above it to come back
 * through. A path that stops resolving (a missing component, a component under
 * a file, a cycle) has nothing left to follow; its remaining segments are
 * checked lexically, failing closed.
 */
const resolveInside = (realRoot: string, from: string, target: string, walk: LinkWalk): Resolution => {
	if (NPath.isAbsolute(target) || target.startsWith("/")) return "escapes";
	const segments = target.split(SEPARATORS);
	let current = from;
	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index] as string;
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			if (current === realRoot) return "escapes";
			current = NPath.dirname(current);
			continue;
		}
		const candidate = NPath.join(current, segment);
		let stat: NFS.Stats | undefined;
		try {
			stat = NFS.lstatSync(candidate);
		} catch {
			// ENOENT, or ENOTDIR under a file: nothing exists here to follow.
			stat = undefined;
		}
		if (stat === undefined) {
			return lexicallyInside(depthBelow(realRoot, current), segments.slice(index)) ? "unresolved" : "escapes";
		}
		if (stat.isSymbolicLink()) {
			// A link already being resolved is a cycle: ELOOP on the host and in
			// the volume alike, and every step so far stayed inside.
			let next: Resolution = "unresolved";
			if (!walk.active.has(candidate)) {
				walk.hops += 1;
				if (walk.hops > MAX_LINK_HOPS) return "escapes";
				walk.active.add(candidate);
				next = resolveInside(realRoot, current, NFS.readlinkSync(candidate), walk);
				walk.active.delete(candidate);
			}
			if (next === "escapes") return "escapes";
			if (next === "unresolved") {
				// Nothing to follow past a link that resolves nowhere, and no place
				// to read the rest from: read it from the root, the strictest base.
				return lexicallyInside(0, segments.slice(index + 1)) ? "unresolved" : "escapes";
			}
			current = next.path;
			continue;
		}
		current = candidate;
	}
	return { path: current };
};

/**
 * Checks a symlink's target text before it is copied into the seed, and
 * returns the text unchanged.
 *
 * @remarks
 * The link is NEVER followed to read content — only its text is copied — so
 * nothing outside the fixture is ever read. What is refused is a link whose
 * target would leave the fixture at any step: an absolute target (a host path
 * the volume would resolve against itself, not the host), or a relative one
 * whose host resolution, segment by segment through every link, steps outside
 * the fixture root. A dangling target is resolved the same way as far as the
 * host can follow it, then lexically. A resolution that runs out of link hops
 * without a cycle is refused.
 */
const checkLink = (realRoot: string, linkPath: string, relativeLink: string, target: string): string => {
	if (NPath.isAbsolute(target) || target.startsWith("/")) {
		throw seedError(
			"ERR_SEED_SYMLINK_ESCAPE",
			linkPath,
			`symlink target "${target}" is absolute; only relative targets inside the fixture can be seeded`,
		);
	}
	// The walk reaches each directory through real directories only (links are
	// never descended), so the link's real parent is a plain join.
	const parent = relativeLink.includes("/") ? relativeLink.slice(0, relativeLink.lastIndexOf("/")) : "";
	const realParent = parent === "" ? realRoot : NPath.join(realRoot, ...parent.split("/"));
	const self = NPath.join(realParent, NPath.basename(linkPath));
	const walk: LinkWalk = { hops: 1, active: new Set([self]) };
	if (resolveInside(realRoot, realParent, target, walk) === "escapes") {
		throw seedError(
			"ERR_SEED_SYMLINK_ESCAPE",
			linkPath,
			`symlink target "${target}" resolves outside the fixture directory`,
		);
	}
	return target;
};

/**
 * Reads the regular file at `path` that `expected` (its `lstat`) described,
 * through one descriptor, so the checks apply to the bytes actually read.
 *
 * @remarks
 * The entry can change between the walk's `lstat` and the read. Opened with
 * `O_NOFOLLOW` where the host has it (a link swapped in fails `ELOOP`) and
 * `O_NONBLOCK` where it has that (a FIFO swapped in cannot block the open),
 * the descriptor's own `fstat` must still be a regular file with the
 * `lstat`'s device and inode, or the read throws `ERR_SEED_CHANGED`; its size
 * is checked against `maxFileBytes`, and the read is bounded by that size. A
 * file that shrinks mid-read also throws `ERR_SEED_CHANGED`.
 *
 * @internal
 */
export const readSeedFile = (path: string, expected: NFS.Stats, maxFileBytes: number): Uint8Array => {
	const constants = NFS.constants;
	const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
	const fd = NFS.openSync(path, flags);
	try {
		const stat = NFS.fstatSync(fd);
		if (!stat.isFile() || stat.dev !== expected.dev || stat.ino !== expected.ino) {
			throw seedError("ERR_SEED_CHANGED", path, "the entry changed while the fixture was read");
		}
		if (stat.size > maxFileBytes) {
			throw seedError("EFBIG", path, `file is ${stat.size} bytes, over maxFileBytes ${maxFileBytes}`);
		}
		// Our own buffer, not node's: a small Buffer is a view into a shared
		// pool, and the seed must own exactly these bytes.
		const content = new Uint8Array(stat.size);
		let offset = 0;
		while (offset < content.length) {
			const read = NFS.readSync(fd, content, offset, content.length - offset, offset);
			if (read === 0) break;
			offset += read;
		}
		if (offset < content.length) {
			throw seedError("ERR_SEED_CHANGED", path, "the file shrank while the fixture was read");
		}
		return content;
	} finally {
		NFS.closeSync(fd);
	}
};

/**
 * Reads a real directory into a `MemoryFileSystemSeed`, byte for byte, for
 * `MemoryFileSystem.layerWith` / `makeSync`.
 *
 * @remarks
 * Synchronous and Node-only, for a suite that builds its volume at `describe`
 * scope from a fixture tree checked into the repository. Every file is read as
 * bytes and copied into its own `Uint8Array`, so the seed holds exactly what
 * is on disk — no text decoding, no line-ending translation. Every directory,
 * empty ones included, becomes a directory entry; entries are listed parent
 * first, in code-unit order, so two reads of one tree produce one seed.
 *
 * - **Symlinks are copied as links, never followed.** The target text is
 *   stored verbatim, so a link inside the fixture still points where it did.
 *   A link that would leave the fixture throws `ERR_SEED_SYMLINK_ESCAPE`: an
 *   absolute target, or a target whose resolution on the host, one segment at
 *   a time through every link on the way, steps outside the directory at any
 *   point — even to come back in, since the volume has nothing above the
 *   mount to come back through. A dangling target is followed as far as the
 *   host can, then read lexically; a chain that runs out of link hops without
 *   a cycle is refused. Nothing outside the directory is read. The directory
 *   argument itself may be a link; it is resolved once.
 * - **Modes** are copied only with `modes: true`; mtimes never are (they
 *   differ per checkout, and a seed's times are the volume clock's).
 * - **A file over `maxFileBytes`** (16 MiB by default) throws `EFBIG`, checked
 *   against the open descriptor's size before the read, and the read is
 *   bounded by that size.
 * - **An entry that changes while it is read** throws `ERR_SEED_CHANGED`: a
 *   file is opened without following a link (where the host supports it) and
 *   must still be the regular file the walk saw (same device and inode), so a
 *   link or another file swapped in between the walk and the read is refused.
 * - **Anything else** — a FIFO, a socket, a device — throws
 *   `ERR_SEED_UNSUPPORTED_TYPE`; the volume models files, directories and
 *   links only.
 *
 * A read failure is node's own error, rethrown (`ENOENT` for a missing
 * directory, `ENOTDIR` for a file). Every thrown error carries `code` and
 * `path`. The walk is iterative, so depth is bounded by the host, not the
 * call stack.
 *
 * @example
 * ```ts
 * import { MemoryFileSystem } from "@effected/memfs";
 * import { NodeDirectorySeed } from "@effected/memfs/node-sync";
 *
 * const seed = NodeDirectorySeed.read("__test__/fixtures/bundle", { mountAt: "/repo" });
 * const handle = MemoryFileSystem.makeSync(seed);
 * console.log(handle.volume.has("/repo"));
 * // => true
 * ```
 *
 * @public
 */
export class NodeDirectorySeed {
	/**
	 * Reads `directory` into a seed. See {@link NodeDirectorySeed} for what is
	 * copied and what throws.
	 *
	 * @param directory - The real directory to read; relative paths resolve
	 * against the process's working directory.
	 * @param options - See {@link NodeDirectorySeedOptions}.
	 * @returns A seed keyed under `mountAt`, or relative to the directory when
	 * `mountAt` is omitted.
	 */
	static readonly read = (directory: string, options?: NodeDirectorySeedOptions): MemoryFileSystemSeed => {
		const mountAt = options?.mountAt;
		if (mountAt !== undefined && !mountAt.startsWith("/")) {
			throw new RangeError(`NodeDirectorySeed.read: mountAt must be an absolute POSIX path, got "${mountAt}"`);
		}
		const maxFileBytes = options?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
		if (!Number.isInteger(maxFileBytes) || maxFileBytes < 0) {
			throw new RangeError(
				`NodeDirectorySeed.read: maxFileBytes must be a non-negative integer, got ${String(maxFileBytes)}`,
			);
		}
		const modes = options?.modes === true;

		const rootStat = NFS.statSync(directory);
		if (!rootStat.isDirectory()) throw seedError("ENOTDIR", directory, "not a directory");
		const realRoot = NFS.realpathSync.native(directory);

		const mount = mountAt === undefined ? undefined : mountAt === "/" ? "" : mountAt.replace(/\/+$/, "");
		const keyFor = (relative: string): string =>
			mount === undefined ? relative : relative === "" ? (mount === "" ? "/" : mount) : `${mount}/${relative}`;

		const seed: Record<string, MemoryFileSystemSeedEntry> = {};
		const directoryEntry = (mode: number): MemoryFileSystemSeedDirectory =>
			modes
				? { _tag: "MemoryFileSystemSeedDirectory", mode: mode & 0o7777 }
				: { _tag: "MemoryFileSystemSeedDirectory" };

		seed[keyFor("")] = directoryEntry(rootStat.mode);
		// An explicit stack: a deep fixture must not overflow the call stack.
		const pending: Array<string> = [""];
		while (pending.length > 0) {
			const relativeDir = pending.pop() as string;
			// Read through the caller's spelling of the directory, so every error
			// names a path they recognize; only containment compares real paths.
			const realDir = relativeDir === "" ? directory : NPath.join(directory, ...relativeDir.split("/"));
			const names = NFS.readdirSync(realDir).sort();
			const subdirectories: Array<string> = [];
			for (const name of names) {
				const relative = relativeDir === "" ? name : `${relativeDir}/${name}`;
				const realPath = NPath.join(realDir, name);
				const stat = NFS.lstatSync(realPath);
				if (stat.isSymbolicLink()) {
					const target = NFS.readlinkSync(realPath);
					const entry: MemoryFileSystemSeedSymlink = {
						_tag: "MemoryFileSystemSeedSymlink",
						target: checkLink(realRoot, realPath, relative, target),
					};
					seed[keyFor(relative)] = entry;
				} else if (stat.isDirectory()) {
					seed[keyFor(relative)] = directoryEntry(stat.mode);
					subdirectories.push(relative);
				} else if (stat.isFile()) {
					if (stat.size > maxFileBytes) {
						throw seedError("EFBIG", realPath, `file is ${stat.size} bytes, over maxFileBytes ${maxFileBytes}`);
					}
					const content = readSeedFile(realPath, stat, maxFileBytes);
					const entry: MemoryFileSystemSeedFile = modes
						? { _tag: "MemoryFileSystemSeedFile", content, mode: stat.mode & 0o7777 }
						: { _tag: "MemoryFileSystemSeedFile", content };
					seed[keyFor(relative)] = entry;
				} else {
					throw seedError("ERR_SEED_UNSUPPORTED_TYPE", realPath, "only files, directories and symlinks can be seeded");
				}
			}
			// Reversed onto the stack so subdirectories are visited in name order.
			for (let index = subdirectories.length - 1; index >= 0; index--) {
				pending.push(subdirectories[index] as string);
			}
		}
		return seed;
	};

	private constructor() {}
}
