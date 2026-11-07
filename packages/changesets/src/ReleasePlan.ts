import { posix } from "node:path";
import { GlobPattern } from "@effected/glob";
import type { InvalidVersionError } from "@effected/semver";
import { Range, SemVer } from "@effected/semver";
import type { WorkspaceRootNotFoundError } from "@effected/workspaces";
import { WorkspaceDiscovery, WorkspaceDiscoveryError, WorkspacePackage } from "@effected/workspaces";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Result, Schema } from "effect";
import type { BumpType, ReleaseType } from "./BumpType.js";
import { ChangesetConfig } from "./ChangesetConfig.js";
import { UnknownPackageError, UnsupportedChangesetModeError } from "./errors.js";
import type { PendingChangeset } from "./PendingChangesets.js";
import { PendingChangesets } from "./PendingChangesets.js";

const DEPENDENCY_KINDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

const RANK: Record<ReleaseType, number> = { none: 0, patch: 1, minor: 2, major: 3 };

/** A release while the plan is being assembled; only a `none` entry can lack a version. */
interface Draft {
	readonly name: string;
	readonly type: ReleaseType;
	readonly oldVersion: string | undefined;
	readonly newVersion: string | undefined;
	readonly changesets: ReadonlyArray<string>;
}

const WORKSPACE = /^workspace:/;

const parseRange = (specifier: string): Range | undefined =>
	specifier.includes(":") ? undefined : Result.getOrUndefined(Range.parseResult(specifier));

const pointsAt = (specifier: string, dependency: WorkspacePackage): boolean =>
	posix.normalize(specifier) === dependency.relativePath;

/** The specifier that decides an edge: the last kind naming the dependency, link and file devDependencies aside. */
const edgeSpecifiers = (dependent: WorkspacePackage): ReadonlyMap<string, string> => {
	const specifiers = new Map<string, string>();
	for (const kind of DEPENDENCY_KINDS) {
		for (const [name, specifier] of Object.entries(dependent[kind])) {
			if (kind === "devDependencies" && (specifier.startsWith("link:") || specifier.startsWith("file:"))) continue;
			specifiers.set(name, specifier);
		}
	}
	return specifiers;
};

const isEdge = (specifier: string, dependency: WorkspacePackage, workspaceProtocolOnly: boolean): boolean => {
	const isWorkspace = WORKSPACE.test(specifier);
	const bare = specifier.replace(WORKSPACE, "");
	if (isWorkspace) {
		if (bare === "*" || bare === "^" || bare === "~" || pointsAt(bare, dependency)) return true;
	} else if (workspaceProtocolOnly) {
		return false;
	}
	const range = parseRange(bare);
	if (range === undefined || dependency.version === undefined) return false;
	const current = Result.getOrUndefined(SemVer.parseResult(dependency.version));
	return current !== undefined && Range.satisfies(current, range);
};

const dependentsByName = (
	packages: ReadonlyArray<WorkspacePackage>,
	workspaceProtocolOnly: boolean,
): ReadonlyMap<string, ReadonlyArray<WorkspacePackage>> => {
	const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
	const dependents = new Map<string, Array<WorkspacePackage>>();
	for (const dependent of packages) {
		for (const [name, specifier] of edgeSpecifiers(dependent)) {
			const dependency = byName.get(name);
			if (dependency === undefined || !isEdge(specifier, dependency, workspaceProtocolOnly)) continue;
			dependents.set(name, [...(dependents.get(name) ?? []), dependent]);
		}
	}
	return dependents;
};

/** Every declared range on `dependency`, per kind, resolved against its current version. */
const declaredRanges = (
	dependent: WorkspacePackage,
	dependency: WorkspacePackage,
	oldVersion: string,
): ReadonlyArray<readonly [DependencyKind, string]> => {
	const ranges: Array<readonly [DependencyKind, string]> = [];
	for (const kind of DEPENDENCY_KINDS) {
		const declared = Object.hasOwn(dependent[kind], dependency.name) ? dependent[kind][dependency.name] : "";
		if (declared === "") continue;
		if (!WORKSPACE.test(declared)) {
			ranges.push([kind, declared]);
			continue;
		}
		const bare = declared.replace(WORKSPACE, "");
		if (bare === "*") ranges.push([kind, oldVersion]);
		else if (bare === "^" || bare === "~") ranges.push([kind, `${bare}${oldVersion}`]);
		else if (parseRange(bare) !== undefined) ranges.push([kind, bare]);
		else if (pointsAt(bare, dependency)) ranges.push([kind, oldVersion]);
	}
	return ranges;
};

const satisfies = (version: string, specifier: string): boolean => {
	const range = parseRange(specifier);
	const parsed = Result.getOrUndefined(SemVer.parseResult(version));
	return range !== undefined && parsed !== undefined && Range.satisfies(parsed, range);
};

const rippleType = (
	dependent: WorkspacePackage,
	dependency: WorkspacePackage,
	release: Draft,
	alwaysRipple: boolean,
): "patch" | "none" | undefined => {
	if (release.type === "none" || release.oldVersion === undefined || release.newVersion === undefined) return undefined;
	let type: "patch" | "none" | undefined;
	for (const [kind, specifier] of declaredRanges(dependent, dependency, release.oldVersion)) {
		if (!alwaysRipple && satisfies(release.newVersion, specifier)) continue;
		if (kind !== "devDependencies") type = "patch";
		else if (type === undefined) type = "none";
	}
	return type;
};

/**
 * `semver.inc`'s rule, which `SemVerBump` deliberately does not follow: a bump
 * a prerelease is already heading for completes it rather than incrementing.
 */
const increment = (version: SemVer, type: BumpType): SemVer => {
	const completes =
		version.prerelease.length > 0 &&
		(type === "patch" || (version.patch === 0 && (type === "minor" || version.minor === 0)));
	return completes ? SemVer.truncate(version, "prerelease") : version.bump[type]();
};

const bump = (
	version: string | undefined,
	type: ReleaseType,
): Result.Result<string | undefined, InvalidVersionError> =>
	type === "none" || version === undefined
		? Result.succeed(version)
		: Result.map(SemVer.parseResult(version), (parsed) => increment(parsed, type).toString());

const ignoredNames = (
	packages: ReadonlyArray<WorkspacePackage>,
	patterns: ReadonlyArray<string>,
): ReadonlySet<string> => {
	const matchers = patterns.map((source) => {
		const negated = source.startsWith("!");
		const glob = negated ? source.slice(1) : source;
		const compiled = Result.getOrUndefined(GlobPattern.compileResult(glob));
		return { negated, matches: (name: string) => compiled?.matches(name) ?? name === glob };
	});
	const ignored = new Set<string>();
	for (const { name } of packages) {
		let passed = false;
		for (const { negated, matches } of matchers) {
			if (!passed && !negated && matches(name)) passed = true;
			else if (passed && negated && matches(name)) passed = false;
		}
		if (passed) ignored.add(name);
	}
	return ignored;
};

const unsafeOption = (config: ChangesetConfig, key: string): unknown => {
	const options = config.extra.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH;
	return typeof options === "object" && options !== null ? (options as Record<string, unknown>)[key] : undefined;
};

const LoneManifest = Schema.Struct({
	name: Schema.NonEmptyString,
	version: Schema.optionalKey(Schema.String),
	private: Schema.optionalKey(Schema.Boolean),
});

/** The package of a repository with no workspace file, which discovery has no root for. */
const readLonePackage = Effect.fnUntraced(function* (root: string, notFound: WorkspaceRootNotFoundError) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const packageJsonPath = path.join(root, "package.json");
	const text = yield* fs
		.readFileString(packageJsonPath)
		.pipe(
			Effect.catch(
				(error): Effect.Effect<never, WorkspaceRootNotFoundError | PlatformError.PlatformError> =>
					error.reason._tag === "NotFound" ? Effect.fail(notFound) : Effect.fail(error),
			),
		);
	const invalid = (kind: "invalidJson" | "invalidShape") => (cause: unknown) =>
		new WorkspaceDiscoveryError({ root, path: packageJsonPath, kind, cause });
	const json = yield* Effect.try({ try: () => JSON.parse(text) as unknown, catch: invalid("invalidJson") });
	const manifest = yield* Schema.decodeUnknownEffect(LoneManifest)(json).pipe(Effect.mapError(invalid("invalidShape")));
	return [
		WorkspacePackage.make({ ...manifest, path: root, packageJsonPath, relativePath: ".", workspaceRoot: root }),
	] as ReadonlyArray<WorkspacePackage>;
});

/**
 * One package's place in a {@link ReleasePlan}.
 *
 * @public
 */
export class PlannedRelease extends Schema.Class<PlannedRelease>("PlannedRelease")({
	/** The package name. */
	name: Schema.String,
	/** The bump, or `none` for a listed package whose version does not move. */
	type: Schema.Literals(["patch", "minor", "major", "none"]),
	/** The version in the workspace now. */
	oldVersion: Schema.String,
	/** The version after the release; equal to `oldVersion` when `type` is `none`. */
	newVersion: Schema.String,
	/** The changeset files naming the package; empty for a package reached only as a dependent. */
	changesets: Schema.Array(Schema.String),
}) {}

/**
 * What a set of pending changesets releases: the packages they name and the
 * packages reached as dependents, sorted by name. A package neither named nor
 * reached is absent.
 *
 * @remarks
 * `@changesets/get-release-plan` is the authority on these rules, and
 * `__test__/ReleasePlan.oracle.test.ts` holds this class to it. Its rules are
 * not all the obvious ones:
 *
 * - A dependent bumps `patch` whatever `updateInternalDependencies` says. That
 *   option decides which ranges `changeset version` rewrites, not the bump.
 * - An edge exists only for `workspace:*`, `workspace:^`, `workspace:~`, a
 *   `workspace:` path to the dependency, or a range the dependency's current
 *   version satisfies. `catalog:`, `link:`, `npm:` and an already-missed range
 *   draw no edge, so they never ripple. When several kinds name a dependency
 *   the last of `dependencies`, `devDependencies`, `peerDependencies`,
 *   `optionalDependencies` decides the edge, and a `link:` or `file:`
 *   devDependency is not considered.
 * - Once an edge exists every kind naming the dependency is checked: one
 *   unsatisfied non-dev range bumps `patch`; only unsatisfied devDependency
 *   ranges list the package as `none`.
 * - A changeset may name a package `none`. It is listed as `none` unless another changeset or a ripple gives it a
 *   real bump, and it ripples nothing.
 * - A skipped package is ignored, private while `privatePackages.version` is
 *   off (its default), or version-less. Naming one in a changeset does nothing, and it never
 *   bumps, but it is still listed as `none` when it depends on anything in the
 *   plan, whether or not the range holds, and it carries that listing onward
 *   to its own skipped dependents. A `none` entry bumps nothing: its version
 *   does not move, so no range on it is checked, even with
 *   `updateInternalDependents` set to `always`.
 * - `ignore` entries are globs over the workspace's names, with `!` negation
 *   applying in order.
 * - A bump a prerelease is already heading for completes it, as `semver.inc`
 *   does: a `major` of `2.0.0-rc.1` is `2.0.0`, where `SemVerBump` answers
 *   `3.0.0`.
 * - The options `bumpVersionsWithWorkspaceProtocolOnly` and
 *   `___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH.updateInternalDependents`
 *   are honoured from the config's `extra`.
 *
 * One deliberate difference: a version-less package is not listed at all, where
 * the oracle lists it with no versions, because a {@link PlannedRelease} states
 * versions.
 *
 * @public
 */
export class ReleasePlan extends Schema.Class<ReleasePlan>("ReleasePlan")({
	/** The planned releases, sorted by package name. */
	releases: Schema.Array(PlannedRelease),
}) {
	/**
	 * Assemble the plan from packages, changesets and a config, with no IO.
	 *
	 * Fails with {@link UnknownPackageError} when a changeset names a package
	 * `packages` lacks, with `InvalidVersionError` when a package that must bump
	 * has a version that is not semver, and with
	 * {@link UnsupportedChangesetModeError} when a `fixed` or `linked` group is
	 * non-empty. What the oracle rejects outright and this does not check is
	 * planned, not refused: a changeset mixing skipped and released packages, a
	 * public package depending on a skipped one, and `privatePackages` with `tag`
	 * on and `version` off.
	 *
	 * @param input - The packages to plan, the pending changesets and the
	 * config. {@link ReleasePlan.read} decides whether the workspace root is one
	 * of the packages.
	 */
	static assemble(input: {
		readonly packages: ReadonlyArray<WorkspacePackage>;
		readonly changesets: ReadonlyArray<PendingChangeset>;
		readonly config: ChangesetConfig;
	}): Result.Result<ReleasePlan, UnknownPackageError | UnsupportedChangesetModeError | InvalidVersionError> {
		const { packages, changesets, config } = input;
		if (config.fixed.some((group) => group.length > 0)) {
			return Result.fail(new UnsupportedChangesetModeError({ mode: "fixed" }));
		}
		if (config.linked.some((group) => group.length > 0)) {
			return Result.fail(new UnsupportedChangesetModeError({ mode: "linked" }));
		}

		const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
		const ignored = ignoredNames(packages, config.ignore);
		const isSkipped = (pkg: WorkspacePackage): boolean =>
			ignored.has(pkg.name) || (pkg.private && !config.privatePackages.version) || pkg.version === undefined;

		const named = new Map<string, { type: ReleaseType; files: Array<string> }>();
		for (const changeset of changesets) {
			for (const [name, type] of changeset.releases) {
				const pkg = byName.get(name);
				if (pkg === undefined) {
					return Result.fail(new UnknownPackageError({ packageName: name, changeset: changeset.file }));
				}
				if (isSkipped(pkg)) continue;
				const entry = named.get(name);
				if (entry === undefined) named.set(name, { type, files: [changeset.file] });
				else {
					entry.files.push(changeset.file);
					if (RANK[type] > RANK[entry.type]) entry.type = type;
				}
			}
		}

		const drafts = new Map<string, Draft>();
		const draft = (
			pkg: WorkspacePackage,
			type: ReleaseType,
			files: ReadonlyArray<string>,
		): Result.Result<Draft, InvalidVersionError> =>
			Result.map(bump(pkg.version, type), (newVersion) => {
				const entry = { name: pkg.name, type, oldVersion: pkg.version, newVersion, changesets: files };
				drafts.set(pkg.name, entry);
				return entry;
			});

		const queue: Array<Draft> = [];
		for (const [name, { type, files }] of named) {
			const created = draft(byName.get(name) as WorkspacePackage, type, files);
			if (Result.isFailure(created)) return Result.fail(created.failure);
			queue.push(created.success);
		}

		const alwaysRipple = unsafeOption(config, "updateInternalDependents") === "always";
		const dependents = dependentsByName(packages, config.extra.bumpVersionsWithWorkspaceProtocolOnly === true);
		for (let release = queue.shift(); release !== undefined; release = queue.shift()) {
			const dependency = byName.get(release.name) as WorkspacePackage;
			for (const dependent of dependents.get(release.name) ?? []) {
				const existing = drafts.get(dependent.name);
				let type: "patch" | "none" | undefined;
				if (isSkipped(dependent)) type = "none";
				else if (existing === undefined || existing.type === "none") {
					type = rippleType(dependent, dependency, release, alwaysRipple);
				}
				if (type === undefined || existing?.type === type) continue;
				const created = draft(dependent, type, []);
				if (Result.isFailure(created)) return Result.fail(created.failure);
				queue.push(created.success);
			}
		}

		const releases: Array<PlannedRelease> = [];
		for (const { name, type, oldVersion, newVersion, changesets: files } of drafts.values()) {
			if (oldVersion === undefined || newVersion === undefined) continue;
			releases.push(PlannedRelease.make({ name, type, oldVersion, newVersion, changesets: files }));
		}
		releases.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		return Result.succeed(ReleasePlan.make({ releases }));
	}

	/**
	 * Discover the workspace's packages, read its config and pending changesets,
	 * and {@link ReleasePlan.assemble | assemble} the plan.
	 *
	 * `root` decides all three, whatever directory the `WorkspaceDiscovery` layer
	 * was built from. The workspace root package is left out while other packages
	 * exist. When there are none it is the package and is planned, including when
	 * `root` has only a `package.json` and no workspace file. The oracle refuses
	 * `packages: []` and patterns that match nothing; here they plan the root too,
	 * because discovery reports them the same way. A root listed in `packages:`
	 * alongside others stays out, where the oracle plans it. A root with a
	 * catalog-only workspace file answers for itself, where the oracle climbs to
	 * any enclosing workspace.
	 *
	 * @param root - The repository root.
	 */
	static readonly read = Effect.fn("ReleasePlan.read")(function* (root: string) {
		const discovery = yield* WorkspaceDiscovery;
		const discovered = yield* discovery
			.listPackagesIn(root)
			.pipe(Effect.catchTag("WorkspaceRootNotFoundError", (error) => readLonePackage(root, error)));
		const config = yield* ChangesetConfig.read(root);
		const changesets = yield* PendingChangesets.read(root);
		const members = discovered.filter((pkg) => !pkg.isRootWorkspace);
		const packages = members.length > 0 ? members : discovered;
		return yield* Effect.fromResult(ReleasePlan.assemble({ packages, changesets, config }));
	});
}
