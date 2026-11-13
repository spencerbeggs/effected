import { Schema } from "effect";
import { ImporterDependency } from "./ImporterDependency.js";

/**
 * One workspace importer's declared dependencies, as the lockfile records them.
 *
 * @remarks
 * - `path` — the importer path relative to the workspace root, `"."` for the
 *   root package (never empty — a `NonEmptyString`) — the same keys as
 *   `WorkspaceDiscovery.importerMap()` in
 *   `@effected/workspaces`. This is the stable join key: `Lockfile#importer`
 *   looks importers up by it, and `Lockfile#withImporterNames` deliberately
 *   leaves importers untouched because the path — not a package name — keys
 *   them.
 * - `dependencies` — each declared dependency as an {@link ImporterDependency}.
 *
 * Populated by every parser: pnpm, bun and npm.
 *
 * @public
 */
export class LockfileImporter extends Schema.Class<LockfileImporter>("LockfileImporter")({
	path: Schema.NonEmptyString,
	dependencies: Schema.Array(ImporterDependency),
}) {}
