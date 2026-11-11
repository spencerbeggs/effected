/**
 * The `effected package build`, `effected action build` and `effected action init` machinery the tool's front ends share.
 *
 * @packageDocumentation
 */

export type { BuildIssues, BuildReport, BundleResult, ValidationIssue } from "@effected/bundler";
export {
	ActionBuildResult,
	ActionValidation,
	BuildResult,
	ValidationResult,
	renderCiAnnotations,
} from "@effected/bundler";
export {
	ActionInit,
	type ActionInitDeps,
	type ActionInitInput,
	ActionInitResult,
	ActionMetadataInvalidError,
	ActionMetadataMissingError,
	ActionScaffold,
	ActionScaffoldFile,
	type ActionScaffoldInput,
	ScaffoldConflict,
	ScaffoldConflictError,
	ScaffoldExistsError,
	ScaffoldWriteError,
} from "./ActionInit.js";
export { ActionRun, type ActionRunDeps, type ActionRunInput, NotAnActionError } from "./ActionRun.js";
export { ActionRunResult } from "./ActionRunResult.js";
export { BuildLockHolder, type BuildLockOptions, BuildLockTimeoutError } from "./BuildLock.js";
export {
	type BuildProgress,
	BuildRun,
	type BuildRunDeps,
	type BuildRunInput,
	NotAPackageError,
} from "./BuildRun.js";
export { BuildRunResult } from "./BuildRunResult.js";
