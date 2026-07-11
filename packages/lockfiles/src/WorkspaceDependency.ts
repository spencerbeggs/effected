import { Schema } from "effect";

/**
 * Which dependency map a lockfile row or manifest constraint came from.
 *
 * @remarks
 * Shared by `WorkspaceDependency.depType` and the
 * `LockfileIntegrity.unsatisfiedConstraints` rows; consumers branch on it.
 *
 * @public
 */
export const DependencyType = Schema.Literals([
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
]);

/**
 * The union of dependency map names.
 *
 * @public
 */
export type DependencyType = typeof DependencyType.Type;

/**
 * A directed dependency edge between two workspace packages as recorded in
 * the lockfile.
 *
 * @remarks
 * - `from` — the workspace package declaring the dependency. For pnpm this
 *   is the importer path until `Lockfile#withImporterNames` rewrites it.
 * - `to` — the workspace package depended upon.
 * - `depType` — which dependency map holds the edge.
 * - `constraint` — the declared specifier (e.g. `"workspace:*"`, `"^1.0.0"`).
 *
 * @public
 */
export class WorkspaceDependency extends Schema.Class<WorkspaceDependency>("WorkspaceDependency")({
	from: Schema.NonEmptyString,
	to: Schema.NonEmptyString,
	depType: DependencyType,
	constraint: Schema.String,
}) {}
