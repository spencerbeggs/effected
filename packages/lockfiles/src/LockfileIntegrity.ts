import { Range, SemVer } from "@effected/semver";
import { Exit, Schema } from "effect";
import { DEP_TYPES, isWorkspaceSpecifier } from "./internal/shared.js";
import type { Lockfile } from "./Lockfile.js";
import { DependencyType } from "./WorkspaceDependency.js";

/**
 * The minimal manifest shape {@link LockfileIntegrity.compare} checks a
 * lockfile against: a package name plus the four optional dependency maps.
 *
 * @remarks
 * Deliberately *not* a `@effected/package-json` type — this package takes
 * manifests as plain values so its consumers own the manifest IO (and may
 * derive these from any richer model).
 *
 * @public
 */
export class WorkspaceManifest extends Schema.Class<WorkspaceManifest>("WorkspaceManifest")({
	name: Schema.NonEmptyString,
	dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
}) {}

const decodeRange = Schema.decodeUnknownExit(Range.FromString);
const decodeSemVer = Schema.decodeUnknownExit(SemVer.FromString);

/**
 * Result of checking a parsed lockfile against the workspace's declared
 * manifests.
 *
 * @remarks
 * A data type, not an error: it reports *what* mismatches exist without
 * failing anything.
 *
 * - `valid` — `true` when the lockfile is fully consistent.
 * - `missingWorkspaces` — workspace names present in the manifests but
 *   absent from the lockfile.
 * - `extraWorkspaces` — workspace names in the lockfile with no matching
 *   manifest.
 * - `unsatisfiedConstraints` — declared constraints the lockfile's resolved
 *   versions do not satisfy.
 *
 * @public
 */
export class LockfileIntegrity extends Schema.Class<LockfileIntegrity>("LockfileIntegrity")({
	valid: Schema.Boolean,
	missingWorkspaces: Schema.Array(Schema.String),
	extraWorkspaces: Schema.Array(Schema.String),
	unsatisfiedConstraints: Schema.Array(
		Schema.Struct({
			workspace: Schema.String,
			dependency: Schema.String,
			constraint: Schema.String,
			resolved: Schema.String,
			depType: DependencyType,
		}),
	),
}) {
	/**
	 * Check a lockfile's consistency against workspace manifests — a total,
	 * pure function: no Effect, no error channel, no IO.
	 *
	 * @remarks
	 * Constraint checking is best-effort by design: `workspace:` / `link:` /
	 * `file:` specifiers and rows whose range or resolved version does not
	 * parse as SemVer are skipped, exactly as in the v3 implementation. The
	 * caller reads the manifests (this package does no IO). For pnpm, apply
	 * `Lockfile#withImporterNames` first so workspace names align with
	 * manifest names.
	 *
	 * (Named `compare`, not `check`: every v4 `Schema.Class` already carries
	 * a `static check(...checks)` for attaching schema checks, and statics
	 * cannot be shadowed with an incompatible signature.)
	 *
	 * @param lockfile - The parsed lockfile.
	 * @param manifests - The workspace manifests to compare against.
	 * @returns The integrity report.
	 */
	static compare(lockfile: Lockfile, manifests: ReadonlyArray<WorkspaceManifest>): LockfileIntegrity {
		const workspacePackages = lockfile.packages.filter((p) => p.isWorkspace && p.relativePath !== undefined);

		const lockfileWsNames = new Set(workspacePackages.map((p) => p.name));
		const manifestNames = new Set(manifests.map((m) => m.name));
		const missingWorkspaces = [...manifestNames].filter((n) => !lockfileWsNames.has(n));
		const extraWorkspaces = [...lockfileWsNames].filter((n) => !manifestNames.has(n));

		const resolvedIndex = new Map(lockfile.packages.map((p) => [p.name, p.version] as const));

		const unsatisfiedConstraints: Array<{
			workspace: string;
			dependency: string;
			constraint: string;
			resolved: string;
			depType: DependencyType;
		}> = [];

		for (const manifest of manifests) {
			for (const depType of DEP_TYPES) {
				const depMap = manifest[depType];
				if (!depMap) continue;

				for (const [dependency, constraint] of Object.entries(depMap)) {
					if (isWorkspaceSpecifier(constraint)) continue;

					const resolved = resolvedIndex.get(dependency);
					if (resolved === undefined) continue;

					const rangeExit = decodeRange(constraint);
					const versionExit = decodeSemVer(resolved);
					if (Exit.isFailure(rangeExit) || Exit.isFailure(versionExit)) continue; // unparseable rows are skipped

					if (!rangeExit.value.test(versionExit.value)) {
						unsatisfiedConstraints.push({ workspace: manifest.name, dependency, constraint, resolved, depType });
					}
				}
			}
		}

		return LockfileIntegrity.make({
			valid: missingWorkspaces.length === 0 && extraWorkspaces.length === 0 && unsatisfiedConstraints.length === 0,
			missingWorkspaces,
			extraWorkspaces,
			unsatisfiedConstraints,
		});
	}
}
