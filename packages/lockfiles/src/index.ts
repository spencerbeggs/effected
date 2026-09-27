/**
 * Pure lockfile parsing for all four package-manager formats — bun
 * (`bun.lock`), npm (`package-lock.json`), pnpm (`pnpm-lock.yaml`)
 * and yarn Berry (`yarn.lock`) — normalized into one unified `Lockfile`
 * model, plus pure integrity checking of that model against workspace
 * manifests.
 *
 * Supported lockfile *format* versions are pnpm `lockfileVersion` 9+ and npm
 * `lockfileVersion` 3+; older formats fail typed rather than parsing into a
 * model that cannot answer resolution questions.
 *
 * `PnpmEnvLockfile.packageManager` reads the package manager a
 * `pnpm-lock.yaml` pins, with its recorded integrity, out of the env preamble
 * document pnpm writes ahead of the lockfile, and
 * `PnpmEnvLockfile.configDependencies` the config dependencies it records,
 * each with its integrity.
 *
 * Every entrypoint takes content as a string; this package performs no IO.
 *
 * @example
 * ```typescript
 * import { Lockfile } from "@effected/lockfiles";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const lockfile = yield* Lockfile.parse(content, { format: "pnpm" });
 *   return lockfile.workspacePackages.length;
 * });
 * ```
 *
 * @packageDocumentation
 */

export { BunExtension } from "./BunExtension.js";
export { ConfigDependencyLock } from "./ConfigDependencyLock.js";
export { ImporterDependency } from "./ImporterDependency.js";
export { Lockfile, LockfileFramingError, LockfileParseError } from "./Lockfile.js";
export { LockfileFormat, filenameFor, filenamesFor, fromFilename } from "./LockfileFormat.js";
export { LockfileImporter } from "./LockfileImporter.js";
export { LockfileIntegrity, WorkspaceManifest } from "./LockfileIntegrity.js";
export { PackageManagerLock } from "./PackageManagerLock.js";
export { PnpmEnvLockfile, type PnpmEnvLockfileReaders } from "./PnpmEnvLockfile.js";
export { type PnpmCatalogs, PnpmExtension } from "./PnpmExtension.js";
export { ResolvedPackage } from "./ResolvedPackage.js";
export { type UnsupportedLockfileVersion, isUnsupportedLockfileVersion } from "./UnsupportedLockfileVersion.js";
export { WorkspaceDependency } from "./WorkspaceDependency.js";
