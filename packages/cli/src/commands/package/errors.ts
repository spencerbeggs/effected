// What `effected package build` turns into exit codes. The engine answers a failed build as data, because the MCP
// returns it as data; here it becomes a failure, after the report has been emitted.

import { Schema } from "effect";

/**
 * The build crashed or recorded an error. Exit `1`.
 *
 * @public
 */
export class BuildFailedError extends Schema.TaggedError<BuildFailedError>()("BuildFailedError", {
	/** How many errors the build recorded. */
	errors: Schema.Number,
	/** What ended the build, when it did not reach its end. */
	failure: Schema.optionalKey(Schema.String),
}) {
	override get message(): string {
		const count = `${this.errors} error(s)`;
		return this.failure !== undefined
			? `The build failed with ${count}: ${this.failure}`
			: `The build recorded ${count}.`;
	}
}

/**
 * The build could not run: its `effected.toml` or a plugin would not load, the directory is not a package, or the
 * bundler refused the config before any work. Exit `2`: exit `1` means it ran and found a problem.
 *
 * @remarks
 * Carries the engine's message, which names the file at fault and the key within it. This command's own type rather
 * than the bundler's, because the CLI reaches the bundler only through the engine.
 *
 * @public
 */
export class PackageConfigError extends Schema.TaggedError<PackageConfigError>()("PackageConfigError", {
	message: Schema.String,
}) {}
