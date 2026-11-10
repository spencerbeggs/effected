import { RuntimeEnv } from "@effected/env";
import { Yaml } from "@effected/yaml";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import type { ActionConfig } from "../config/ActionConfig.js";
import { ActionYml } from "./ActionYml.js";
import { invalidWorkerName, workerSource } from "./entries.js";

/**
 * One problem a validation found.
 *
 * @public
 */
export class ValidationIssue extends Schema.Class<ValidationIssue>("ValidationIssue")({
	/** What kind of problem it is, such as `MAIN_ENTRY_MISSING`. */
	code: Schema.String,
	/** What went wrong. */
	message: Schema.String,
	/** The file at fault. */
	file: Schema.optionalKey(Schema.String),
	/** How to fix it. */
	suggestion: Schema.optionalKey(Schema.String),
}) {}

/**
 * What a validation found.
 *
 * @public
 */
export class ValidationResult extends Schema.Class<ValidationResult>("ValidationResult")({
	/** Whether the build may go ahead: no errors, and in strict mode no warnings either. */
	valid: Schema.Boolean,
	/** Problems that always stop a build. */
	errors: Schema.Array(ValidationIssue),
	/** Problems that stop a build only in strict mode. */
	warnings: Schema.Array(ValidationIssue),
}) {}

/**
 * How {@link ActionValidation.validate} decides strict mode.
 *
 * @public
 */
export interface ActionValidationRunOptions {
	/** Whether this run is under CI, which is what an unset `validation.strict` follows. */
	readonly ci: boolean;
}

const UNIT_BYTES: Readonly<Record<string, number>> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

/** A size such as `"5mb"` in bytes, counting 1024 to the next unit, or `undefined` when it does not read as one. */
const parseSize = (size: string): number | undefined => {
	const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(size.trim());
	const unit = match?.[2]?.toLowerCase();
	return match?.[1] === undefined || unit === undefined ? undefined : Number(match[1]) * (UNIT_BYTES[unit] ?? 1);
};

const formatBytes = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const issue = (code: string, message: string, file?: string, suggestion?: string): ValidationIssue =>
	ValidationIssue.make({
		code,
		message,
		...(file !== undefined ? { file } : {}),
		...(suggestion !== undefined ? { suggestion } : {}),
	});

/** Recommended fields a valid `action.yml` still leaves out. */
const recommendations = (content: Readonly<Record<string, unknown>>, file: string): ReadonlyArray<ValidationIssue> => {
	const warnings: Array<ValidationIssue> = [];
	if (!content.branding) {
		warnings.push(
			issue(
				"ACTION_YML_NO_BRANDING",
				"No branding configuration found",
				file,
				"Add branding.icon and branding.color for better marketplace visibility",
			),
		);
	} else {
		const branding = content.branding as Readonly<Record<string, unknown>>;
		if (!branding.icon) {
			warnings.push(
				issue(
					"ACTION_YML_NO_BRANDING_ICON",
					"Branding icon not specified",
					file,
					"Add branding.icon for better marketplace visibility",
				),
			);
		}
		if (!branding.color) {
			warnings.push(
				issue(
					"ACTION_YML_NO_BRANDING_COLOR",
					"Branding color not specified",
					file,
					"Add branding.color for better marketplace visibility",
				),
			);
		}
	}
	const described = (key: "inputs" | "outputs"): ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> =>
		Object.entries((content[key] ?? {}) as Readonly<Record<string, Readonly<Record<string, unknown>>>>);
	for (const [name, input] of described("inputs")) {
		if (!input.description) {
			warnings.push(
				issue(
					"ACTION_YML_INPUT_NO_DESCRIPTION",
					`Input '${name}' has no description`,
					file,
					`Add a description for the '${name}' input`,
				),
			);
		}
	}
	for (const [name, output] of described("outputs")) {
		if (!output.description) {
			warnings.push(
				issue(
					"ACTION_YML_OUTPUT_NO_DESCRIPTION",
					`Output '${name}' has no description`,
					file,
					`Add a description for the '${name}' output`,
				),
			);
		}
	}
	return warnings;
};

const checkActionYml = Effect.fnUntraced(function* (config: ActionConfig, cwd: string) {
	const errors: Array<ValidationIssue> = [];
	const warnings: Array<ValidationIssue> = [];
	if (!config.validation.requireActionYml) return { errors, warnings };

	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const file = path.resolve(cwd, "action.yml");
	if (!(yield* fs.exists(file))) {
		warnings.push(
			issue("ACTION_YML_MISSING", "action.yml not found", file, "Create action.yml to define your action metadata"),
		);
		return { errors, warnings };
	}

	const parsed = Yaml.parseResult(yield* fs.readFileString(file));
	if (Result.isFailure(parsed)) {
		errors.push(issue("ACTION_YML_SYNTAX_ERROR", parsed.failure.message, file));
		return { errors, warnings };
	}
	const content = parsed.success;
	if (!content || typeof content !== "object") {
		errors.push(issue("ACTION_YML_SYNTAX_ERROR", "action.yml must be an object", file));
		return { errors, warnings };
	}

	const decoded = yield* Effect.result(Schema.decodeUnknownEffect(ActionYml)(content));
	if (Result.isFailure(decoded)) {
		errors.push(issue("ACTION_YML_SCHEMA_ERROR", decoded.failure.message, file));
		return { errors, warnings };
	}
	warnings.push(...recommendations(content as Readonly<Record<string, unknown>>, file));
	return { errors, warnings };
});

const checkEntries = Effect.fnUntraced(function* (config: ActionConfig, cwd: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const errors: Array<ValidationIssue> = [];
	const { main, pre, post, workers } = config.entries;
	if (!(yield* fs.exists(path.resolve(cwd, main)))) {
		errors.push(
			issue(
				"MAIN_ENTRY_MISSING",
				`Main entry point not found: ${main}`,
				main,
				"Create src/main.ts or specify a different path in config",
			),
		);
	}
	for (const [name, source] of [
		["pre", pre],
		["post", post],
	] as const) {
		if (source !== undefined && !(yield* fs.exists(path.resolve(cwd, source)))) {
			errors.push(
				issue(
					"ENTRY_FILE_MISSING",
					`The ${name} entry point was not found: ${source}`,
					source,
					`Create ${source} or remove entries.${name} from the config`,
				),
			);
		}
	}
	for (const [name, worker] of Object.entries(workers)) {
		const source = workerSource(worker);
		const reason = invalidWorkerName(name);
		if (reason !== undefined) {
			errors.push(issue("WORKER_ENTRY_INVALID_NAME", `Invalid worker name "${name}": ${reason}`));
		} else if (!(yield* fs.exists(path.resolve(cwd, source)))) {
			errors.push(
				issue(
					"WORKER_ENTRY_MISSING",
					`Worker entry point not found: ${source}`,
					source,
					`Create ${source} or specify a different path for the '${name}' worker`,
				),
			);
		}
	}
	return errors;
});

/**
 * Checks an action's config, entry points and `action.yml`, and the size of what it built.
 *
 * @public
 */
export class ActionValidation {
	private constructor() {}

	/**
	 * Whether `env` describes a CI run, by `@effected/env`'s one rule: a known provider's marker, or a truthy `CI` or
	 * `CONTINUOUS_INTEGRATION`.
	 */
	static isCI(env: Readonly<Record<string, string | undefined>>): boolean {
		return Option.isSome(RuntimeEnv.fromRecord(env).ci);
	}

	/**
	 * Whether warnings stop this build: `validation.strict` when it is set, otherwise whether this is a CI run.
	 */
	static isStrict(config: ActionConfig, options: ActionValidationRunOptions): boolean {
		return config.validation.strict ?? options.ci;
	}

	/**
	 * Validates the action at `cwd` before a build.
	 *
	 * @remarks
	 * Every finding comes back in the result, whatever its severity: the effect fails only when a file cannot be
	 * read. A missing `main`, a `pre`, `post` or worker the config names with no file, a bad worker name, an unreadable `maxBundleSize` and a broken
	 * `action.yml` are errors. A missing `action.yml` and missing recommended fields are warnings, and `valid` turns
	 * false on them in strict mode.
	 *
	 * @param cwd - The action's directory.
	 * @param options - `ci` says whether this run is under CI. Answer it once at `main`, with {@link ActionValidation.isCI}.
	 */
	static readonly validate: (
		config: ActionConfig,
		cwd: string,
		options: ActionValidationRunOptions,
	) => Effect.Effect<ValidationResult, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> = Effect.fn(
		"ActionValidation.validate",
	)(function* (config: ActionConfig, cwd: string, options: ActionValidationRunOptions) {
		const entryErrors = yield* checkEntries(config, cwd);
		const { maxBundleSize } = config.validation;
		const sizeErrors =
			maxBundleSize !== undefined && parseSize(maxBundleSize) === undefined
				? [
						issue(
							"MAX_BUNDLE_SIZE_INVALID",
							`Cannot read maxBundleSize: ${maxBundleSize}`,
							undefined,
							'Write a size such as "5mb" or "500kb"',
						),
					]
				: [];
		const actionYml = yield* checkActionYml(config, cwd);
		const errors = [...entryErrors, ...sizeErrors, ...actionYml.errors];
		return ActionValidation.resultOf(errors, actionYml.warnings, ActionValidation.isStrict(config, options));
	});

	/**
	 * The bundles past `validation.maxBundleSize`, one warning each. Nothing when no limit is set or it cannot be read.
	 */
	static checkBundleSizes(
		config: ActionConfig,
		bundles: ReadonlyArray<{ readonly entry: string; readonly size: number; readonly outputPath: string }>,
	): ReadonlyArray<ValidationIssue> {
		const { maxBundleSize } = config.validation;
		const limit = maxBundleSize === undefined ? undefined : parseSize(maxBundleSize);
		if (maxBundleSize === undefined || limit === undefined) return [];
		return bundles
			.filter((bundle) => bundle.size > limit)
			.map((bundle) =>
				issue(
					"MAX_BUNDLE_SIZE_EXCEEDED",
					`Bundle '${bundle.entry}' is ${formatBytes(bundle.size)}, past the ${maxBundleSize} limit`,
					bundle.outputPath,
					"Raise validation.maxBundleSize, or move a dependency to build.externals or build.ignore",
				),
			);
	}

	/** A result from its findings: valid with no errors, and in strict mode no warnings either. */
	static resultOf(
		errors: ReadonlyArray<ValidationIssue>,
		warnings: ReadonlyArray<ValidationIssue>,
		strict: boolean,
	): ValidationResult {
		return ValidationResult.make({
			valid: errors.length === 0 && (!strict || warnings.length === 0),
			errors,
			warnings,
		});
	}
}
