/**
 * Pure lockfile parsing for all four package-manager formats — bun
 * (`bun.lock`), npm (`package-lock.json` v2/v3), pnpm (`pnpm-lock.yaml`)
 * and yarn Berry (`yarn.lock`) — normalized into one unified `Lockfile`
 * model, plus pure integrity checking of that model against workspace
 * manifests.
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
export { Lockfile, LockfileFramingError, LockfileParseError } from "./Lockfile.js";
export { LockfileFormat, filenameFor, fromFilename } from "./LockfileFormat.js";
export { LockfileIntegrity, WorkspaceManifest } from "./LockfileIntegrity.js";
export { type PnpmCatalogs, PnpmExtension } from "./PnpmExtension.js";
export { ResolvedPackage } from "./ResolvedPackage.js";
export { DependencyType, WorkspaceDependency } from "./WorkspaceDependency.js";
