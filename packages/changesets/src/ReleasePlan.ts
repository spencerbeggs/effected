import { posix } from "node:path";
import { GlobPattern } from "@effected/glob";
import { InvalidVersionError, Range, SemVer } from "@effected/semver";
import type { WorkspaceRootNotFoundError } from "@effected/workspaces";
import { WorkspaceDiscovery, WorkspaceDiscoveryError, WorkspacePackage } from "@effected/workspaces";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import type { BumpType, ReleaseType } from "./BumpType.js";
import { ChangesetConfig } from "./ChangesetConfig.js";
import { ChangesetConfigError, UnknownPackageError } from "./errors.js";
import { PendingChangeset, PendingChangesets } from "./PendingChangesets.js";
import { PreState } from "./PreState.js";

const DEPENDENCY_KINDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

const RANK: Record<ReleaseType, number> = { none: 0, patch: 1, minor: 2, major: 3 };

/**
 * A release while the plan is being assembled, mutated in place as the
 * oracle mutates its own: a fixed or linked group rewrites `type` and
 * `oldVersion` of a release already queued for its dependents.
 */
interface Draft {
	readonly name: string;
	type: ReleaseType;
	oldVersion: string | undefined;
	readonly changesets: ReadonlyArray<string>;
}

/** Ends assembly with a typed failure from inside the fixpoint loop; never escapes `assemble`. */
class Halt {
	constructor(readonly failure: UnknownPackageError | ChangesetConfigError | InvalidVersionError) {}
}

/**
 * A package version as node-semver reads one without `loose`: surrounding
 * whitespace and a single leading `v` are dropped, so `v1.0.0` is `1.0.0`. Any
 * other prefix, `=1.2.0` among them, stays and fails to parse.
 */
const cleanVersion = (version: string): string => {
	const trimmed = version.trim();
	return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
};

const parseVersion = (version: string): SemVer => {
	const parsed = SemVer.parseResult(cleanVersion(version));
	if (Result.isFailure(parsed)) throw new Halt(parsed.failure);
	return parsed.success;
};
const WORKSPACE = /^workspace:/;

/** A range, also as node-semver reads a `v` before a version in one: `^v1.0.0` is `^1.0.0`. */
const parseRange = (specifier: string): Range | undefined => {
	if (specifier.includes(":")) return undefined;
	const parsed = Range.parseResult(specifier);
	if (Result.isSuccess(parsed)) return parsed.success;
	return Result.getOrUndefined(Range.parseResult(specifier.replace(/(^|[\s^~<>=])v(?=\d)/g, "$1")));
};

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
	const current = Result.getOrUndefined(SemVer.parseResult(cleanVersion(dependency.version)));
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
	rawOldVersion: string,
): ReadonlyArray<readonly [DependencyKind, string]> => {
	const oldVersion = cleanVersion(rawOldVersion);
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
	const parsed = Result.getOrUndefined(SemVer.parseResult(cleanVersion(version)));
	return range !== undefined && parsed !== undefined && Range.satisfies(parsed, range);
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

/** The workspace's names a list of globs selects, `!` negation applying in order, in workspace order. */
const matchNames = (
	packages: ReadonlyArray<WorkspacePackage>,
	patterns: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	const matchers = patterns.map((source) => {
		const negated = source.startsWith("!");
		const glob = negated ? source.slice(1) : source;
		const compiled = Result.getOrUndefined(GlobPattern.compileResult(glob));
		return { negated, matches: (name: string) => compiled?.matches(name) ?? name === glob };
	});
	const selected: Array<string> = [];
	for (const { name } of packages) {
		let passed = false;
		for (const { negated, matches } of matchers) {
			if (!passed && !negated && matches(name)) passed = true;
			else if (passed && negated && matches(name)) passed = false;
		}
		if (passed) selected.push(name);
	}
	return selected;
};

/** The configuration errors `@changesets/config` rejects a fixed or linked group for. */
const groupError = (
	fixed: ReadonlyArray<ReadonlyArray<string>>,
	linked: ReadonlyArray<ReadonlyArray<string>>,
): ChangesetConfigError | undefined => {
	for (const [kind, groups] of [
		["fixed", fixed],
		["linked", linked],
	] as const) {
		const seen = new Set<string>();
		for (const name of groups.flat()) {
			if (seen.has(name)) {
				return new ChangesetConfigError({ reason: `${name} is in more than one ${kind} group` });
			}
			seen.add(name);
		}
	}
	const inFixed = new Set(fixed.flat());
	const both = linked.flat().find((name) => inFixed.has(name));
	return both === undefined
		? undefined
		: new ChangesetConfigError({ reason: `${both} is in both a fixed and a linked group` });
};

/** `n` in a `-<tag>.<n>` prerelease, plus one: the number the next pre-release takes. */
const nextPreNumber = (version: string): number => {
	const number = parseVersion(version).prerelease[1] ?? -1;
	if (typeof number !== "number") throw new Halt(new InvalidVersionError({ input: version }));
	return number + 1;
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
	/**
	 * The version the bump starts from: the workspace's version now, or for a
	 * member of a fixed or linked group, the group's highest.
	 */
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
 *   applying in order. They are matched by `@effected/glob`, where the oracle
 *   uses picomatch; the two agree on every pattern a package name plausibly
 *   needs (`*`, `?`, `[ab]`, `{a,b}`, `@scope/*`, a leading `!`) and differ
 *   only on exotic ones: `(a|b)` is no group here, `!(a)` is a negation of the
 *   literal `(a)` rather than an extglob, and `x/**` does not match `x`.
 * - A version is read as node-semver reads one: surrounding whitespace and a
 *   single leading `v` are dropped, so `v1.0.0` bumps to `1.0.1` and is still
 *   reported as `v1.0.0`, and a `v` before a version in a range is accepted.
 * - A bump a prerelease is already heading for completes it, as `semver.inc`
 *   does: a `major` of `2.0.0-rc.1` is `2.0.0`, where `SemVerBump` answers
 *   `3.0.0`.
 * - The options `bumpVersionsWithWorkspaceProtocolOnly` and
 *   `___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH.updateInternalDependents`
 *   are honoured from the config's `extra`.
 * - A `fixed` group with any member releasing brings every member that is not
 *   skipped to the group's highest bump, from the group's highest current
 *   version: that is the `oldVersion` each member reports, not its own. A
 *   skipped member never releases, but its version still counts towards the
 *   highest. A `linked` group does the same for only the members that
 *   release. Ripples, `fixed` and `linked` repeat until none changes
 *   anything, so a dependent bumped by a ripple pulls its group along. Group
 *   entries are globs, as `ignore` is. A package in two groups of one kind,
 *   or in both a fixed and a linked group, fails with
 *   {@link ChangesetConfigError}, as the oracle refuses it.
 * - In pre-release mode (a {@link PreState} with `mode: "pre"`) the
 *   changesets under `.changeset/pre/` were consumed by an earlier pre-release
 *   and are left out. Each bumped version gains `-<tag>.<n>`, where `n` is one
 *   more than the number in the package's current `-<tag>.<n>`, or `0` when it
 *   has none, and every member of a fixed or linked group takes the group's
 *   highest `n`. Dependents are checked against that prerelease version, which
 *   a plain range does not admit. In `exit` mode the consumed changesets count
 *   again, no suffix is added, and every package whose version carries a
 *   numbered prerelease bumps at least `patch`; those added bumps reach no
 *   dependent.
 *
 * Deliberate differences, each ruled:
 *
 * - A version-less package is not listed at all, where the oracle lists it
 *   with no versions, because a {@link PlannedRelease} states versions. In a
 *   fixed or linked group it is passed over when the group's highest version
 *   and pre-release number are found; the oracle fails on it.
 * - A prerelease number that is not a number, such as `1.0.0-next.x`, fails
 *   with `InvalidVersionError` in pre-release mode; the oracle throws an
 *   internal error.
 * - A version changesets cannot bump, such as `=1.2.0`, which npm's loose
 *   parse reads but strict `semver.inc` does not, fails with
 *   `InvalidVersionError` wherever it must be read. The oracle crashes on it
 *   in pre mode and in a releasing group, and plans a bump of it with no new
 *   version at all.
 * - A `pre.json` with no `tag`, or with a `mode` other than `pre` or `exit`,
 *   fails {@link PreState.read} with {@link ChangesetConfigError}. The oracle
 *   plans the first with `-undefined.0` suffixes and treats the second as
 *   `pre`, both defects rather than behaviour.
 * - An older-layout `pre.json` that lists consumed changesets by id is
 *   planned as if they were under `.changeset/pre/`, and nothing is written.
 *   The oracle moves them there while it plans, after reading them, so its
 *   first plan counts them in pre mode and every later one does not; versions,
 *   types and changeset ids here are its later plans', so in exit mode a
 *   consumed changeset is named `pre/<file>`, where the oracle moved it,
 *   though it was never moved.
 * - Snapshot versions are not planned. `@changesets/get-release-plan` takes no
 *   snapshot input, so it cannot be the oracle for one, and a snapshot is a
 *   flag on `changeset version`, not a state a repository is in.
 *
 * @public
 */
export class ReleasePlan extends Schema.Class<ReleasePlan>("ReleasePlan")({
	/** The planned releases, sorted by package name. */
	releases: Schema.Array(PlannedRelease),
	/**
	 * The changesets the plan was made from: every pending changeset, less, in
	 * pre mode, those an earlier pre-release consumed. A changelog written from
	 * the plan reads these, so it never re-derives which a pre-release consumed.
	 */
	changesets: Schema.Array(PendingChangeset),
	/** The pre-release state the plan was made in, when the repository has one. */
	preState: Schema.optionalKey(PreState),
}) {
	/**
	 * Assemble the plan from packages, changesets and a config, with no IO.
	 *
	 * Fails with {@link UnknownPackageError} when a changeset names a package
	 * `packages` lacks; with `InvalidVersionError` when a version it must read
	 * is not one node-semver reads, which is the version of a package that
	 * bumps, the versions of a releasing fixed or linked group's members, and,
	 * in pre-release mode, the version of every package not skipped and of every
	 * fixed or linked member; and with
	 * {@link ChangesetConfigError}
	 * when a package is in two fixed groups, two linked groups, or a group of
	 * each. What the oracle rejects outright and this does not check is planned,
	 * not refused: a changeset mixing skipped and released packages, a public
	 * package depending on a skipped one, and `privatePackages` with `tag` on
	 * and `version` off.
	 *
	 * @param input - The packages to plan, the pending changesets, the config
	 * and, in pre-release mode, the {@link PreState}. {@link ReleasePlan.read}
	 * decides whether the workspace root is one of the packages.
	 */
	static assemble(input: {
		readonly packages: ReadonlyArray<WorkspacePackage>;
		readonly changesets: ReadonlyArray<PendingChangeset>;
		readonly config: ChangesetConfig;
		readonly pre?: PreState;
	}): Result.Result<ReleasePlan, UnknownPackageError | ChangesetConfigError | InvalidVersionError> {
		try {
			return Result.succeed(assembleOrHalt(input));
		} catch (error) {
			if (error instanceof Halt) return Result.fail(error.failure);
			throw error;
		}
	}

	/**
	 * Discover the workspace's packages, read its config, pending changesets and
	 * `.changeset/pre.json`, and {@link ReleasePlan.assemble | assemble} the
	 * plan.
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
		const pre = yield* PreState.read(root);
		const members = discovered.filter((pkg) => !pkg.isRootWorkspace);
		const packages = members.length > 0 ? members : discovered;
		return yield* Effect.fromResult(
			ReleasePlan.assemble({ packages, changesets, config, ...(Option.isSome(pre) ? { pre: pre.value } : {}) }),
		);
	});
}

/** The highest of `types`, none of which is `none`. */
const highestType = (types: ReadonlyArray<ReleaseType>): ReleaseType =>
	types.reduce<ReleaseType>((high, type) => (RANK[type] > RANK[high] ? type : high), "none");

/**
 * `@changesets/assemble-release-plan`'s algorithm: flatten the relevant
 * changesets, then ripple to dependents, hold fixed groups together and keep
 * linked groups in step until none of the three changes anything.
 */
const assembleOrHalt = (input: {
	readonly packages: ReadonlyArray<WorkspacePackage>;
	readonly changesets: ReadonlyArray<PendingChangeset>;
	readonly config: ChangesetConfig;
	readonly pre?: PreState;
}): ReleasePlan => {
	const { packages, changesets, config, pre } = input;
	const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
	const ignored = new Set(matchNames(packages, config.ignore));
	const isSkipped = (pkg: WorkspacePackage): boolean =>
		ignored.has(pkg.name) || (pkg.private && !config.privatePackages.version) || pkg.version === undefined;
	const fixed = config.fixed.map((group) => matchNames(packages, group));
	const linked = config.linked.map((group) => matchNames(packages, group));
	const invalid = groupError(fixed, linked);
	if (invalid !== undefined) throw new Halt(invalid);

	for (const changeset of changesets) {
		for (const name of changeset.releases.keys()) {
			if (!byName.has(name)) throw new Halt(new UnknownPackageError({ packageName: name, changeset: changeset.file }));
		}
	}
	// A changeset an older-layout pre.json lists by id is consumed, as if it sat
	// under .changeset/pre/, where the oracle moves it: in exit mode it is named
	// there, as the oracle's later plans name it.
	const consumedIds = new Set(pre?.changesets ?? []);
	const listedConsumed = (file: string): boolean =>
		!file.startsWith("pre/") && consumedIds.has(file.replace(/\.md$/, ""));
	const relevant =
		pre === undefined
			? changesets
			: pre.mode === "pre"
				? changesets.filter((c) => !c.file.startsWith("pre/") && !listedConsumed(c.file))
				: changesets.map((c) => (listedConsumed(c.file) ? PendingChangeset.make({ ...c, file: `pre/${c.file}` }) : c));

	// The pre-release number each package's next version takes, a group sharing its highest.
	const preNumbers = new Map<string, number>();
	if (pre !== undefined) {
		for (const pkg of packages) {
			if (!isSkipped(pkg) && pkg.version !== undefined) preNumbers.set(pkg.name, nextPreNumber(pkg.version));
		}
		for (const group of [...fixed, ...linked]) {
			let highest = 0;
			for (const name of group) {
				const version = byName.get(name)?.version;
				if (version !== undefined) highest = Math.max(highest, nextPreNumber(version));
			}
			for (const name of group) preNumbers.set(name, highest);
		}
	}
	const newVersion = (release: Draft): string | undefined => {
		if (release.type === "none" || release.oldVersion === undefined) return release.oldVersion;
		const next = increment(parseVersion(release.oldVersion), release.type).toString();
		return pre !== undefined && pre.mode === "pre" ? `${next}-${pre.tag}.${preNumbers.get(release.name) ?? 0}` : next;
	};

	const releases = new Map<string, Draft>();
	for (const changeset of relevant) {
		for (const [name, type] of changeset.releases) {
			const pkg = byName.get(name) as WorkspacePackage;
			if (isSkipped(pkg)) continue;
			const release = releases.get(name);
			if (release === undefined) {
				releases.set(name, { name, type, oldVersion: pkg.version, changesets: [changeset.file] });
				continue;
			}
			if (RANK[type] > RANK[release.type]) release.type = type;
			(release.changesets as Array<string>).push(changeset.file);
		}
	}

	const alwaysRipple = unsafeOption(config, "updateInternalDependents") === "always";
	const dependents = dependentsByName(packages, config.extra.bumpVersionsWithWorkspaceProtocolOnly === true);

	const rippleDependents = (): boolean => {
		let updated = false;
		const search = [...releases.values()];
		for (let next = search.shift(); next !== undefined; next = search.shift()) {
			const dependency = byName.get(next.name) as WorkspacePackage;
			const found: Array<readonly [WorkspacePackage, "patch" | "none"]> = [];
			for (const dependent of dependents.get(next.name) ?? []) {
				let type: "patch" | "none" | undefined;
				if (isSkipped(dependent)) type = "none";
				else if (next.type !== "none" && next.oldVersion !== undefined) {
					const existing = releases.get(dependent.name);
					if (existing === undefined || existing.type === "none") {
						const bumped = newVersion(next) as string;
						for (const [kind, range] of declaredRanges(dependent, dependency, next.oldVersion)) {
							if (!alwaysRipple && satisfies(bumped, range)) continue;
							if (kind !== "devDependencies") type = "patch";
							else if (type === undefined) type = "none";
						}
					}
				}
				if (type === undefined || releases.get(dependent.name)?.type === type) continue;
				found.push([dependent, type]);
			}
			for (const [dependent, type] of found) {
				updated = true;
				const release: Draft = { name: dependent.name, type, oldVersion: dependent.version, changesets: [] };
				releases.set(dependent.name, release);
				search.push(release);
			}
		}
		return updated;
	};

	/**
	 * The group's highest current version, as its member writes it (`v1.3.0`
	 * stays `v1.3.0`), over every member with a version; the first of equals wins.
	 */
	const highestVersion = (group: ReadonlyArray<string>): string | undefined => {
		let highest: { readonly parsed: SemVer; readonly written: string } | undefined;
		for (const name of group) {
			const version = byName.get(name)?.version;
			if (version === undefined) continue;
			const parsed = parseVersion(version);
			if (highest === undefined || parsed.gt(highest.parsed)) highest = { parsed, written: version };
		}
		return highest?.written;
	};

	const releasingIn = (group: ReadonlyArray<string>): Array<Draft> =>
		[...releases.values()].filter((release) => group.includes(release.name) && release.type !== "none");

	const holdFixed = (): boolean => {
		let updated = false;
		for (const group of fixed) {
			const releasing = releasingIn(group);
			if (releasing.length === 0) continue;
			const type = highestType(releasing.map((release) => release.type));
			const oldVersion = highestVersion(group);
			for (const name of group) {
				if (isSkipped(byName.get(name) as WorkspacePackage)) continue;
				const release = releases.get(name);
				if (release === undefined) {
					updated = true;
					releases.set(name, { name, type, oldVersion, changesets: [] });
					continue;
				}
				if (release.type !== type) {
					updated = true;
					release.type = type;
				}
				if (release.oldVersion !== oldVersion) {
					updated = true;
					release.oldVersion = oldVersion;
				}
			}
		}
		return updated;
	};

	const keepLinked = (): boolean => {
		let updated = false;
		for (const group of linked) {
			const releasing = releasingIn(group);
			if (releasing.length === 0) continue;
			const type = highestType(releasing.map((release) => release.type));
			const oldVersion = highestVersion(group);
			for (const release of releasing) {
				if (release.type !== type) {
					updated = true;
					release.type = type;
				}
				if (release.oldVersion !== oldVersion) {
					updated = true;
					release.oldVersion = oldVersion;
				}
			}
		}
		return updated;
	};

	for (let settled = false; !settled; ) {
		const rippled = rippleDependents();
		const held = holdFixed();
		settled = !keepLinked() && !rippled && !held;
	}

	if (pre?.mode === "exit") {
		for (const pkg of packages) {
			if (isSkipped(pkg) || (preNumbers.get(pkg.name) ?? 0) === 0) continue;
			const release = releases.get(pkg.name);
			if (release === undefined) {
				releases.set(pkg.name, { name: pkg.name, type: "patch", oldVersion: pkg.version, changesets: [] });
			} else if (release.type === "none") release.type = "patch";
		}
	}

	const planned: Array<PlannedRelease> = [];
	for (const release of releases.values()) {
		const next = newVersion(release);
		if (release.oldVersion === undefined || next === undefined) continue;
		planned.push(
			PlannedRelease.make({
				name: release.name,
				type: release.type,
				oldVersion: release.oldVersion,
				newVersion: next,
				changesets: [...release.changesets],
			}),
		);
	}
	planned.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return ReleasePlan.make({ releases: planned, changesets: relevant, ...(pre === undefined ? {} : { preState: pre }) });
};
