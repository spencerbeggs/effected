/**
 * In-memory implementation of Effect's `FileSystem` service: an isolated
 * virtual POSIX filesystem for tests and programs that need filesystem
 * behavior without host filesystem IO.
 *
 * Provide `MemoryFileSystem.layer` — or `MemoryFileSystem.layerWith` with a
 * seed describing files, directories, symlinks and initial modes — in place of
 * a host-backed filesystem, and any program requiring `FileSystem.FileSystem`
 * runs against it unchanged. Reads of paths nothing seeded fail typed with
 * `NotFound`; the volume never fabricates content. Permission modes are
 * recorded and readable via `stat` but never enforced on any operation — to
 * exercise permission-failure paths, inject faults with
 * `MemoryFileSystem.layerFaulty`, a delegate-by-default wrapper over any
 * `FileSystem` implementation.
 *
 * The engine is a vendored port with attribution of Effect-TS/effect PR #6573
 * (pinned `c0528bd5`); see the package design doc for the adaptation ledger.
 * The seeding and fault-injection APIs are kit extensions.
 *
 * @packageDocumentation
 */

export {
	MemoryFileSystem,
	type MemoryFileSystemFaultHandler,
	type MemoryFileSystemFaultMethod,
	type MemoryFileSystemFaults,
	type MemoryFileSystemSeed,
	type MemoryFileSystemSeedDirectory,
	type MemoryFileSystemSeedEntry,
	type MemoryFileSystemSeedFile,
	type MemoryFileSystemSeedSymlink,
	type MemoryFileSystemTransientFault,
} from "./MemoryFileSystem.js";
