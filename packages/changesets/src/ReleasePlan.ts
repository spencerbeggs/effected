import { posix } from "node:path";
import type { VersioningConfig } from "@effected/pnpm";
import { PnpmSettings } from "@effected/pnpm";
import { InvalidVersionError, Range, SemVer } from "@effected/semver";
import type { WorkspaceRootNotFoundError } from "@effected/workspaces";
import { WorkspaceDiscovery, WorkspaceDiscoveryError, WorkspacePackage } from "@effected/workspaces";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import type { BreakingFloor } from "./BreakingFloors.js";
import { computeBreakingFloors } from "./BreakingFloors.js";
import type { ReleaseType } from "./BumpType.js";
import { ChangesetConfig } from "./ChangesetConfig.js";
import type { AmbiguousPackageError, MissingPackageError, VersioningError } from "./errors.js";
import { ChangesetConfigError, SnapshotPreModeError, SnapshotTemplateError, UnknownPackageError } from "./errors.js";
import { planPnpm, projectDir } from "./internal/pnpmPlan.js";
import { twinReleases } from "./internal/twins.js";
import type { DependencyKind } from "./internal/versions.js";
import {
	DEPENDENCY_KINDS,
	WORKSPACE,
	cleanVersion,
	increment,
	matchNames,
	parseRange,
	satisfies,
} from "./internal/versions.js";
import { Ledger } from "./Ledger.js";
import { PendingChangeset, PendingChangesets } from "./PendingChangesets.js";
import { PreState } from "./PreState.js";
import { RegistryVersions } from "./RegistryVersions.js";
import { ReleaseCause, sortCauses } from "./ReleaseCause.js";
import type { ReleaseEdits } from "./ReleaseEdits.js";
import { computeEdits } from "./ReleaseEdits.js";
import type { ReleaseManager } from "./ReleaseManager.js";
import { ReleaseManager as ReleaseManagerSchema } from "./ReleaseManager.js";

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
	/** Why it is in the plan; a ripple replacing the entry replaces these. */
	readonly causes: Set<ReleaseCause>;
}

/** Ends assembly with a typed failure from inside the fixpoint loop; never escapes `assemble`. */
class Halt {
	constructor(readonly failure: AssembleError) {}
}

type AssembleError =
	| UnknownPackageError
	| AmbiguousPackageError
	| ChangesetConfigError
	| InvalidVersionError
	| SnapshotPreModeError
	| SnapshotTemplateError
	| VersioningError;

/**
 * The input for a snapshot plan, `changeset version --snapshot`'s parameters.
 * {@link ReleasePlan.assemble} documents how each is read.
 *
 * @public
 */
export interface ReleaseSnapshot {
	/** The snapshot's name, `--snapshot <tag>`. An empty string is no tag. */
	readonly tag?: string | undefined;
	/** The commit `{commit}` and `{commit-short}` fill in. An empty string is no commit. */
	readonly commit?: string | undefined;
	/** The moment `{timestamp}` and `{datetime}` are taken from, so assembly reads no clock. */
	readonly timestamp: Date;
	/** Overrides the config's `snapshot.useCalculatedVersion` when set. */
	readonly useCalculatedVersion?: boolean | undefined;
	/** Overrides the config's `snapshot.prereleaseTemplate` when set; an empty string is the default suffix. */
	readonly prereleaseTemplate?: string | undefined;
}

/** The placeholders in the order the oracle fills them, each pass over the previous one's output. */
const PLACEHOLDERS = ["commit", "commit-short", "tag", "timestamp", "datetime"] as const;

/**
 * `@changesets/assemble-release-plan`'s `getSnapshotSuffix`, with the clock
 * read replaced by `snapshot.timestamp`. `tag` and `commit` arrive with `""`
 * already turned into `undefined`.
 */
const snapshotSuffix = (
	template: string | undefined,
	tag: string | undefined,
	commit: string | undefined,
	timestamp: Date,
): string => {
	const values: Record<(typeof PLACEHOLDERS)[number], string | undefined> = {
		commit,
		"commit-short": commit?.slice(0, 7),
		tag,
		timestamp: timestamp.getTime().toString(),
		datetime: timestamp
			.toISOString()
			.replace(/\.\d{3}Z$/, "")
			.replace(/[^\d]/g, ""),
	};
	if (template === undefined || template === "") return [values.tag, values.datetime].filter(Boolean).join("-");
	if (!template.includes("{tag}") && tag !== undefined) {
		throw new Halt(new SnapshotTemplateError({ template, placeholder: "tag", kind: "missingPlaceholder" }));
	}
	let filled = template;
	for (const key of PLACEHOLDERS) {
		filled = filled.replaceAll(`{${key}}`, () => {
			const value = values[key];
			if (value === undefined) {
				throw new Halt(
					new SnapshotTemplateError({
						template,
						placeholder: key as "commit" | "commit-short" | "tag",
						kind: "missingValue",
					}),
				);
			}
			return value;
		});
	}
	return filled;
};

const parseVersion = (version: string): SemVer => {
	const parsed = SemVer.parseResult(cleanVersion(version));
	if (Result.isFailure(parsed)) throw new Halt(parsed.failure);
	return parsed.success;
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

/**
 * The package of a repository with no workspace file, which discovery has no
 * root for: the nearest `package.json` at or above `directory`, where the
 * oracle's `@manypkg/find-root` falls back to when it finds no monorepo.
 */
const readLonePackage = Effect.fnUntraced(function* (directory: string, notFound: WorkspaceRootNotFoundError) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	let root = path.resolve(directory);
	while (!(yield* fs.exists(path.join(root, "package.json")))) {
		const parent = path.dirname(root);
		if (parent === root) return yield* Effect.fail(notFound);
		root = parent;
	}
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
		WorkspacePackage.make({
			...manifest,
			path: root,
			packageJsonPath,
			relativePath: ".",
			workspaceRoot: root,
			manifestRecord: json as Record<string, unknown>,
		}),
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
	/**
	 * The project's workspace-relative directory as pnpm spells it (no
	 * leading `./`, no trailing `/`, `""` for the workspace root). Present
	 * only in a `manager: "pnpm"` plan, which is keyed by directory, so two
	 * same-named projects can each have a release; a Changesets plan is keyed
	 * by name and leaves it out.
	 */
	dir: Schema.optionalKey(Schema.String),
	/** The bump, or `none` for a listed package whose version does not move. */
	type: Schema.Literals(["patch", "minor", "major", "none"]),
	/**
	 * The version the bump starts from: the workspace's version now, or for a
	 * member of a fixed or linked group, the group's highest.
	 */
	oldVersion: Schema.String,
	/**
	 * The version after the release; equal to `oldVersion` when `type` is
	 * `none`, and in a pnpm plan for a first release, which publishes its
	 * manifest version as it is.
	 */
	newVersion: Schema.String,
	/**
	 * The ids of the changesets in the plan that name the package, as the
	 * oracle lists them: each {@link PendingChangeset.id}, the file name
	 * without `.md` (`pre/<name>` for one an earlier pre-release consumed).
	 * The plan's own `changesets` holds the changesets themselves.
	 *
	 * @remarks
	 * An empty list always means the package's bump does not come from a
	 * changeset of its own in this plan. It is reached as a dependent, pulled
	 * into a `fixed` group, or completed from a prerelease on `exit`. The
	 * converse does not hold: a non-empty list does not mean the package's own
	 * changeset set its bump. Every path that builds a release:
	 *
	 * - A changeset naming the package, `none` included, lists its id. A
	 *   package named only `none` keeps the id while it stays `none`.
	 * - A ripple into a package not yet in the plan, or into a `none` entry,
	 *   replaces it with a new release whose list is empty. So a package one
	 *   changeset named `none` and a dependency then bumped has an empty list,
	 *   as the oracle answers (`explicit-none-rippled`). A ripple never
	 *   touches a package already releasing.
	 * - A `fixed` group adds a missing member with an empty list, and raises
	 *   an existing member's type, including a `none` entry's, keeping its
	 *   list. A raised member can therefore list only a changeset that named
	 *   it `none`, or a smaller bump than the type it ends with.
	 * - A `linked` group raises only members already releasing and keeps
	 *   their lists.
	 * - On `exit`, a package still on a numbered prerelease that is not in
	 *   the plan is added `patch` with an empty list. A `none` entry is raised
	 *   to `patch` and keeps its list.
	 * - In pre mode the changesets an earlier pre-release consumed are not in
	 *   the plan. So the list names only this pre-release's new changesets,
	 *   and a package whose own changesets were all consumed, and which a
	 *   ripple brings back, has an empty list.
	 * - A snapshot plan builds its releases exactly as a plain one does.
	 *
	 * In a pnpm plan the list is the intents the release consumes, the ids pnpm
	 * records in its ledger: those still pending, and, when it graduates off a
	 * lane, those its prereleases consumed.
	 *
	 * To tell a group or exit bump from a ripple, read `fixed` and `linked`
	 * and the plan's `preState`. To tell whether the package's own changeset
	 * set its type, compare `type` with the highest bump its listed changesets
	 * give it.
	 */
	changesets: Schema.Array(Schema.String),
	/**
	 * Why the package is in the plan, each cause once, in pnpm's order
	 * (`dependencies`, `epic`, `fixed`, `intent`).
	 *
	 * @remarks
	 * A pnpm plan reports the causes pnpm reports. A Changesets plan fills
	 * them from the paths its oracle has: `intent` for a release a changeset
	 * made (and for a prerelease completed on `exit`), `dependencies` for one
	 * a ripple made, which replaces the entry and its causes as the ripple
	 * replaces the release, and `fixed` for a member a fixed group added or
	 * moved. A `linked` group adds no cause. Decoding a value without the
	 * field gives `[]`.
	 */
	causes: Schema.Array(ReleaseCause).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed([])),
		Schema.withConstructorDefault(Effect.succeed([])),
	),
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
 * - A snapshot plan (`changeset version --snapshot`, whose oracle is
 *   `@changesets/assemble-release-plan`'s snapshot argument) plans the same
 *   releases and only rewrites each bumped `newVersion` to
 *   `<base>-<suffix>`. `<base>` is `0.0.0`, or with `useCalculatedVersion` the
 *   version the plan would otherwise give. A `none` entry keeps its version,
 *   and dependents are still checked against the calculated version, not the
 *   snapshot one. {@link ReleasePlan.assemble} has the suffix rules.
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
 * - A Ruby-style `~>` range (`~>1.0.0`), which node-semver reads as `~`,
 *   is not a range here: `@effected/semver` rejects it. It draws no edge,
 *   so it never ripples, where the oracle bumps the dependent once the
 *   range is left, and {@link ReleasePlan.edits} never rewrites it.
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
 * - An empty snapshot `tag` or `commit` is no value at all; see
 *   {@link ReleasePlan.assemble}.
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
	/**
	 * Whether this is a snapshot release's plan, made with a `snapshot` input.
	 * {@link ReleasePlan.edits} reads it: a snapshot pins dependents exactly
	 * and leaves an `exit`-mode `pre.json` in place.
	 */
	snapshot: Schema.Boolean.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed(false)),
		Schema.withConstructorDefault(Effect.succeed(false)),
	),
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
	 * each. A snapshot adds {@link SnapshotPreModeError} and
	 * {@link SnapshotTemplateError}, described below. What the oracle rejects outright and this does not check is planned,
	 * not refused: a changeset mixing skipped and released packages, a public
	 * package depending on a skipped one, and `privatePackages` with `tag` on
	 * and `version` off.
	 *
	 * With `snapshot`, the plan is a snapshot release's, matching
	 * `@changesets/assemble-release-plan` given the same snapshot argument:
	 *
	 * - It fails {@link SnapshotPreModeError} when `pre` is in `pre` mode.
	 *   The oracle itself plans one; the refusal is `changeset version`'s,
	 *   which never reaches the oracle. In `exit` mode a snapshot is planned.
	 * - `useCalculatedVersion` and `prereleaseTemplate` come from
	 *   `config.snapshot` unless the snapshot overrides them. An empty
	 *   `prereleaseTemplate` override is the default suffix, as an empty
	 *   `--snapshot-prerelease-template` is.
	 * - With no template the suffix is `<tag>-<datetime>`, or `<datetime>`
	 *   with no tag. A template may use `{tag}`, `{commit}`,
	 *   `{commit-short}` (its first seven characters), `{timestamp}` (epoch
	 *   milliseconds) and `{datetime}` (`YYYYMMDDHHmmss`, UTC), all taken from
	 *   `snapshot.timestamp`, never the clock. It fails
	 *   {@link SnapshotTemplateError} when it uses `{tag}`, `{commit}` or
	 *   `{commit-short}` with no value, or omits `{tag}` while a tag is given.
	 *   Placeholders are filled in that order, each over the last one's
	 *   output, as the oracle fills them.
	 * - The suffix is not checked as semver, any more than the oracle checks
	 *   it: `--snapshot pr#123` gives `0.0.0-pr#123-<datetime>`.
	 * - An invalid `timestamp` Date throws `RangeError`, as
	 *   `Date.prototype.toISOString` does: it is a programmer error, not a
	 *   planning failure.
	 *
	 * An empty `tag` or `commit` is treated as absent.
	 * `changeset version --snapshot` never passes `""` to the oracle: an empty `--snapshot` value
	 * is falsy there, so it plans no snapshot at all, and a bare `--snapshot`
	 * passes no tag. Called directly with `tag: ""`, the oracle fills `{tag}`
	 * with nothing and refuses a template without `{tag}`, while
	 * `@changesets/apply-release-plan` reads the same `""` as "not a snapshot"
	 * and writes caret ranges. With no template the two readings give the same
	 * version; with one, this follows the bare `--snapshot` reading, so a
	 * template with `{tag}` fails `missingValue` and one without it succeeds.
	 * Because every value that can fill a placeholder is then non-empty, the
	 * suffix is never empty, so the oracle's quiet fallback to plain versions
	 * on an empty suffix cannot happen here.
	 *
	 * With `manager: "pnpm"` the plan is pnpm's own, `assemble_release_plan`
	 * from pnpm 12.20.0's `crates/versioning`, held to pnpm's recorded answers
	 * (`__test__/fixtures/pnpm-native/`). `config` and `pre` are not read, since
	 * pnpm reads neither file, and a changeset under `.changeset/pre/` is not an
	 * intent. What it reads instead:
	 *
	 * - `versioning`: `pnpm-workspace.yaml`'s block. Lanes build `X.Y.Z-<lane>.N`,
	 *   the counter continuing while the stable target holds and resetting when
	 *   a bigger bump moves it (`2.1.0-alpha.1` plus a major is `3.0.0-alpha.0`);
	 *   a package off its lane graduates to the stable version its lane built,
	 *   but only when the intents that built it are still pending files the
	 *   ledger records under prerelease versions alone. `fixed` groups share
	 *   their highest version, bumped. Epic members keep their majors in the
	 *   lead's band, `M*100` to `M*100+99`, and re-base to the next band's floor
	 *   when the lead releases a new stable major. `ignore` takes a project out
	 *   of planning. `maxBump` caps the final plan's real version distance.
	 * - `ledger`: which intents each project already consumed, matched by `dir`,
	 *   or by name for a bare-list entry.
	 * - `published`: the registry seam, the project directories whose MANIFEST
	 *   version the registry already has (pnpm probes exactly that version, so
	 *   a newer published `latest` does not count). Absent, the first-release
	 *   rule is off and nothing debuts. Given, a public release whose directory
	 *   the set lacks is a first release: it keeps its manifest version (on a
	 *   lane, `<stable>-<lane>.0`) while still reporting its intent's bump and
	 *   consuming its intents, and the plan is made again, as `pnpm version -r`
	 *   makes it. A private project is never probed, so never debuts.
	 * - `enforceWorkspaceProtocol`: refuse an internal production dependency
	 *   that is not a `workspace:` range, as `pnpm version -r` does. Off is
	 *   `pnpm change status`'s reading.
	 *
	 * The plan is keyed by project directory: each release has its `dir`, so two
	 * same-named projects each release. A changeset may name a project by its
	 * `./`-prefixed workspace-relative directory (`"./packages/b": patch`),
	 * normalised as pnpm normalises one (backslashes to `/`, every leading `./`
	 * and the trailing `/` removed, `./` alone being the root). A key that names
	 * nothing fails {@link UnknownPackageError}, and a bare name that more than
	 * one project publishes {@link AmbiguousPackageError}, both even for an
	 * intent already consumed. A dependent ripples `patch` only through a
	 * `workspace:` range the dependency's new version leaves, so a 1.x minor
	 * stays inside `workspace:^` and a plain range never ripples;
	 * devDependencies never do. Every other refusal is {@link VersioningError},
	 * whose `code` is pnpm's.
	 *
	 * The default, `"changesets"`, is the Changesets CLI's reading: a `./` key is
	 * an unknown package, as it is there.
	 *
	 * A snapshot under `manager: "pnpm"` is the engine's: every release becomes
	 * `0.0.0-<suffix>`, with the suffix built from the snapshot alone as above
	 * (`useCalculatedVersion` is not read), and bands and `maxBump` go
	 * unchecked.
	 *
	 * @param input - The packages to plan, the pending changesets, the config
	 * and, in pre-release mode, the {@link PreState}, and for a snapshot
	 * release the {@link ReleaseSnapshot}; for a pnpm plan, its `versioning`,
	 * `ledger`, `published` and `enforceWorkspaceProtocol`.
	 * {@link ReleasePlan.read} decides whether the workspace root is one of the
	 * packages.
	 */
	static assemble(input: {
		readonly packages: ReadonlyArray<WorkspacePackage>;
		readonly changesets: ReadonlyArray<PendingChangeset>;
		readonly config: ChangesetConfig;
		readonly pre?: PreState;
		readonly snapshot?: ReleaseSnapshot;
		readonly manager?: ReleaseManager;
		readonly versioning?: VersioningConfig;
		readonly ledger?: Ledger;
		readonly published?: ReadonlySet<string>;
		readonly enforceWorkspaceProtocol?: boolean;
	}): Result.Result<
		ReleasePlan,
		| UnknownPackageError
		| AmbiguousPackageError
		| ChangesetConfigError
		| InvalidVersionError
		| SnapshotPreModeError
		| SnapshotTemplateError
		| VersioningError
	> {
		return assembleResult(input);
	}

	/**
	 * What `changeset version` writes for `plan`, as data: each manifest's new
	 * `version` and rewritten dependency ranges, the changeset files it
	 * deletes or, in pre mode, moves under `.changeset/pre/`, and the
	 * `pre.json` it leaves. CHANGELOG files are not covered. Nothing is
	 * written; the caller applies the {@link ReleaseEdits}.
	 *
	 * `@changesets/apply-release-plan` is the oracle, and
	 * `__test__/ReleaseEdits.oracle.test.ts` compares it on disk. Its rules:
	 *
	 * - Every planned package's manifest gets its new `version`, and so does
	 *   nothing else. Only planned packages and the workspace root (marked
	 *   `isRootWorkspace` among `packages`) have their ranges rewritten: a
	 *   package outside the plan keeps a range on a released dependency, even
	 *   one the new version leaves.
	 * - A range on a released dependency (not a `none` entry) is rewritten in
	 *   `dependencies`, `devDependencies`, `peerDependencies` and
	 *   `optionalDependencies` alike when the new version leaves it, or, while
	 *   it still holds, when the release's bump is at least
	 *   `updateInternalDependencies`. A held `peerDependencies` range instead
	 *   follows `onlyUpdatePeerDependentsWhenOutOfRange` (from the config's
	 *   `extra`): rewritten unless it is on.
	 * - `workspace:*`, `workspace:^`, `workspace:~` and a `workspace:` path are
	 *   never rewritten: they follow the dependency on their own. A
	 *   `workspace:<range>` is rewritten and keeps its `workspace:` prefix.
	 *   `file:`, `link:`, `catalog:`, `npm:` and any non-range specifier are
	 *   never rewritten, and under `bumpVersionsWithWorkspaceProtocolOnly`
	 *   neither is a plain range.
	 * - A range that matches every version (`*`, `x`, `>=0.0.0`, or a `||`
	 *   with such a part) is rewritten only to a prerelease version.
	 * - The new range is the old one's leading operator (`^`, `~`, `>=`, `<=`,
	 *   `>`, or none) before the new version. A range of exactly two
	 *   comparators written with both `>` and `<` becomes `>=<new>` with its
	 *   upper bound kept while the new version satisfies it, else
	 *   `<<new bumped again>>`, in the order it was written. In a snapshot
	 *   plan every rewritten range is the exact new version.
	 * - Each changeset in the plan is deleted, or in pre mode moved to
	 *   `pre/<file>`, unless it names a skipped package (ignored, private
	 *   while `privatePackages.version` is off, or version-less), which leaves
	 *   it in place.
	 * - `pre.json` is deleted in `exit` mode unless the plan is a snapshot,
	 *   and otherwise left as it is.
	 * - A pre-release consumes a changeset by moving its file to
	 *   `.changeset/pre/`, never by listing its id in `pre.json`: the current
	 *   layout has no such list, so in pre mode `preState` is the plan's own,
	 *   unchanged, and the consumed files are `moveChangesets`. That is the
	 *   directory {@link PendingChangesets.read} reads back as `pre/<file>`.
	 *
	 * Deliberate differences, each ruled:
	 *
	 * - An edit that would write the value already there is left out, and so
	 *   is a manifest with nothing to change; the oracle rewrites the same
	 *   value. The files end the same.
	 * - The oracle only deletes a changeset file it finds on disk; the edits
	 *   name every consumed changeset, since the plan was read from them. An
	 *   older-layout `pre.json`'s listed changeset is named as the plan names
	 *   it (`pre/<file>` in exit mode), where the oracle had moved it while
	 *   reading; the file itself is still at `<file>`. Neither does this
	 *   migrate that `pre.json`, which the oracle rewrites as it reads.
	 * - A `~>` range is never rewritten, where the oracle rewrites it as `~`:
	 *   `@effected/semver` rejects the Ruby-style operator, so it is not a
	 *   range here. It never ripples in {@link ReleasePlan.assemble} either.
	 * - `changeset version --snapshot ""` is a third state no plan here
	 *   holds. The CLI plans no snapshot for an empty value, but hands the
	 *   `""` to `apply-release-plan`, which then keeps an `exit`-mode
	 *   `pre.json` (it deletes one only when the snapshot is `null`) while
	 *   writing caret ranges. A plan without a snapshot deletes that
	 *   `pre.json`; a caller reproducing the CLI keeps it.
	 *
	 * These are Changesets semantics, keyed by package name. pnpm applies its own
	 * plans, writing `workspace:` ranges it never rewrites and the dependency
	 * updates its plan carries, which a {@link PlannedRelease} does not; so a
	 * `manager: "pnpm"` plan is read here as Changesets would apply it. A pnpm
	 * plan holding two releases with one name (same-named projects) fails
	 * {@link AmbiguousPackageError} listing their directories, since an edit
	 * keyed by name would land both on one manifest.
	 *
	 * Fails with {@link MissingPackageError} when the plan releases a package
	 * `packages` lacks, and with `InvalidVersionError` when a bounded range
	 * must be bumped past a new version that is not a version, which a plan
	 * {@link ReleasePlan.assemble} made never has.
	 *
	 * @param plan - The plan to apply.
	 * @param input - Every package of the workspace, the root included, as
	 * `WorkspaceDiscovery.listPackagesIn` lists them, and the config the plan
	 * was made with.
	 */
	static edits(
		plan: ReleasePlan,
		input: { readonly packages: ReadonlyArray<WorkspacePackage>; readonly config: ChangesetConfig },
	): Result.Result<ReleaseEdits, MissingPackageError | InvalidVersionError | AmbiguousPackageError> {
		return computeEdits(plan, input);
	}

	/**
	 * The releases in `plan` that stay on their own breaking line while a range
	 * they publish crosses a dependency's breaking line. Nothing is written; a
	 * caller raises each to its `required` bump, then plans again, because the
	 * raised release can itself cross a dependent's floor.
	 *
	 * A breaking line is a caret line: `1.x` for a `1.4.2`, `0.4.x` for a
	 * `0.4.2`, the single version for a `0.0.4`. A release is breaking when its
	 * new version is on another line than the package's version now; for a
	 * member of a fixed or linked group that is the package's own version, not
	 * the group's `oldVersion`, because consumers hold the package's own.
	 *
	 * The rule, for every release R that is not `none` and not already breaking:
	 *
	 * - For each `peerDependencies` entry naming a package D that the plan
	 *   releases as breaking, find the
	 *   range R publishes on D. `workspace:^` and `workspace:~` publish the
	 *   operator before D's new version, `workspace:*` and a `workspace:` path
	 *   publish D's new version exactly, and `workspace:<range>` or a literal
	 *   range publishes as {@link ReleasePlan.edits} leaves it. That rewrites
	 *   the range when D's new version leaves it, and also a held peer range
	 *   unless `onlyUpdatePeerDependentsWhenOutOfRange` is on, keeping only
	 *   the leading operator: `^0.3.0 || ^0.4.0` publishes as `^0.4.0`.
	 * - When that range does not admit D's version now, R crosses D's floor: a
	 *   consumer holding R's old line and D's old line resolves R's release
	 *   and gets a D it cannot satisfy. R must leave its own line too, so R is
	 *   reported with the smallest bump that does (`major` from `1.x`, `minor`
	 *   from `0.x` with a non-zero minor, `patch` from `0.0.x`).
	 *
	 * Only peers are read. A regular or optional dependency is installed for R
	 * alone, so a newer D nests beside the consumer's and strands nothing; a
	 * peer binds to the consumer's D, which may be on the old line. A
	 * published range that still admits D's old version crosses nothing, so
	 * a widened range such as `^0.3.0 || ^0.4.0` avoids a raise only where
	 * `onlyUpdatePeerDependentsWhenOutOfRange` keeps it as written. A version
	 * that is not one is passed over.
	 *
	 * `@changesets/assemble-release-plan` has no such rule: it bumps a
	 * dependent `patch` however far the dependency moves, so a dependency's
	 * breaking release ripples as a patch of everything that peers on it.
	 *
	 * Keyed by package name, as {@link ReleasePlan.edits} is: a pnpm plan
	 * holding two releases with one name fails {@link AmbiguousPackageError}.
	 *
	 * Fails as {@link ReleasePlan.edits} fails, which a plan
	 * {@link ReleasePlan.assemble} made from the same packages never does.
	 *
	 * @param plan - The plan to check.
	 * @param input - The workspace's packages and the config the plan was
	 * made with, as {@link ReleasePlan.edits} takes them.
	 * @returns every crossing, sorted by package name, each with its causes
	 * sorted by dependency name; empty when the plan crosses no floor.
	 */
	static breakingFloors(
		plan: ReleasePlan,
		input: { readonly packages: ReadonlyArray<WorkspacePackage>; readonly config: ChangesetConfig },
	): Result.Result<ReadonlyArray<BreakingFloor>, MissingPackageError | InvalidVersionError | AmbiguousPackageError> {
		return computeBreakingFloors(plan, input.packages, input.config);
	}

	/**
	 * The plan's releases keyed by package name, for a consumer that reads a
	 * plan by name. A Changesets plan always has one release per name. A
	 * `manager: "pnpm"` plan is keyed by directory and may release two
	 * same-named projects; then this fails {@link AmbiguousPackageError} naming
	 * the first such name and every directory releasing it, rather than letting
	 * one release silently stand for both.
	 *
	 * @param plan - The plan to key.
	 */
	static releasesByName(plan: ReleasePlan): Result.Result<ReadonlyMap<string, PlannedRelease>, AmbiguousPackageError> {
		const twins = twinReleases(plan.releases);
		return twins === undefined
			? Result.succeed(new Map(plan.releases.map((release) => [release.name, release])))
			: Result.fail(twins);
	}

	/**
	 * Discover the workspace's packages, read its config, pending changesets and
	 * `.changeset/pre.json`, and {@link ReleasePlan.assemble | assemble} the
	 * plan. {@link ReleasePlan.readWithContext} reads the same plan and also
	 * returns the packages and config it was made from.
	 *
	 * `directory` may be the workspace root or any directory inside it: the
	 * root is found by climbing, as `@changesets/get-release-plan` climbs, to
	 * the nearest workspace root, or with none to the nearest `package.json`.
	 * That root decides the config, the changesets and `pre.json`, whatever
	 * directory the `WorkspaceDiscovery` layer was built from. The workspace
	 * root package is left out while other packages exist. When there are
	 * none it is the package and is planned, including when the root has only
	 * a `package.json` and no workspace file. The oracle refuses `packages: []`
	 * and patterns that match nothing; here they plan the root too, because
	 * discovery reports them the same way. A root listed in `packages:`
	 * alongside others stays out, where the oracle plans it. A root with a
	 * catalog-only workspace file answers for itself, where the oracle climbs
	 * to any enclosing workspace.
	 *
	 * `WorkspaceDiscovery` memoizes each root's packages for the layer's
	 * lifetime. A long-lived host that plans again after applying a release
	 * calls `WorkspaceDiscovery`'s `refreshIn(root)` first, or the new plan
	 * reads the versions the release replaced.
	 *
	 * In a repository `ReleaseManager.detect` calls pnpm's, the plan is pnpm's
	 * (see {@link ReleasePlan.assemble}): every discovered project is planned,
	 * the root included; the `versioning` block is read through `PnpmSettings`
	 * and the ledger through {@link Ledger.read}; a missing `config.json` is the
	 * defaults; `pre.json` is not read. With a {@link RegistryVersions} provided,
	 * the registry is asked whether each public release's manifest version is
	 * published, and the ones it lacks are planned as first releases
	 * ({@link ReleasePlan.assemble}'s `published`); a registry failure is
	 * `RegistryReadError`, never read as unpublished. Without one nothing is asked
	 * and nothing is a first release; the service is optional in `R`, so an
	 * existing caller is unchanged. A snapshot never asks. It also fails with
	 * `PnpmSettingsError` and {@link LedgerError}.
	 *
	 * @param directory - The workspace root, or a directory inside it.
	 * @param options - `snapshot` plans a snapshot release, as
	 * {@link ReleasePlan.assemble} describes.
	 */
	static readonly read = Effect.fn("ReleasePlan.read")(function* (
		directory: string,
		options?: { readonly snapshot?: ReleaseSnapshot | undefined },
	) {
		return (yield* readContext(directory, options)).plan;
	});

	/**
	 * {@link ReleasePlan.read}, returning the plan with everything it was read
	 * from, so a caller hands {@link ReleasePlan.edits} and `Changelog.entry`
	 * exactly the packages and config the plan was made with instead of
	 * discovering them again.
	 *
	 * @param directory - The workspace root, or a directory inside it.
	 * @param options - `snapshot` plans a snapshot release, as
	 * {@link ReleasePlan.assemble} describes.
	 * @returns a {@link ReleaseContext}. It fails as {@link ReleasePlan.read} does.
	 */
	static readonly readWithContext = Effect.fn("ReleasePlan.readWithContext")(function* (
		directory: string,
		options?: { readonly snapshot?: ReleaseSnapshot | undefined },
	) {
		return yield* readContext(directory, options);
	});
}

/**
 * A {@link ReleasePlan} with what {@link ReleasePlan.readWithContext} read it
 * from.
 *
 * @example
 * ```ts
 * import { ReleasePlan } from "@effected/changesets";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const { plan, packages, config } = yield* ReleasePlan.readWithContext("/repo/packages/a");
 *   return yield* Effect.fromResult(ReleasePlan.edits(plan, { packages, config }));
 * });
 * ```
 *
 * @public
 */
export class ReleaseContext extends Schema.Class<ReleaseContext>("ReleaseContext")({
	/** The workspace root the plan was read from: the directory climbed to, not the one given. */
	root: Schema.String,
	/** The plan. */
	plan: ReleasePlan,
	/**
	 * Every package of the workspace, the root included, as
	 * {@link ReleasePlan.edits} and `Changelog.entry` take them. For a
	 * repository with no workspace file it is the one root package.
	 */
	packages: Schema.Array(WorkspacePackage),
	/** The config the plan was made with. */
	config: ChangesetConfig,
}) {}

const readContext = Effect.fnUntraced(function* (
	directory: string,
	options: { readonly snapshot?: ReleaseSnapshot | undefined } | undefined,
) {
	const discovery = yield* WorkspaceDiscovery;
	const discovered = yield* discovery
		.listPackagesIn(directory)
		.pipe(Effect.catchTag("WorkspaceRootNotFoundError", (error) => readLonePackage(directory, error)));
	// Discovery always lists the root package, which carries the root it climbed to.
	const root = discovered[0]?.workspaceRoot ?? directory;
	const manager = yield* ReleaseManagerSchema.detect(root);
	const changesets = yield* PendingChangesets.read(root);
	if (manager === "pnpm") {
		// pnpm reads neither config.json nor pre.json: a missing config is the defaults, and
		// every project, the root included, is planned, as pnpm discovers them.
		const config = yield* ChangesetConfig.read(root).pipe(
			Effect.catchTag("ChangesetConfigError", (error) =>
				error.reason === "missing" ? Effect.succeed(DEFAULT_CONFIG) : Effect.fail(error),
			),
		);
		const settings = yield* PnpmSettings.load({ cwd: root, env: {}, platform: "linux" });
		const versioning = yield* Effect.fromResult(settings.versioning());
		const ledger = yield* Ledger.read(root);
		const input = {
			packages: discovered,
			changesets,
			config,
			manager,
			...(Option.isSome(versioning) ? { versioning: versioning.value } : {}),
			...(Option.isSome(ledger) ? { ledger: ledger.value } : {}),
			...(options?.snapshot === undefined ? {} : { snapshot: options.snapshot }),
		};
		let plan = yield* Effect.fromResult(ReleasePlan.assemble(input));
		// The registry seam, as `pnpm version -r` runs it: plan once, ask the registry about the public
		// releases of that plan (by the name each publishes under), then plan again with the ones it
		// lacks as first releases. A snapshot publishes `0.0.0-<suffix>` whatever the registry holds,
		// so it asks nothing.
		const registry = yield* Effect.serviceOption(RegistryVersions);
		if (Option.isSome(registry) && options?.snapshot === undefined) {
			const byDir = new Map(discovered.map((pkg) => [projectDir(pkg.relativePath), pkg]));
			const probed = yield* Effect.forEach(
				plan.releases.filter((release) => byDir.get(pnpmDir(release))?.private !== true),
				(release) => {
					const publishedName = byDir.get(pnpmDir(release))?.publishConfig?.name;
					return registry.value
						.published(
							publishedName === undefined || publishedName === "" ? release.name : publishedName,
							release.oldVersion,
						)
						.pipe(Effect.map((found) => [pnpmDir(release), found] as const));
				},
				{ concurrency: 8 },
			);
			const unpublished = new Set(probed.filter(([, found]) => !found).map(([dir]) => dir));
			if (unpublished.size > 0) plan = yield* Effect.fromResult(assembleResult({ ...input, unpublished }));
		}
		return ReleaseContext.make({ root, plan, packages: discovered, config });
	}
	const config = yield* ChangesetConfig.read(root);
	const pre = yield* PreState.read(root);
	const members = discovered.filter((pkg) => !pkg.isRootWorkspace);
	const plan = yield* Effect.fromResult(
		ReleasePlan.assemble({
			packages: members.length > 0 ? members : discovered,
			changesets,
			config,
			manager,
			...(Option.isSome(pre) ? { pre: pre.value } : {}),
			...(options?.snapshot === undefined ? {} : { snapshot: options.snapshot }),
		}),
	);
	return ReleaseContext.make({ root, plan, packages: discovered, config });
});

/** A pnpm-mode release's directory: `PlannedRelease.dir` is always set there, so its absence is a planner defect. */
const pnpmDir = (release: PlannedRelease): string => {
	if (release.dir === undefined) throw new Error(`pnpm plan: release ${release.name} has no dir`);
	return release.dir;
};

/**
 * {@link ReleasePlan.assemble}'s body, with the one input it does not publish:
 * `unpublished`, the directories to plan as first releases outright, for
 * `read`, which has already asked the registry. `published` stays the only
 * public way to say which directories debut.
 */
const assembleResult = (input: Parameters<typeof assembleOrHalt>[0]): ReturnType<typeof ReleasePlan.assemble> => {
	try {
		return Result.succeed(assembleOrHalt(input));
	} catch (error) {
		if (error instanceof Halt) return Result.fail(error.failure);
		throw error;
	}
};

/** The config a pnpm repository without `.changeset/config.json` is read with: every default. */
const DEFAULT_CONFIG = Schema.decodeUnknownSync(ChangesetConfig)({});

/**
 * pnpm-native planning: {@link planPnpm} over the packages, intents, the
 * `versioning` block and the ledger, its releases made {@link PlannedRelease}s.
 * `config` and `pre` are not read, as pnpm reads neither file.
 */
const assemblePnpm = (input: Parameters<typeof assembleOrHalt>[0]): ReleasePlan => {
	const { snapshot } = input;
	const suffix =
		snapshot === undefined
			? undefined
			: snapshotSuffix(
					snapshot.prereleaseTemplate,
					snapshot.tag === "" ? undefined : snapshot.tag,
					snapshot.commit === "" ? undefined : snapshot.commit,
					snapshot.timestamp,
				);
	const planned = planPnpm({
		packages: input.packages,
		changesets: input.changesets,
		versioning: input.versioning,
		ledger: input.ledger,
		published: input.published,
		unpublished: input.unpublished,
		enforceWorkspaceProtocol: input.enforceWorkspaceProtocol,
		snapshotSuffix: suffix,
	});
	if (Result.isFailure(planned)) throw new Halt(planned.failure);
	return ReleasePlan.make({
		releases: planned.success.releases.map((release) =>
			PlannedRelease.make({ ...release, changesets: [...release.changesets], causes: [...release.causes] }),
		),
		changesets: [...planned.success.consumed],
		snapshot: snapshot !== undefined,
	});
};

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
	readonly snapshot?: ReleaseSnapshot;
	readonly manager?: ReleaseManager;
	readonly versioning?: VersioningConfig;
	readonly ledger?: Ledger;
	readonly published?: ReadonlySet<string>;
	readonly unpublished?: ReadonlySet<string>;
	readonly enforceWorkspaceProtocol?: boolean;
}): ReleasePlan => {
	const { packages, changesets, config, pre, snapshot } = input;
	if (input.manager === "pnpm") return assemblePnpm(input);
	if (snapshot !== undefined && pre?.mode === "pre") throw new Halt(new SnapshotPreModeError({ preTag: pre.tag }));
	const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
	const ignored = new Set(matchNames(packages, config.ignore));
	const isSkipped = (pkg: WorkspacePackage): boolean =>
		ignored.has(pkg.name) || (pkg.private && !config.privatePackages.version) || pkg.version === undefined;
	const fixed = config.fixed.map((group) => matchNames(packages, group));
	const linked = config.linked.map((group) => matchNames(packages, group));
	const invalid = groupError(fixed, linked);
	if (invalid !== undefined) throw new Halt(invalid);

	// Changesets mode reads a key as a package name only: a `./dir` key is an unknown package, as there.
	for (const changeset of changesets) {
		for (const key of changeset.releases.keys()) {
			if (!byName.has(key)) throw new Halt(new UnknownPackageError({ packageName: key, changeset: changeset.file }));
		}
	}
	const releasesOf = (changeset: PendingChangeset): ReadonlyArray<readonly [string, ReleaseType]> => [
		...changeset.releases,
	];
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
		for (const [name, type] of releasesOf(changeset)) {
			const pkg = byName.get(name) as WorkspacePackage;
			if (isSkipped(pkg)) continue;
			const release = releases.get(name);
			if (release === undefined) {
				releases.set(name, {
					name,
					type,
					oldVersion: pkg.version,
					changesets: [changeset.id],
					causes: new Set(["intent"]),
				});
				continue;
			}
			if (RANK[type] > RANK[release.type]) release.type = type;
			(release.changesets as Array<string>).push(changeset.id);
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
				const release: Draft = {
					name: dependent.name,
					type,
					oldVersion: dependent.version,
					changesets: [],
					causes: new Set(["dependencies"]),
				};
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
					releases.set(name, { name, type, oldVersion, changesets: [], causes: new Set(["fixed"]) });
					continue;
				}
				if (release.type !== type) {
					updated = true;
					release.type = type;
					release.causes.add("fixed");
				}
				if (release.oldVersion !== oldVersion) {
					updated = true;
					release.oldVersion = oldVersion;
					release.causes.add("fixed");
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
				releases.set(pkg.name, {
					name: pkg.name,
					type: "patch",
					oldVersion: pkg.version,
					changesets: [],
					causes: new Set(["intent"]),
				});
			} else if (release.type === "none") {
				release.type = "patch";
				release.causes.add("intent");
			}
		}
	}

	const suffix =
		snapshot === undefined
			? undefined
			: snapshotSuffix(
					snapshot.prereleaseTemplate ?? config.snapshot.prereleaseTemplate,
					snapshot.tag === "" ? undefined : snapshot.tag,
					snapshot.commit === "" ? undefined : snapshot.commit,
					snapshot.timestamp,
				);
	const useCalculated = snapshot?.useCalculatedVersion ?? config.snapshot.useCalculatedVersion;
	const finalVersion = (release: Draft): string | undefined => {
		if (suffix === undefined || release.type === "none") return newVersion(release);
		return `${useCalculated ? newVersion(release) : "0.0.0"}-${suffix}`;
	};

	const planned: Array<PlannedRelease> = [];
	for (const release of releases.values()) {
		const next = finalVersion(release);
		if (release.oldVersion === undefined || next === undefined) continue;
		planned.push(
			PlannedRelease.make({
				name: release.name,
				type: release.type,
				oldVersion: release.oldVersion,
				newVersion: next,
				changesets: [...release.changesets],
				causes: sortCauses(release.causes),
			}),
		);
	}
	planned.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return ReleasePlan.make({
		releases: planned,
		changesets: relevant,
		...(pre === undefined ? {} : { preState: pre }),
		snapshot: snapshot !== undefined,
	});
};
