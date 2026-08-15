/**
 * In-memory implementation of Effect's `FileSystem` service: an isolated
 * virtual POSIX filesystem for tests and programs that need filesystem
 * behavior without host filesystem IO.
 *
 * Provide `MemoryFileSystem.layer` — or `MemoryFileSystem.layerWith` with a
 * `path → content` seed — in place of a host-backed filesystem, and any
 * program requiring `FileSystem.FileSystem` runs against it unchanged. Reads
 * of paths nothing seeded fail typed with `NotFound`; the volume never
 * fabricates content.
 *
 * The engine is a vendored port with attribution of Effect-TS/effect PR #6573
 * (pinned `c0528bd5`); see the package design doc for the adaptation ledger.
 *
 * @packageDocumentation
 */

export { MemoryFileSystem, type MemoryFileSystemSeed } from "./MemoryFileSystem.js";
