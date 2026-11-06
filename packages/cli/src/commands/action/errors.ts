// What `effected action build` turns into exit codes. The engine answers a failed build as data, because the MCP returns
// it as data; here it becomes a failure, after the report has been emitted.

import { Schema } from "effect";

/**
 * Validation stopped the build or an entry failed. Exit `1`.
 *
 * @public
 */
export class ActionBuildFailedError extends Schema.TaggedError<ActionBuildFailedError>()("ActionBuildFailedError", {
	/** How many validation errors there were. */
	errors: Schema.Number,
	/** How many entries failed to bundle or load. */
	failedEntries: Schema.Number,
}) {
	override get message(): string {
		const parts = [
			...(this.errors > 0 ? [`${this.errors} validation error(s)`] : []),
			...(this.failedEntries > 0 ? [`${this.failedEntries} failed entry(ies)`] : []),
		];
		return parts.length > 0
			? `The action build failed with ${parts.join(" and ")}.`
			: "The action build failed: warnings are errors in strict mode.";
	}
}

/**
 * The build could not start: its `effected.toml` would not load, it has no `[action]` table, or the directory is not a
 * package. Exit `2`: exit `1` means it ran and found a problem.
 *
 * @remarks
 * Carries the engine's message. This command's own type rather than the engine's, because the engine's build entry is
 * loaded only when the command runs.
 *
 * @public
 */
export class ActionConfigError extends Schema.TaggedError<ActionConfigError>()("ActionConfigError", {
	message: Schema.String,
}) {}

/**
 * The build could not finish: an entry is missing with validation off, or a file could not be cleaned, written or
 * copied. Exit `3`, the infrastructure tier.
 *
 * @remarks
 * Carries the engine's message, as {@link ActionConfigError} does.
 *
 * @public
 */
export class ActionRunError extends Schema.TaggedError<ActionRunError>()("ActionRunError", {
	message: Schema.String,
}) {}
