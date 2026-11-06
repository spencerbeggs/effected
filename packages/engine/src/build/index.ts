/**
 * The `effected package build` and `effected action build` machinery the tool's front ends share.
 *
 * @packageDocumentation
 */

export type { BuildIssues, BuildReport, BundleResult, ValidationIssue } from "@effected/bundler";
export { ActionBuildResult, BuildResult, ValidationResult, renderCiAnnotations } from "@effected/bundler";
export { ActionRun, type ActionRunDeps, type ActionRunInput, NotAnActionError } from "./ActionRun.js";
export { ActionRunResult } from "./ActionRunResult.js";
export {
	type BuildProgress,
	BuildRun,
	type BuildRunDeps,
	type BuildRunInput,
	NotAPackageError,
} from "./BuildRun.js";
export { BuildRunResult } from "./BuildRunResult.js";
