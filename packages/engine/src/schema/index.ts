/**
 * The `effected schema` machinery the tool's front ends share.
 *
 * @packageDocumentation
 */

export { AjvInstanceValidator } from "./AjvInstanceValidator.js";
export { AjvValidator } from "./AjvValidator.js";
export {
	ConfigLoadError,
	type ConfigLoadOptions,
	ConfigLoader,
	ConfigNotFoundError,
	type LoadedConfig,
} from "./ConfigLoader.js";
export { Report } from "./Report.js";
export {
	CatalogDirError,
	FrozenVersionIdMismatchError,
	FrozenVersionMissingError,
	type RunOptions,
	Runner,
} from "./Runner.js";
export {
	CatalogConflict,
	CatalogReport,
	CatalogSliceReport,
	DocumentDiff,
	InvalidSlice,
	LineDiffHunkSchema,
	LineDiffLineSchema,
	MergedCatalogReport,
	RunReport,
	type SchemaOutcome,
	SchemaReport,
} from "./RunReport.js";
export {
	ConflictingFlagsError,
	type SchemaProgress,
	SchemaRun,
	type SchemaRunDeps,
	type SchemaRunInput,
	SchemaRunResult,
} from "./SchemaRun.js";
export { StepSummary } from "./StepSummary.js";
export { VersionCheck, VersionMismatch, VersionMismatchError } from "./VersionCheck.js";
