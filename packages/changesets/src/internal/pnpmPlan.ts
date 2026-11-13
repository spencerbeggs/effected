/**
 * pnpm's native release planner, a port of `assemble_release_plan`
 * (`.repos/pnpm/pnpm/crates/versioning/src/plan.rs:128`, pnpm 12.20.0) and
 * the modules it calls. Pure: it reads only its input and throws only the
 * private {@link Halt}, which {@link planPnpm} turns into a `Result`.
 *
 * The rules, each where pnpm states it:
 *
 * - Projects are keyed by workspace-relative directory, `normalize_project_dir`
 *   spelled (ledger.rs:356; `to_project_dir`, plan/project_refs.rs:16), so the
 *   root is `""`. A reference is a name, or a `./` directory
 *   (`ref_to_dirs`, plan/project_refs.rs:52); a name two projects publish
 *   resolves to both, and every caller refuses that.
 * - A participant has a name, a semver version, and is not in
 *   `versioning.ignore` (`releasable_participants`, plan/project_refs.rs:117).
 *   `private` does not exclude it.
 * - Internal edges are production dependencies only (`dependencies`,
 *   `optionalDependencies`, `peerDependencies`), devDependencies never
 *   (plan.rs:28-32). A `workspace:` spec names its alias target; a plain range
 *   or `catalog:` spec on a workspace name is internal too
 *   (`internal_dep_target_name`, plan/project_refs.rs:208).
 * - Intents resolve every key, consumed ones included: an unknown key is
 *   `UnknownPackage`, an ambiguous one `AmbiguousPackage`, and a real bump of
 *   a non-participant `UnreleasablePackage` (`resolve_intents`,
 *   plan/configuration.rs:215-269). Two keys reaching one project keep the
 *   higher bump.
 * - The ledger is indexed per directory (`build_consumption_index`,
 *   ledger.rs:280): a bare-list entry resolves its name, failing
 *   `AmbiguousLedgerEntry` when several projects publish it.
 * - An intent is pending for a project unless the ledger records it there at
 *   any version (`collect_pending_intents`, plan/propagation.rs:315); one
 *   recorded only at prerelease versions is lane-consumed
 *   (`collect_lane_consumed_intents`, plan/propagation.rs:341).
 * - Seeds: each project's highest pending bump (cause `intent`), and, for a
 *   project off every lane, its highest lane-consumed bump: graduation, also
 *   cause `intent` (`seed_bumps`, plan/propagation.rs:17-49). With no
 *   lane-consumed intent on disk, returning to `main` plans nothing.
 * - Versions (`compute_new_version`, plan/versions.rs:28): off a lane, a
 *   stable version bumps; a prerelease graduates to its stable part, escalated
 *   by the cumulative bump (the planned bump widened by every lane-consumed
 *   bump, `cumulative_bump`, plan/propagation.rs:92). On a lane the target is
 *   the same stable version, suffixed `-<lane>.<n>`, where `n` continues the
 *   current prerelease on that lane and target, else resets to 0
 *   (`next_prerelease_number`, plan/versions.rs:137). A first release
 *   (an unpublished directory) keeps its manifest version, or on a lane debuts
 *   at `<stable>-<lane>.0` (plan/versions.rs:45-53, 67-69).
 * - A fixed group shares one version: its highest current version, bumped by
 *   the group's highest cumulative bump, on the first member's lane with the
 *   highest counter (`shared_group_version`, plan/versions.rs:192).
 * - An epic lead releasing a new, higher stable major re-bases every member to
 *   `<major*100>.0.0` (or a lane prerelease of it), with cause `epic`
 *   (`epic_rebase_floor`, `apply_epic_band_versions`,
 *   plan/versions.rs:223-276). A prerelease lead `X.0.0-…` still counts as
 *   major `X-1`.
 * - The fixpoint (plan.rs:352-357, `propagate_bumps`,
 *   plan/propagation.rs:111): a dependent whose materialised `workspace:`
 *   range no longer accepts a dependency's new version bumps `patch` (cause
 *   `dependencies`); `workspace:^` and `workspace:~` materialise against the
 *   dependency's current version, `workspace:*` and `workspace:` to it exactly
 *   (`materialize_workspace_range`, plan/versions.rs:348). A non-`workspace:`
 *   spec constrains nothing, so a 1.x minor never ripples through
 *   `workspace:^` and a major does. A fixed group raises every member to its
 *   highest bump (cause `fixed`).
 * - After the fixpoint: two releases of one `name@version` fail
 *   `DuplicateRelease` (plan/propagation.rs:273); then, unless a snapshot,
 *   every epic member's new major must sit in its band (`enforce_epic_bands`,
 *   plan/versions.rs:316) and every release's effective bump (the larger of
 *   its bump and the real version distance) must not pass `maxBump`
 *   (`enforce_max_bump`, plan/versions.rs:369).
 * - A release's intents are its pending ones plus, off a lane, its
 *   lane-consumed ones (`changelog_intents`, plan/propagation.rs:246); its
 *   causes are reported sorted; releases sort by name, then directory.
 * - Configuration is validated first (`resolve_workspace`, plan.rs:175):
 *   an ambiguous name in `ignore`, `lanes`, `fixed` or an epic lead, a fixed
 *   group across lanes, an unknown epic lead, a project in two epics, and a
 *   fixed group straddling an epic.
 *
 * Epic selectors match with pnpm's `WildcardMatcher`, whose crate is not
 * vendored; `PnpmMatcher` restates `@pnpm/matcher`, which it mirrors (`*` is
 * any run of characters, `/` included). Range acceptance follows
 * `@effected/semver`, npm's rule that a prerelease satisfies a range only
 * through a comparator on its own `major.minor.patch`; the Rust `node-semver`
 * crate pnpm uses is not vendored either.
 *
 * @internal
 */

import type { VersioningConfig } from "@effected/pnpm";
import { PnpmMatcher } from "@effected/pnpm";
import { Range, SemVer } from "@effected/semver";
import type { WorkspacePackage } from "@effected/workspaces";
import { Result } from "effect";
import type { BumpType, ReleaseType } from "../BumpType.js";
import { AmbiguousPackageError, UnknownPackageError, VersioningError } from "../errors.js";
import type { Ledger } from "../Ledger.js";
import { normalizeProjectDir } from "../Ledger.js";
import type { PendingChangeset } from "../PendingChangesets.js";
import type { ReleaseCause } from "../ReleaseCause.js";
import { sortCauses } from "../ReleaseCause.js";
import { parseRange } from "./versions.js";

type Cause = ReleaseCause;
type PnpmError = UnknownPackageError | AmbiguousPackageError | VersioningError;

/** Ends planning with a typed failure; never escapes {@link planPnpm}. */
class Halt {
	constructor(readonly failure: PnpmError) {}
}

/** One planned release, keyed by its directory. */
export interface PnpmRelease {
	readonly name: string;
	readonly dir: string;
	readonly type: BumpType;
	readonly oldVersion: string;
	readonly newVersion: string;
	/** The intent ids the release consumes, in intent order. */
	readonly changesets: ReadonlyArray<string>;
	readonly causes: ReadonlyArray<Cause>;
}

export interface PnpmPlanInput {
	readonly packages: ReadonlyArray<WorkspacePackage>;
	readonly changesets: ReadonlyArray<PendingChangeset>;
	readonly versioning?: VersioningConfig | undefined;
	readonly ledger?: Ledger | undefined;
	/** The directories whose manifest version the registry already has; absent means no registry was asked. */
	readonly published?: ReadonlySet<string> | undefined;
	readonly enforceWorkspaceProtocol?: boolean | undefined;
	/** Every release becomes `0.0.0-<suffix>`, and bands and `maxBump` go unchecked. */
	readonly snapshotSuffix?: string | undefined;
}

export interface PnpmPlan {
	readonly releases: ReadonlyArray<PnpmRelease>;
	/** The intents some release consumes, in input order. */
	readonly consumed: ReadonlyArray<PendingChangeset>;
}

const BUMP_ORDER: Record<ReleaseType, number> = { none: 0, patch: 1, minor: 2, major: 3 };
const maxBump = (a: BumpType | undefined, b: BumpType): BumpType =>
	a === undefined || BUMP_ORDER[b] > BUMP_ORDER[a] ? b : a;

/** pnpm's spelling of a project directory; the root package (`"."`) is `""`. */
const projectDir = (relativePath: string): string => normalizeProjectDir(relativePath === "." ? "" : relativePath);

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const parse = (version: string): SemVer | undefined => Result.getOrUndefined(SemVer.parseResult(version));
const mustParse = (version: string): SemVer => {
	const parsed = parse(version);
	if (parsed === undefined) throw new Error(`pnpm planner: ${version} was admitted as a participant version`);
	return parsed;
};

const stablePart = (version: SemVer): string => `${version.major}.${version.minor}.${version.patch}`;
const isPrerelease = (version: SemVer): boolean => version.prerelease.length > 0;

const incStable = (version: SemVer, bump: BumpType): string =>
	bump === "major"
		? `${version.major + 1}.0.0`
		: bump === "minor"
			? `${version.major}.${version.minor + 1}.0`
			: `${version.major}.${version.minor}.${version.patch + 1}`;

/** `escalate_stable_target`, plan/versions.rs:112. */
const escalate = (target: string, bump: BumpType): string => {
	const version = mustParse(target);
	if (bump === "major") return version.minor === 0 && version.patch === 0 ? target : `${version.major + 1}.0.0`;
	if (bump === "minor") return version.patch === 0 ? target : `${version.major}.${version.minor + 1}.0`;
	return target;
};

/** `stable_target`, plan/versions.rs:80. */
const stableTarget = (version: SemVer, bump: BumpType): string =>
	isPrerelease(version) ? escalate(stablePart(version), bump) : incStable(version, bump);

/** A numeric identifier compares as its digits, as pnpm matches the tag (plan/versions.rs:88-96). */
const preTag = (version: SemVer): string | undefined => {
	const first = version.prerelease[0];
	return first === undefined ? undefined : String(first);
};

/** `next_prerelease_number`, plan/versions.rs:137. */
const nextPrereleaseNumber = (current: SemVer, target: string, lane: string): number => {
	if (!isPrerelease(current) || stablePart(current) !== target || preTag(current) !== lane) return 0;
	const n = current.prerelease[1];
	return typeof n === "number" ? n + 1 : 0;
};

/** `compute_new_version`, plan/versions.rs:28. */
const computeNewVersion = (
	current: string,
	bump: BumpType,
	lane: string | undefined,
	cumulative: BumpType,
	firstRelease: boolean,
): string => {
	const version = mustParse(current);
	if (lane === undefined) {
		if (firstRelease) return current;
		return isPrerelease(version) ? escalate(stablePart(version), cumulative) : incStable(version, bump);
	}
	if (firstRelease) return preTag(version) === lane ? current : `${stablePart(version)}-${lane}.0`;
	const target = stableTarget(version, cumulative);
	return `${target}-${lane}.${nextPrereleaseNumber(version, target, lane)}`;
};

/** `materialize_workspace_range`, plan/versions.rs:348. */
const materialize = (spec: string, dependencyVersion: string): string | undefined => {
	if (!spec.startsWith("workspace:")) return undefined;
	const rest = spec.slice("workspace:".length);
	const alias = workspaceAlias(rest);
	const range = alias === undefined ? rest : rest.slice(alias.length + 1);
	return range === "^" || range === "~"
		? `${range}${dependencyVersion}`
		: range === "*" || range === ""
			? dependencyVersion
			: range;
};

/** `range_accepts`, plan/versions.rs:362: a range or version that does not parse accepts nothing. */
const rangeAccepts = (range: string, version: string): boolean => {
	const parsedRange = parseRange(range);
	const parsedVersion = parse(version);
	return parsedRange !== undefined && parsedVersion !== undefined && Range.satisfies(parsedVersion, parsedRange);
};

/** `parse_workspace_spec_alias`, plan/project_refs.rs:222. */
const workspaceAlias = (rest: string): string | undefined => {
	const at = rest.lastIndexOf("@");
	if (at <= 0) return undefined;
	const alias = rest.slice(0, at);
	if (/^[._/]/.test(alias) || alias.slice(1).includes("@")) return undefined;
	return alias;
};

interface Project {
	readonly dir: string;
	readonly name: string;
	readonly version: string | undefined;
	readonly private: boolean;
	readonly prod: ReadonlyArray<{ readonly field: string; readonly alias: string; readonly spec: string }>;
}

interface InternalDep {
	readonly targetDir: string;
	readonly targetName: string;
	readonly field: string;
	readonly alias: string;
	readonly spec: string;
}

interface Participant {
	readonly dir: string;
	readonly name: string;
	readonly current: string;
	readonly private: boolean;
	internalDeps: ReadonlyArray<InternalDep>;
}

interface Epic {
	readonly lead: string;
	readonly leadDir: string;
	readonly members: ReadonlyArray<string>;
}

interface BumpState {
	bump: BumpType;
	readonly causes: Set<Cause>;
}

interface Intent {
	readonly changeset: PendingChangeset;
	/** Directory to the bump the intent asks of it. */
	readonly bumps: ReadonlyMap<string, ReleaseType>;
}

const PROD_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"] as const;

/** The workspace's projects and references, `index_project_refs` (plan/project_refs.rs:73). */
class Refs {
	readonly dirs: ReadonlySet<string>;
	private readonly byName = new Map<string, Array<string>>();
	constructor(projects: ReadonlyArray<Project>) {
		this.dirs = new Set(projects.map((project) => project.dir));
		for (const project of projects)
			this.byName.set(project.name, [...(this.byName.get(project.name) ?? []), project.dir]);
	}
	nameToDirs(name: string): ReadonlyArray<string> {
		return this.byName.get(name) ?? [];
	}
	refToDirs(reference: string): ReadonlyArray<string> {
		if (!reference.startsWith("./")) return this.nameToDirs(reference);
		const dir = normalizeProjectDir(reference);
		return this.dirs.has(dir) ? [dir] : [];
	}
	/** `resolve_config_ref` (plan/project_refs.rs:242): unknown is skipped, ambiguous fails. */
	config(reference: string, setting: string): ReadonlyArray<string> {
		const dirs = this.refToDirs(reference);
		if (dirs.length > 1) {
			throw new Halt(
				new VersioningError({
					reason: "ambiguousPackage",
					package: reference,
					context: setting,
					directories: [...dirs],
				}),
			);
		}
		return dirs;
	}
}

/** `internal_dep_target_name`, plan/project_refs.rs:208. */
const internalTarget = (alias: string, spec: string, refs: Refs): string | undefined => {
	if (spec.startsWith("workspace:")) {
		const target = workspaceAlias(spec.slice("workspace:".length)) ?? alias;
		return refs.nameToDirs(target).length > 0 ? target : undefined;
	}
	if (refs.nameToDirs(alias).length === 0) return undefined;
	return spec.startsWith("catalog:") || parseRange(spec) !== undefined ? alias : undefined;
};

/** The release-structure half of `resolve_workspace` (plan.rs:175), validated against itself. */
const resolveWorkspace = (projects: ReadonlyArray<Project>, versioning: VersioningConfig | undefined) => {
	const refs = new Refs(projects);
	const ignored = new Set(
		(versioning?.ignore ?? []).flatMap((reference) => refs.config(reference, "versioning.ignore")),
	);
	const participants = new Map<string, Participant>();
	for (const project of [...projects].sort((a, b) => byKey(a.dir, b.dir))) {
		if (project.version === undefined || parse(project.version) === undefined || ignored.has(project.dir)) continue;
		participants.set(project.dir, {
			dir: project.dir,
			name: project.name,
			current: project.version,
			private: project.private,
			internalDeps: [],
		});
	}
	for (const project of projects) {
		const participant = participants.get(project.dir);
		if (participant === undefined) continue;
		const deps: Array<InternalDep> = [];
		for (const dep of project.prod) {
			const targetName = internalTarget(dep.alias, dep.spec, refs);
			if (targetName === undefined) continue;
			const targets = refs.nameToDirs(targetName).filter((dir) => participants.has(dir));
			if (targets.length === 0) continue;
			if (targets.length > 1) {
				throw new Halt(
					new VersioningError({
						reason: "ambiguousPackage",
						package: targetName,
						context: `Package ${participant.name} (./${participant.dir})`,
						directories: targets,
					}),
				);
			}
			deps.push({ targetDir: targets[0] as string, targetName, field: dep.field, alias: dep.alias, spec: dep.spec });
		}
		participant.internalDeps = deps;
	}

	const lanes = new Map<string, string>();
	for (const [reference, lane] of Object.entries(versioning?.lanes ?? {})) {
		for (const dir of refs.config(reference, "versioning.lanes")) lanes.set(dir, lane);
	}

	const declaredFixed = versioning?.fixed ?? [];
	const fixed = declaredFixed.map((group) =>
		group.flatMap((reference) => refs.config(reference, "versioning.fixed")).filter((dir) => participants.has(dir)),
	);
	fixed.forEach((group, index) => {
		if (new Set(group.map((dir) => lanes.get(dir))).size > 1) {
			throw new Halt(new VersioningError({ reason: "conflictingConfig", group: [...(declaredFixed[index] ?? [])] }));
		}
	});

	const epics: Array<Epic> = [];
	for (const epic of versioning?.epics ?? []) {
		const leadDir = refs.config(epic.lead, "versioning.epics lead")[0];
		if (leadDir === undefined || !participants.has(leadDir)) {
			throw new Halt(new VersioningError({ reason: "epicUnknownLead", lead: epic.lead }));
		}
		const selectors = epic.packages.map((selector) => {
			const negated = selector.startsWith("!");
			const body = negated ? selector.slice(1) : selector;
			const onDir = body.startsWith("./");
			return { negated, onDir, matches: PnpmMatcher.compile([onDir ? normalizeProjectDir(body) : body]) };
		});
		const members: Array<string> = [];
		for (const participant of participants.values()) {
			if (participant.dir === leadDir) continue;
			let included = false;
			for (const selector of selectors) {
				if (selector.matches(selector.onDir ? participant.dir : participant.name)) included = !selector.negated;
			}
			if (included) members.push(participant.dir);
		}
		epics.push({ lead: epic.lead, leadDir, members });
	}
	// `assert_epics_disjoint` and `assert_fixed_group_fits_epic`, plan/configuration.rs:165-208.
	const epicOf = new Map<string, string>();
	for (const epic of epics) {
		for (const member of epic.members) {
			const other = epicOf.get(member);
			if (other !== undefined && other !== epic.lead) {
				throw new Halt(
					new VersioningError({ reason: "epicOverlap", directories: [member], lead: other, secondLead: epic.lead }),
				);
			}
			epicOf.set(member, epic.lead);
		}
		for (const group of fixed) {
			if (!group.some((dir) => epic.members.includes(dir))) continue;
			const outsiders = group.filter((dir) => !epic.members.includes(dir));
			if (outsiders.length > 0) {
				throw new Halt(
					new VersioningError({ reason: "epicFixedGroupConflict", lead: epic.lead, directories: outsiders }),
				);
			}
		}
	}
	return { refs, participants, lanes, fixed, epics };
};

type Workspace = ReturnType<typeof resolveWorkspace>;

/** `resolve_intents`, plan/configuration.rs:215. */
const resolveIntents = (changesets: ReadonlyArray<PendingChangeset>, workspace: Workspace): ReadonlyArray<Intent> =>
	changesets.map((changeset) => {
		const bumps = new Map<string, ReleaseType>();
		for (const [reference, bump] of changeset.releases) {
			const dirs = workspace.refs.refToDirs(reference);
			if (dirs.length === 0) {
				throw new Halt(
					new UnknownPackageError({
						packageName: reference,
						changeset: changeset.file,
						code: "ERR_PNPM_VERSIONING_UNKNOWN_PACKAGE",
					}),
				);
			}
			if (dirs.length > 1) {
				throw new Halt(
					new AmbiguousPackageError({
						packageName: reference,
						directories: [...dirs],
						changeset: changeset.file,
						code: "ERR_PNPM_VERSIONING_AMBIGUOUS_PACKAGE",
					}),
				);
			}
			const dir = dirs[0] as string;
			if (bump !== "none" && !workspace.participants.has(dir)) {
				throw new Halt(
					new VersioningError({ reason: "unreleasablePackage", package: reference, bump, changeset: changeset.file }),
				);
			}
			const existing = bumps.get(dir);
			if (existing === undefined || BUMP_ORDER[bump] > BUMP_ORDER[existing]) bumps.set(dir, bump);
		}
		return { changeset, bumps };
	});

interface Consumption {
	readonly all: ReadonlySet<string>;
	readonly prereleaseOnly: ReadonlySet<string>;
}

/** `build_consumption_index`, ledger.rs:280. */
const consumptionIndex = (ledger: Ledger | undefined, refs: Refs): ReadonlyMap<string, Consumption> => {
	const stable = new Map<string, Set<string>>();
	const prerelease = new Map<string, Set<string>>();
	for (const entry of ledger?.entries ?? []) {
		let dir: string;
		if (entry.dir !== undefined) dir = normalizeProjectDir(entry.dir);
		else {
			const dirs = refs.nameToDirs(entry.name);
			if (dirs.length === 0) continue;
			if (dirs.length > 1) {
				throw new Halt(
					new VersioningError({
						reason: "ambiguousLedgerEntry",
						ledgerKey: `${entry.name}@${entry.version}`,
						package: entry.name,
						directories: [...dirs],
					}),
				);
			}
			dir = dirs[0] as string;
		}
		const isPre = (entry.version.split("+")[0] ?? "").includes("-");
		const target = isPre ? prerelease : stable;
		const ids = target.get(dir) ?? new Set<string>();
		for (const id of entry.intents) ids.add(id);
		target.set(dir, ids);
	}
	const index = new Map<string, Consumption>();
	for (const dir of new Set([...stable.keys(), ...prerelease.keys()])) {
		const s = stable.get(dir) ?? new Set<string>();
		const p = prerelease.get(dir) ?? new Set<string>();
		index.set(dir, { all: new Set([...s, ...p]), prereleaseOnly: new Set([...p].filter((id) => !s.has(id))) });
	}
	return index;
};

const realBump = (bump: ReleaseType | undefined): BumpType | undefined =>
	bump === undefined || bump === "none" ? undefined : bump;

interface Assembly {
	readonly workspace: Workspace;
	readonly intents: ReadonlyArray<Intent>;
	readonly consumption: ReadonlyMap<string, Consumption>;
	readonly versioning: VersioningConfig | undefined;
	readonly snapshotSuffix: string | undefined;
}

/** `bump_at_least`, plan/propagation.rs:290: true when it inserted or raised. */
const bumpAtLeast = (state: Map<string, BumpState>, dir: string, bump: BumpType, cause: Cause): boolean => {
	const existing = state.get(dir);
	if (existing === undefined) {
		state.set(dir, { bump, causes: new Set([cause]) });
		return true;
	}
	existing.causes.add(cause);
	if (BUMP_ORDER[bump] > BUMP_ORDER[existing.bump]) {
		existing.bump = bump;
		return true;
	}
	return false;
};

/** `assemble`, plan.rs:339, for one set of unpublished directories. */
const assembleOnce = (ctx: Assembly, unpublished: ReadonlySet<string>): ReadonlyArray<PnpmRelease> => {
	const { workspace, intents, consumption } = ctx;
	const dirs = [...workspace.participants.keys()];
	const pending = new Map<string, Array<Intent>>();
	const laneConsumed = new Map<string, Array<Intent>>();
	for (const dir of dirs) {
		const consumed = consumption.get(dir);
		const own = intents.filter((intent) => realBump(intent.bumps.get(dir)) !== undefined);
		const stillPending = own.filter((intent) => !(consumed?.all.has(intent.changeset.id) ?? false));
		if (stillPending.length > 0) pending.set(dir, stillPending);
		const onLane = own.filter((intent) => consumed?.prereleaseOnly.has(intent.changeset.id) ?? false);
		if (onLane.length > 0) laneConsumed.set(dir, onLane);
	}
	const highest = (dir: string, list: ReadonlyArray<Intent>): BumpType | undefined =>
		list.reduce<BumpType | undefined>((high, intent) => {
			const bump = realBump(intent.bumps.get(dir));
			return bump === undefined ? high : maxBump(high, bump);
		}, undefined);

	const state = new Map<string, BumpState>();
	for (const [dir, list] of pending) {
		const bump = highest(dir, list);
		if (bump !== undefined) bumpAtLeast(state, dir, bump, "intent");
	}
	for (const [dir, list] of laneConsumed) {
		if (workspace.lanes.has(dir)) continue;
		const bump = highest(dir, list);
		if (bump !== undefined) bumpAtLeast(state, dir, bump, "intent");
	}

	const cumulative = (dir: string, planned: BumpType): BumpType =>
		maxBump(highest(dir, laneConsumed.get(dir) ?? []), planned);
	const participant = (dir: string): Participant => workspace.participants.get(dir) as Participant;

	const rebaseFloor = (epic: Epic, next: ReadonlyMap<string, string>): number | undefined => {
		const lead = next.get(epic.leadDir);
		const leadVersion = lead === undefined ? undefined : parse(lead);
		if (leadVersion === undefined || isPrerelease(leadVersion)) return undefined;
		const current = mustParse(participant(epic.leadDir).current);
		const currentMajor =
			isPrerelease(current) && current.minor === 0 && current.patch === 0
				? Math.max(0, current.major - 1)
				: current.major;
		return leadVersion.major > currentMajor ? leadVersion.major * 100 : undefined;
	};

	const computeVersions = (): Map<string, string> => {
		const next = new Map<string, string>();
		for (const dir of [...state.keys()].sort(byKey)) {
			const entry = state.get(dir) as BumpState;
			next.set(
				dir,
				computeNewVersion(
					participant(dir).current,
					entry.bump,
					workspace.lanes.get(dir),
					cumulative(dir, entry.bump),
					unpublished.has(dir),
				),
			);
		}
		// `apply_fixed_group_versions`, plan/versions.rs:157.
		for (const group of workspace.fixed) {
			let groupBump: BumpType | undefined;
			for (const dir of group) {
				const entry = state.get(dir);
				if (entry !== undefined) groupBump = maxBump(groupBump, cumulative(dir, entry.bump));
			}
			if (groupBump === undefined || group.length === 0) continue;
			const highestCurrent = group
				.map((dir) => mustParse(participant(dir).current))
				.reduce((high, version) => (version.gt(high) ? version : high));
			const target = stableTarget(highestCurrent, groupBump);
			const lane = workspace.lanes.get(group[0] as string);
			const shared =
				lane === undefined
					? target
					: `${target}-${lane}.${Math.max(...group.map((dir) => nextPrereleaseNumber(mustParse(participant(dir).current), target, lane)))}`;
			for (const dir of group) if (state.has(dir)) next.set(dir, shared);
		}
		// `apply_epic_band_versions`, plan/versions.rs:248.
		for (const epic of workspace.epics) {
			const floor = rebaseFloor(epic, next);
			if (floor === undefined) continue;
			const target = `${floor}.0.0`;
			for (const member of epic.members) {
				if (!state.has(member)) continue;
				const lane = workspace.lanes.get(member);
				next.set(
					member,
					lane === undefined
						? target
						: `${target}-${lane}.${nextPrereleaseNumber(mustParse(participant(member).current), target, lane)}`,
				);
			}
		}
		return next;
	};

	const propagate = (next: ReadonlyMap<string, string>): boolean => {
		let changed = false;
		for (const dependent of workspace.participants.values()) {
			for (const dep of dependent.internalDeps) {
				const targetNew = next.get(dep.targetDir);
				if (targetNew === undefined) continue;
				const range = materialize(dep.spec, participant(dep.targetDir).current);
				if (range === undefined || rangeAccepts(range, targetNew)) continue;
				changed = bumpAtLeast(state, dependent.dir, "patch", "dependencies") || changed;
			}
		}
		for (const group of workspace.fixed) {
			let groupBump: BumpType | undefined;
			for (const dir of group) {
				const entry = state.get(dir);
				if (entry !== undefined) groupBump = maxBump(groupBump, entry.bump);
			}
			if (groupBump === undefined) continue;
			for (const dir of group) changed = bumpAtLeast(state, dir, groupBump, "fixed") || changed;
		}
		for (const epic of workspace.epics) {
			if (rebaseFloor(epic, next) === undefined) continue;
			for (const member of epic.members) changed = bumpAtLeast(state, member, "major", "epic") || changed;
		}
		return changed;
	};

	let next = computeVersions();
	while (propagate(next)) next = computeVersions();

	const releases: Array<PnpmRelease> = [...state.keys()].sort(byKey).map((dir) => {
		const entry = state.get(dir) as BumpState;
		const own = [...(pending.get(dir) ?? []), ...(workspace.lanes.has(dir) ? [] : (laneConsumed.get(dir) ?? []))];
		return {
			name: participant(dir).name,
			dir,
			type: entry.bump,
			oldVersion: participant(dir).current,
			newVersion: ctx.snapshotSuffix === undefined ? (next.get(dir) as string) : `0.0.0-${ctx.snapshotSuffix}`,
			changesets: own.map((intent) => intent.changeset.id),
			causes: sortCauses(entry.causes),
		};
	});
	releases.sort((a, b) => byKey(a.name, b.name) || byKey(a.dir, b.dir));

	// `assert_no_duplicate_release_identity`, plan/propagation.rs:273.
	const identities = new Map<string, string>();
	for (const release of releases) {
		const identity = `${release.name}@${release.newVersion}`;
		const first = identities.get(identity);
		if (first !== undefined) {
			throw new Halt(
				new VersioningError({
					reason: "duplicateRelease",
					package: release.name,
					version: release.newVersion,
					directories: [first, release.dir],
				}),
			);
		}
		identities.set(identity, release.dir);
	}

	if (ctx.snapshotSuffix === undefined) {
		enforceEpicBands(workspace, next, rebaseFloor);
		enforceMaxBump(releases, ctx);
	}
	return releases;
};

/** `enforce_epic_bands`, plan/versions.rs:316, with `epic_band` (plan/versions.rs:295). */
const enforceEpicBands = (
	workspace: Workspace,
	next: ReadonlyMap<string, string>,
	rebaseFloor: (epic: Epic, next: ReadonlyMap<string, string>) => number | undefined,
): void => {
	for (const epic of workspace.epics) {
		const floor = rebaseFloor(epic, next);
		const lead = mustParse((workspace.participants.get(epic.leadDir) as Participant).current);
		const bandMajor =
			floor !== undefined
				? floor / 100
				: isPrerelease(lead) && lead.minor === 0 && lead.patch === 0
					? Math.max(0, lead.major - 1)
					: lead.major;
		for (const member of epic.members) {
			const version = next.get(member);
			if (version === undefined) continue;
			const major = mustParse(version).major;
			if (major < bandMajor * 100 || major > bandMajor * 100 + 99) {
				throw new Halt(
					new VersioningError({
						reason: "epicOutOfBand",
						package: (workspace.participants.get(member) as Participant).name,
						version,
						lead: epic.lead,
						bandMajor,
					}),
				);
			}
		}
	}
};

/** `enforce_max_bump` and `effective_bump_class`, plan/versions.rs:369-436. */
const enforceMaxBump = (releases: ReadonlyArray<PnpmRelease>, ctx: Assembly): void => {
	const cap = ctx.versioning?.maxBump;
	if (cap === undefined) return;
	for (const release of releases) {
		const current = parse(release.oldVersion);
		const next = parse(release.newVersion);
		let effective: BumpType = release.type;
		if (current !== undefined && next !== undefined) {
			const distance: BumpType | undefined =
				next.major !== current.major
					? "major"
					: next.minor !== current.minor
						? "minor"
						: next.patch !== current.patch
							? "patch"
							: undefined;
			if (distance !== undefined) effective = maxBump(effective, distance);
		}
		if (BUMP_ORDER[effective] <= BUMP_ORDER[cap]) continue;
		// pnpm reads every key of each consumed intent, not only this release's (plan/versions.rs:381-389).
		const files = ctx.intents
			.filter(
				(intent) =>
					release.changesets.includes(intent.changeset.id) &&
					[...intent.changeset.releases.values()].includes(effective),
			)
			.map((intent) => `.changeset/${intent.changeset.file}`);
		throw new Halt(
			new VersioningError({
				reason: "maxBumpExceeded",
				package: release.name,
				bump: effective,
				maxBump: cap,
				raisedBy: files.length > 0 ? files : [...release.causes],
			}),
		);
	}
};

/**
 * Plan a pnpm-native release. With `published` the plan is made twice, as
 * `pnpm version -r` makes it (crates/cli/src/cli_args/version/release.rs:86-115):
 * once with nothing unpublished, then again with every public release of that
 * first plan whose directory `published` lacks treated as a first release
 * (`unpublished_release_dirs`, crates/cli/src/cli_args/changelog.rs:251). pnpm's
 * probe asks whether the registry has exactly the manifest version
 * (`package.versions.contains_key(version)`, changelog.rs:322), which is what
 * a directory's membership means.
 */
export const planPnpm = (input: PnpmPlanInput): Result.Result<PnpmPlan, PnpmError> => {
	try {
		const projects: ReadonlyArray<Project> = input.packages.map((pkg) => ({
			dir: projectDir(pkg.relativePath),
			name: pkg.name,
			version: pkg.version,
			private: pkg.private,
			prod: PROD_FIELDS.flatMap((field) => Object.entries(pkg[field]).map(([alias, spec]) => ({ field, alias, spec }))),
		}));
		const workspace = resolveWorkspace(projects, input.versioning);
		// pnpm reads only `.changeset/*.md`; `.changeset/pre/` is the Changesets CLI's.
		const changesets = input.changesets.filter((changeset) => !changeset.file.startsWith("pre/"));
		const intents = resolveIntents(changesets, workspace);
		if (input.enforceWorkspaceProtocol === true) {
			for (const participant of workspace.participants.values()) {
				const dep = participant.internalDeps.find((d) => !d.spec.startsWith("workspace:"));
				if (dep !== undefined) {
					throw new Halt(
						new VersioningError({
							reason: "internalRange",
							package: participant.name,
							dependency: { alias: dep.alias, field: dep.field, specifier: dep.spec },
						}),
					);
				}
			}
		}
		const ctx: Assembly = {
			workspace,
			intents,
			consumption: consumptionIndex(input.ledger, workspace.refs),
			versioning: input.versioning,
			snapshotSuffix: input.snapshotSuffix,
		};
		let releases = assembleOnce(ctx, new Set());
		const published = input.published;
		if (published !== undefined) {
			const unpublished = new Set(
				releases
					.filter((release) => !(workspace.participants.get(release.dir) as Participant).private)
					.filter((release) => !published.has(release.dir))
					.map((release) => release.dir),
			);
			if (unpublished.size > 0) releases = assembleOnce(ctx, unpublished);
		}
		const consumedIds = new Set(releases.flatMap((release) => release.changesets));
		return Result.succeed({ releases, consumed: changesets.filter((changeset) => consumedIds.has(changeset.id)) });
	} catch (error) {
		if (error instanceof Halt) return Result.fail(error.failure);
		throw error;
	}
};
