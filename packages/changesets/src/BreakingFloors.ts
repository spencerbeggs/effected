import type { InvalidVersionError } from "@effected/semver";
import { SemVer } from "@effected/semver";
import type { WorkspacePackage } from "@effected/workspaces";
import { Result, Schema } from "effect";
import type { BumpType } from "./BumpType.js";
import type { ChangesetConfig } from "./ChangesetConfig.js";
import type { MissingPackageError } from "./errors.js";
import { WORKSPACE, cleanVersion, parseRange, satisfies } from "./internal/versions.js";
import type { EditsPlan } from "./ReleaseEdits.js";
import { computeEdits } from "./ReleaseEdits.js";

/**
 * The one manifest field whose floor can strand a consumer. A regular or optional dependency is
 * installed for the dependent alone, so a newer one nests beside the consumer's; a peer binds to
 * the consumer's copy, and that copy may be on the old line.
 */
const RUNTIME_KINDS = ["peerDependencies"] as const;

/**
 * One dependency whose breaking release moves a dependent's published floor.
 *
 * @public
 */
export class FloorCause extends Schema.Class<FloorCause>("FloorCause")({
	/** The manifest field naming the dependency. */
	kind: Schema.Literals(RUNTIME_KINDS),
	/** The dependency's package name. */
	dependency: Schema.String,
	/** The dependency's version now. */
	oldVersion: Schema.String,
	/** The dependency's version after the release, on a new breaking line. */
	newVersion: Schema.String,
	/** The range the dependent publishes on the dependency, which no longer admits `oldVersion`. */
	range: Schema.String,
}) {}

/**
 * A release that stays on its own breaking line while a range it publishes
 * crosses a dependency's breaking line: a consumer on the old line of both
 * would resolve this release and miss what it now requires.
 *
 * @public
 */
export class BreakingFloor extends Schema.Class<BreakingFloor>("BreakingFloor")({
	/** The dependent's package name. */
	name: Schema.String,
	/** The bump the plan gives it. */
	type: Schema.Literals(["patch", "minor", "major"]),
	/** Its version now. */
	oldVersion: Schema.String,
	/** The version the plan gives it, on the same breaking line as `oldVersion`. */
	newVersion: Schema.String,
	/** The smallest bump that moves it to a new breaking line. */
	required: Schema.Literals(["patch", "minor", "major"]),
	/** Every dependency whose floor it crosses, sorted by name. */
	causes: Schema.Array(FloorCause),
}) {}

const parse = (version: string): SemVer | undefined => Result.getOrUndefined(SemVer.parseResult(cleanVersion(version)));

/**
 * The caret line a version sits on: `1` for `1.4.2`, `0.4` for `0.4.2`,
 * `0.0.4` for `0.0.4`. Two versions on one line are caret-compatible, so a
 * release that changes the line is breaking.
 */
const line = (version: SemVer): string =>
	version.major > 0 ? `${version.major}` : version.minor > 0 ? `0.${version.minor}` : `0.0.${version.patch}`;

/** The smallest bump that leaves `version`'s caret line. */
const leaveLine = (version: SemVer): BumpType => (version.major > 0 ? "major" : version.minor > 0 ? "minor" : "patch");

/**
 * The range `pnpm publish` writes for a specifier as `changeset version`
 * leaves it, once the dependency is at `newVersion`; `undefined` when it is
 * not a range at all. `workspace:*` and a `workspace:` path publish the exact
 * version, `workspace:^` and `workspace:~` the operator before it, and a
 * `workspace:<range>` or a literal range publishes as written.
 */
const publishedRange = (specifier: string, newVersion: string): string | undefined => {
	if (WORKSPACE.test(specifier)) {
		const bare = specifier.replace(WORKSPACE, "");
		if (bare === "*") return newVersion;
		if (bare === "^" || bare === "~") return `${bare}${newVersion}`;
		if (parseRange(bare) !== undefined) return bare;
		return newVersion;
	}
	return parseRange(specifier) === undefined ? undefined : specifier;
};

/** @internal */
export const computeBreakingFloors = (
	plan: EditsPlan,
	packages: ReadonlyArray<WorkspacePackage>,
	config: ChangesetConfig,
): Result.Result<ReadonlyArray<BreakingFloor>, MissingPackageError | InvalidVersionError> => {
	// Every range as `changeset version` writes it: a range the new version
	// leaves is rewritten, and so is a held one unless the config holds peers.
	const edits = computeEdits(plan, { packages, config });
	if (Result.isFailure(edits)) return Result.fail(edits.failure);
	const written = new Map<string, string>();
	for (const manifest of edits.success.manifests) {
		for (const edit of manifest.ranges) {
			if (edit.kind === "peerDependencies") written.set(`${manifest.name}\0${edit.dependency}`, edit.to);
		}
	}
	const { releases } = plan;
	const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
	// A breaking release, keyed by name, read from each package's own version:
	// a linked member's `oldVersion` is its group's, not what consumers hold.
	const breaking = new Map<string, { readonly oldVersion: string; readonly newVersion: string }>();
	for (const release of releases) {
		const current = byName.get(release.name)?.version;
		const from = current === undefined ? undefined : parse(current);
		const to = parse(release.newVersion);
		if (release.type === "none" || from === undefined || to === undefined) continue;
		if (line(from) !== line(to))
			breaking.set(release.name, { oldVersion: current ?? "", newVersion: release.newVersion });
	}
	const floors: Array<BreakingFloor> = [];
	for (const release of releases) {
		if (release.type === "none" || breaking.has(release.name)) continue;
		const pkg = byName.get(release.name);
		const from = pkg?.version === undefined ? undefined : parse(pkg.version);
		if (pkg === undefined || from === undefined) continue;
		const causes: Array<FloorCause> = [];
		for (const kind of RUNTIME_KINDS) {
			for (const [dependency, specifier] of Object.entries(pkg[kind])) {
				const moved = breaking.get(dependency);
				if (moved === undefined) continue;
				const range = publishedRange(written.get(`${release.name}\0${dependency}`) ?? specifier, moved.newVersion);
				if (range === undefined || satisfies(moved.oldVersion, range)) continue;
				causes.push(FloorCause.make({ kind, dependency, ...moved, range }));
			}
		}
		if (causes.length === 0) continue;
		causes.sort((a, b) => (a.dependency < b.dependency ? -1 : a.dependency > b.dependency ? 1 : 0));
		floors.push(
			BreakingFloor.make({
				name: release.name,
				type: release.type,
				oldVersion: pkg.version ?? "",
				newVersion: release.newVersion,
				required: leaveLine(from),
				causes,
			}),
		);
	}
	return Result.succeed(floors);
};
