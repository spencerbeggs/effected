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

/** Lexical POSIX normalization of a relative path; `..` above the start is kept as a leading `..`. */
const normalizeRelative = (path: string): string => {
	const segments: Array<string> = [];
	for (const segment of path.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === ".." && segments.length > 0 && segments[segments.length - 1] !== "..") {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return segments.join("/");
};

/** Whether `child` is `parent` or inside it, comparing real paths. */
const within = (parent: string, child: string): boolean => {
	const relative = NPath.relative(parent, child);
	return relative === "" || (!relative.startsWith("..") && !NPath.isAbsolute(relative));
};

/**
 * Checks a symlink's target text before it is copied into the seed, and
 * returns the text unchanged.
 *
 * @remarks
 * The link is NEVER followed to read content — only its text is copied — so
 * nothing outside the fixture is ever read. What is refused is a link whose
 * target would leave the fixture: an absolute target (a host path the volume
 * would resolve against itself, not the host), a target that resolves on the
 * host outside the fixture root (the kernel's `realpath` sees through chains of links),
 * or, for a dangling link the host cannot resolve, a target that escapes the
 * fixture lexically.
 */
const checkLink = (realRoot: string, linkPath: string, relativeLink: string, target: string): string => {
	if (NPath.isAbsolute(target) || target.startsWith("/")) {
		throw seedError(
			"ERR_SEED_SYMLINK_ESCAPE",
			linkPath,
			`symlink target "${target}" is absolute; only relative targets inside the fixture can be seeded`,
		);
	}
	let resolved: string | undefined;
	try {
		// `.native`, the kernel's answer: the JS `realpathSync` joins a link's
		// target lexically, so `sub/out -> up/..` with `sub/up -> ..` reads as
		// `sub` there while the kernel resolves it above the fixture.
		resolved = NFS.realpathSync.native(linkPath);
	} catch {
		// Dangling, or a loop: the host cannot answer, so the lexical check below decides.
		resolved = undefined;
	}
	const parent = relativeLink.includes("/") ? relativeLink.slice(0, relativeLink.lastIndexOf("/")) : "";
	const lexical = normalizeRelative(parent === "" ? target : `${parent}/${target}`);
	const escapes = resolved !== undefined ? !within(realRoot, resolved) : lexical === ".." || lexical.startsWith("../");
	if (escapes) {
		throw seedError(
			"ERR_SEED_SYMLINK_ESCAPE",
			linkPath,
			`symlink target "${target}" resolves outside the fixture directory`,
		);
	}
	return target;
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
 *   absolute target, a target the host resolves outside the directory, or a
 *   dangling target that escapes it lexically. Nothing outside the directory
 *   is read. The directory argument itself may be a link; it is resolved once.
 * - **Modes** are copied only with `modes: true`; mtimes never are (they
 *   differ per checkout, and a seed's times are the volume clock's).
 * - **A file over `maxFileBytes`** (16 MiB by default) throws `EFBIG`, checked
 *   from `lstat` before the read.
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
					// A copy, not node's Buffer: a small Buffer is a view into a shared
					// pool, and the seed must own exactly these bytes.
					const content = new Uint8Array(NFS.readFileSync(realPath));
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
