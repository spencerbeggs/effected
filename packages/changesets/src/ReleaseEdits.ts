import { posix } from "node:path";
import type { ComparatorSet } from "@effected/semver";
import { InvalidVersionError, SemVer } from "@effected/semver";
import type { WorkspacePackage } from "@effected/workspaces";
import { Result, Schema } from "effect";
import type { ReleaseType } from "./BumpType.js";
import type { ChangesetConfig } from "./ChangesetConfig.js";
import { MissingPackageError } from "./errors.js";
import {
	DEPENDENCY_KINDS,
	WORKSPACE,
	cleanVersion,
	increment,
	matchNames,
	parseRange,
	satisfies,
	shouldUpdate,
	writtenSets,
} from "./internal/versions.js";
import type { PendingChangeset } from "./PendingChangesets.js";
import { PreState } from "./PreState.js";

/**
 * One dependency range a release rewrites in a manifest.
 *
 * @public
 */
export class RangeEdit extends Schema.Class<RangeEdit>("RangeEdit")({
	/** The manifest field holding the range. */
	kind: Schema.Literals(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]),
	/** The dependency's package name: the key under `kind`. */
	dependency: Schema.String,
	/** The specifier as the manifest has it now. */
	from: Schema.String,
	/** The specifier the release writes. */
	to: Schema.String,
}) {}

/**
 * What a release changes in one `package.json`.
 *
 * @public
 */
export class ManifestEdit extends Schema.Class<ManifestEdit>("ManifestEdit")({
	/** The package name. */
	name: Schema.String,
	/** The absolute path of the `package.json` to edit. */
	packageJsonPath: Schema.String,
	/**
	 * The `version` the release writes. Absent when the version does not move:
	 * a `none` entry, or the workspace root, whose ranges alone are edited.
	 */
	version: Schema.optionalKey(Schema.String),
	/** The dependency ranges the release rewrites, in the order `changeset version` edits them. */
	ranges: Schema.Array(RangeEdit),
}) {}

/**
 * A pending changeset a pre-release consumes: `changeset version` in pre mode
 * moves it under `.changeset/pre/` rather than deleting it.
 *
 * The caller creates `.changeset/pre/` first when it does not exist, as
 * `changeset version` does (`mkdir -p`): a plain rename into a missing
 * directory fails on the first pre-release.
 *
 * @public
 */
export class ChangesetMove extends Schema.Class<ChangesetMove>("ChangesetMove")({
	/** The file now, relative to `.changeset/`. */
	from: Schema.String,
	/** Where it goes, relative to `.changeset/`: `pre/<file>`. */
	to: Schema.String,
}) {}

/**
 * Everything `changeset version` writes for a {@link ReleasePlan}, as data,
 * CHANGELOG files aside. {@link ReleasePlan.edits} computes it; the caller
 * does the IO.
 *
 * @public
 */
export class ReleaseEdits extends Schema.Class<ReleaseEdits>("ReleaseEdits")({
	/**
	 * One entry per `package.json` that changes, in plan order with the
	 * workspace root last. A manifest nothing changes in is left out, and so is
	 * an edit that would write the value already there.
	 */
	manifests: Schema.Array(ManifestEdit),
	/** The changeset files to delete, relative to `.changeset/`. */
	deleteChangesets: Schema.Array(Schema.String),
	/** The changeset files to move under `.changeset/pre/`; only ever non-empty in pre mode. */
	moveChangesets: Schema.Array(ChangesetMove),
	/**
	 * `.changeset/pre.json` as the release leaves it. Absent when the release
	 * leaves no `pre.json`: the plan had none, or it was in `exit` mode and is
	 * not a snapshot, so the file is deleted. When present it equals the
	 * plan's {@link PreState}: `changeset version` never rewrites the file.
	 */
	preState: Schema.optionalKey(PreState),
}) {}

/** The parts of a planned release the edits read. */
export interface Release {
	readonly name: string;
	readonly type: ReleaseType;
	readonly oldVersion: string;
	readonly newVersion: string;
}

/** The plan as {@link computeEdits} reads it, without importing `ReleasePlan`. */
export interface EditsPlan {
	readonly releases: ReadonlyArray<Release>;
	readonly changesets: ReadonlyArray<PendingChangeset>;
	readonly preState?: PreState;
	readonly snapshot: boolean;
}

class Halt {
	constructor(readonly failure: MissingPackageError | InvalidVersionError) {}
}

const unsafeOption = (config: ChangesetConfig, key: string): unknown => {
	const options = config.extra.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH;
	return typeof options === "object" && options !== null ? (options as Record<string, unknown>)[key] : undefined;
};

const isPrerelease = (version: string): boolean => {
	const parsed = Result.getOrUndefined(SemVer.parseResult(cleanVersion(version)));
	return parsed !== undefined && parsed.prerelease.length > 0;
};

/** `apply-release-plan`'s `getVersionRangeType`: the operator prefix a rewritten range keeps. */
const rangePrefix = (range: string): string =>
	range.startsWith("^")
		? "^"
		: range.startsWith("~")
			? "~"
			: range.startsWith(">=")
				? ">="
				: range.startsWith("<=")
					? "<="
					: range.startsWith(">")
						? ">"
						: "";

/**
 * `apply-release-plan`'s `getNewDependencyRange`. A single set of exactly two
 * comparators written with both a `>` and a `<` keeps its upper bound while
 * the new version satisfies it, else takes `<` the new version bumped again
 * by the release type, and its lower bound becomes `>=` the new version, in
 * the order the range was written. Anything else is the range's leading
 * operator before the new version.
 */
const newRange = (
	written: string,
	sets: ReadonlyArray<ComparatorSet>,
	newVersion: string,
	type: ReleaseType,
): string => {
	const comparators = sets.length === 1 ? (sets[0] as ComparatorSet) : [];
	if (comparators.length === 2 && written.includes(">") && written.includes("<")) {
		const lower = comparators.find((c) => c.operator.startsWith(">"));
		const upper = comparators.find((c) => c.operator.startsWith("<"));
		if (lower !== undefined && upper !== undefined) {
			let bound = upper.toString();
			if (!satisfies(newVersion, bound)) {
				const parsed = Result.getOrUndefined(SemVer.parseResult(cleanVersion(newVersion)));
				if (parsed === undefined || type === "none") throw new Halt(new InvalidVersionError({ input: newVersion }));
				bound = `<${increment(parsed, type).toString()}`;
			}
			return comparators[0] === lower ? `>=${newVersion} ${bound}` : `${bound} >=${newVersion}`;
		}
	}
	return `${rangePrefix(written)}${newVersion}`;
};

/** `apply-release-plan`'s `getDependencyVersionEdits` over one manifest. */
const rangeEdits = (
	pkg: WorkspacePackage,
	releases: ReadonlyArray<Release>,
	options: {
		readonly minimum: "patch" | "minor";
		readonly onlyPeersOutOfRange: boolean;
		readonly workspaceProtocolOnly: boolean;
		readonly snapshot: boolean;
	},
	pathOf: (name: string) => string,
): ReadonlyArray<RangeEdit> => {
	const edits: Array<RangeEdit> = [];
	for (const kind of DEPENDENCY_KINDS) {
		const declared = pkg[kind];
		for (const release of releases) {
			if (release.type === "none" || !Object.hasOwn(declared, release.name)) continue;
			const from = declared[release.name] as string;
			if (from === "" || from.startsWith("file:") || from.startsWith("link:")) continue;
			if (!shouldUpdate(release, from, kind, options, pathOf(release.name))) continue;
			const isWorkspace = WORKSPACE.test(from);
			if (!isWorkspace && (options.workspaceProtocolOnly || parseRange(from) === undefined)) continue;
			const bare = from.replace(WORKSPACE, "");
			if (isWorkspace && (bare === "*" || bare === "^" || bare === "~")) continue;
			const range = parseRange(bare);
			const sets = writtenSets(bare);
			if (range === undefined || sets === undefined) continue;
			if (range.isAny() && !isPrerelease(release.newVersion)) continue;
			const next = options.snapshot ? release.newVersion : newRange(bare, sets, release.newVersion, release.type);
			const to = isWorkspace ? `workspace:${next}` : next;
			if (to !== from) edits.push(RangeEdit.make({ kind, dependency: release.name, from, to }));
		}
	}
	return edits;
};

/**
 * The computation behind {@link ReleasePlan.edits}; see it for the rules.
 *
 * @internal
 */
export const computeEdits = (
	plan: EditsPlan,
	input: { readonly packages: ReadonlyArray<WorkspacePackage>; readonly config: ChangesetConfig },
): Result.Result<ReleaseEdits, MissingPackageError | InvalidVersionError> => {
	try {
		return Result.succeed(editsOrHalt(plan, input));
	} catch (error) {
		if (error instanceof Halt) return Result.fail(error.failure);
		throw error;
	}
};

const editsOrHalt = (
	plan: EditsPlan,
	input: { readonly packages: ReadonlyArray<WorkspacePackage>; readonly config: ChangesetConfig },
): ReleaseEdits => {
	const { packages, config } = input;
	const byName = new Map(packages.filter((pkg) => !pkg.isRootWorkspace).map((pkg) => [pkg.name, pkg]));
	const root = packages.find((pkg) => pkg.isRootWorkspace);
	const options = {
		minimum: config.updateInternalDependencies,
		onlyPeersOutOfRange: unsafeOption(config, "onlyUpdatePeerDependentsWhenOutOfRange") === true,
		workspaceProtocolOnly: config.extra.bumpVersionsWithWorkspaceProtocolOnly === true,
		snapshot: plan.snapshot,
	};

	const pathOf = (name: string): string => byName.get(name)?.relativePath ?? root?.relativePath ?? ".";
	const manifests: Array<ManifestEdit> = [];
	const edited = new Set<string>();
	for (const release of plan.releases) {
		const pkg = byName.get(release.name) ?? (root?.name === release.name ? root : undefined);
		if (pkg === undefined) throw new Halt(new MissingPackageError({ packageName: release.name }));
		edited.add(pkg.packageJsonPath);
		const ranges = rangeEdits(pkg, plan.releases, options, pathOf);
		const moves = release.newVersion !== pkg.version;
		if (!moves && ranges.length === 0) continue;
		manifests.push(
			ManifestEdit.make({
				name: pkg.name,
				packageJsonPath: pkg.packageJsonPath,
				...(moves ? { version: release.newVersion } : {}),
				ranges,
			}),
		);
	}
	if (root !== undefined && !edited.has(root.packageJsonPath)) {
		const ranges = rangeEdits(root, plan.releases, options, pathOf);
		if (ranges.length > 0) {
			manifests.push(ManifestEdit.make({ name: root.name, packageJsonPath: root.packageJsonPath, ranges }));
		}
	}

	// A changeset naming a skipped package is left in place, as
	// `changeset version` leaves it.
	const ignored = new Set(matchNames(packages, config.ignore));
	const isSkipped = (name: string): boolean => {
		const pkg = byName.get(name) ?? (root?.name === name ? root : undefined);
		return (
			pkg === undefined ||
			ignored.has(name) ||
			(pkg.private && !config.privatePackages.version) ||
			pkg.version === undefined ||
			pkg.version === ""
		);
	};
	const consumed = plan.changesets.filter((changeset) => ![...changeset.releases.keys()].some(isSkipped));
	const pre = plan.preState?.mode === "pre";
	return ReleaseEdits.make({
		manifests,
		deleteChangesets: pre ? [] : consumed.map((changeset) => changeset.file),
		moveChangesets: pre
			? consumed.map((changeset) => ChangesetMove.make({ from: changeset.file, to: posix.join("pre", changeset.file) }))
			: [],
		...(plan.preState !== undefined && (pre || plan.snapshot) ? { preState: plan.preState } : {}),
	});
};
