/**
 * The `effected` command's tree and version. The runnable program is the
 * `./main` entrypoint.
 *
 * @packageDocumentation
 */

export { BuildFailedError, PackageConfigError } from "./commands/package/errors.js";
export type { PackageCommandDeps } from "./commands/package/execute.js";
export type { CommandDeps } from "./commands/root.js";
export { makeRootCommand } from "./commands/root.js";
export {
	CatalogMergeError,
	DriftError,
	GateError,
	NoConfigError,
	StaleError,
	ValidationFailedError,
} from "./commands/schema/errors.js";
export type { SchemaCommandDeps } from "./commands/schema/execute.js";
export { CLI_VERSION } from "./version.js";
