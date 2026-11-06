import type { FileSystem, Path, PlatformError } from "effect";
import { Effect, Schema } from "effect";
import type { ActionConfig } from "../config/ActionConfig.js";
import { ActionBundle, BuildResult } from "./ActionBundle.js";
import type { ActionYmlPathError, BundleFailed, CleanError, PersistLocalError, WriteError } from "./ActionErrors.js";
import { ActionValidation, ValidationResult } from "./ActionValidation.js";
import { PersistLocal } from "./PersistLocal.js";

/**
 * Validation stopped an action build, before bundling or on a bundle's size afterwards.
 *
 * @public
 */
export class ValidationFailed extends Schema.TaggedError<ValidationFailed>()("ValidationFailed", {
	/** How many errors it found. */
	errorCount: Schema.Number,
	/** How many warnings it found. */
	warningCount: Schema.Number,
	/** A summary. */
	message: Schema.String,
	/** Everything it found. */
	validation: ValidationResult,
}) {}

/**
 * An entry of an action failed to bundle or does not load.
 *
 * @public
 */
export class BuildFailed extends Schema.TaggedError<BuildFailed>()("BuildFailed", {
	/** A summary. */
	message: Schema.String,
	/** How many entries failed. */
	failedEntries: Schema.Number,
	/** Every entry's result. */
	build: BuildResult,
}) {}

/**
 * What {@link ActionBuilder.build} can fail with.
 *
 * @public
 */
export type ActionBuilderError =
	| ValidationFailed
	| BuildFailed
	| BundleFailed
	| CleanError
	| WriteError
	| PersistLocalError
	| ActionYmlPathError
	| PlatformError.PlatformError;

/**
 * What {@link ActionBuilder.build} takes.
 *
 * @public
 */
export interface ActionBuilderOptions {
	/** The action's directory. */
	readonly cwd: string;
	/** The decoded `[action]` table. */
	readonly config: ActionConfig;
	/** Whether to validate before bundling and check bundle sizes after it. */
	readonly validate: boolean;
	/** Whether to copy the build locally. `persistLocal.enabled = false` turns that off too. */
	readonly persist: boolean;
	/** Whether this run is under CI, which is what an unset `validation.strict` follows. Read from the process when absent. */
	readonly ci?: boolean;
}

/**
 * What a whole action build did.
 *
 * @public
 */
export class ActionBuildResult extends Schema.Class<ActionBuildResult>("ActionBuildResult")({
	/** What validation found, including any bundle over its size limit. Empty and valid when validation was skipped. */
	validation: ValidationResult,
	/** How bundling went. */
	build: BuildResult,
	/** Whether the build was copied to the local action directory. */
	persisted: Schema.Boolean,
}) {}

const failValidation = (validation: ValidationResult): ValidationFailed =>
	new ValidationFailed({
		errorCount: validation.errors.length,
		warningCount: validation.warnings.length,
		message: validation.errors.length > 0 ? "Validation failed" : "Warnings treated as errors in strict mode",
		validation,
	});

/**
 * Builds a GitHub Action.
 *
 * @public
 */
export class ActionBuilder {
	private constructor() {}

	/**
	 * Validates the action, bundles it, checks the bundles' sizes and copies the build locally.
	 *
	 * @remarks
	 * It writes nothing to stdout; rendering belongs to the caller. A step that fails stops the ones after it, so an
	 * invalid action leaves `dist` as it was, and a failed build or size check persists nothing. In strict mode, set
	 * by `validation.strict` or else by running under CI, a warning fails like an error. With `validate` false, neither
	 * validation nor the size check runs. Each bundle is still imported to prove it loads, per
	 * {@link ActionBundle.build}.
	 */
	static readonly build: (
		options: ActionBuilderOptions,
	) => Effect.Effect<ActionBuildResult, ActionBuilderError, FileSystem.FileSystem | Path.Path> = Effect.fn(
		"ActionBuilder.build",
	)(function* (options: ActionBuilderOptions) {
		const { config, cwd } = options;
		const run = options.ci !== undefined ? { ci: options.ci } : undefined;
		const strict = ActionValidation.isStrict(config, run);

		const before = options.validate
			? yield* ActionValidation.validate(config, cwd, run)
			: ActionValidation.resultOf([], [], false);
		if (!before.valid) return yield* failValidation(before);

		const build = yield* ActionBundle.build(config, { cwd, clean: true });
		if (!build.success) {
			return yield* new BuildFailed({
				message: build.error ?? "One or more entries failed to build",
				failedEntries: build.entries.filter((entry) => !entry.success).length,
				build,
			});
		}

		const oversized = options.validate
			? ActionValidation.checkBundleSizes(
					config,
					build.entries.flatMap((entry) => (entry.stats !== undefined ? [entry.stats] : [])),
				)
			: [];
		const validation = ActionValidation.resultOf(
			before.errors,
			[...before.warnings, ...oversized],
			strict && options.validate,
		);
		if (!validation.valid) return yield* failValidation(validation);

		const persisted = options.persist && config.persistLocal.enabled;
		if (persisted) yield* PersistLocal.persist(config, { cwd });

		return ActionBuildResult.make({ validation, build, persisted });
	});
}
