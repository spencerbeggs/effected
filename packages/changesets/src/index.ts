/**
 * Changeset files, `.changeset/config.json` and the release plan as Effect
 * schemas and pure functions.
 *
 * @remarks
 * {@link ChangesetFile} parses one file and {@link PendingChangesets} reads a
 * repository's pending set. {@link ChangesetConfig} decodes the config.
 * {@link ReleasePlan} works out what those release, including packages reached
 * only as dependents. Nothing here writes a changeset or versions a package.
 *
 * @packageDocumentation
 */

export { BreakingFloor, FloorCause } from "./BreakingFloors.js";
export { BumpType, ReleaseType } from "./BumpType.js";
export type {
	ChangelogEntryOptions,
	ChangelogFunctions,
	GetDependencyReleaseLine,
	GetReleaseLine,
} from "./Changelog.js";
export {
	Changelog,
	ChangelogError,
	ComprehensiveRelease,
	ModCompWithPackage,
	NewChangeset,
	NewChangesetWithCommit,
	PackageJSON,
	VersionType,
} from "./Changelog.js";
export { ChangesetConfig } from "./ChangesetConfig.js";
export { ChangesetFile, ParsedChangeset } from "./ChangesetFile.js";
export {
	ChangesetConfigError,
	ChangesetParseError,
	MissingPackageError,
	SnapshotPreModeError,
	SnapshotTemplateError,
	UnknownPackageError,
} from "./errors.js";
export type { PendingChangesetFailure, SettledChangesets } from "./PendingChangesets.js";
export { PendingChangeset, PendingChangesets } from "./PendingChangesets.js";
export { PreState } from "./PreState.js";
export { ChangesetMove, ManifestEdit, RangeEdit, ReleaseEdits } from "./ReleaseEdits.js";
export type { ReleaseManagerDetectOptions } from "./ReleaseManager.js";
export { ReleaseManager } from "./ReleaseManager.js";
export type { ReleaseSnapshot } from "./ReleasePlan.js";
export { PlannedRelease, ReleaseContext, ReleasePlan } from "./ReleasePlan.js";
