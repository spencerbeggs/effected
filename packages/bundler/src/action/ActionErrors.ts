import { Schema } from "effect";
import { causeMessage } from "../internal/causeMessage.js";

/**
 * An entry could not go through the bundler, or could not be bundled at all.
 *
 * @public
 */
export class BundleFailed extends Schema.TaggedError<BundleFailed>()("BundleFailed", {
	/** The entry at fault, as its bundle name or source path. */
	entry: Schema.String,
	/** What went wrong. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Could not bundle ${this.entry}: ${causeMessage(this.cause) ?? String(this.cause)}`;
	}
}

/**
 * The output directory could not be cleaned.
 *
 * @public
 */
export class CleanError extends Schema.TaggedError<CleanError>()("CleanError", {
	/** The directory. */
	directory: Schema.String,
	/** What went wrong. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Could not clean ${this.directory}: ${causeMessage(this.cause) ?? String(this.cause)}`;
	}
}

/**
 * An output file could not be written.
 *
 * @public
 */
export class WriteError extends Schema.TaggedError<WriteError>()("WriteError", {
	/** The file. */
	path: Schema.String,
	/** What went wrong. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Could not write ${this.path}: ${causeMessage(this.cause) ?? String(this.cause)}`;
	}
}

/**
 * A file could not be copied to the local action directory.
 *
 * @public
 */
export class PersistLocalError extends Schema.TaggedError<PersistLocalError>()("PersistLocalError", {
	/** The path involved. */
	path: Schema.String,
	/** What went wrong. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Could not persist ${this.path}: ${causeMessage(this.cause) ?? String(this.cause)}`;
	}
}

/**
 * A `runs` path in `action.yml` names no file in the local action directory.
 *
 * @public
 */
export class ActionYmlPathError extends Schema.TaggedError<ActionYmlPathError>()("ActionYmlPathError", {
	/** The `runs` key: `main`, `pre` or `post`. */
	entryType: Schema.String,
	/** The path as `action.yml` writes it. */
	specifiedPath: Schema.String,
	/** Where that path resolves to. */
	expectedPath: Schema.String,
}) {
	override get message(): string {
		return `action.yml runs.${this.entryType} is ${this.specifiedPath}, and ${this.expectedPath} does not exist`;
	}
}

/**
 * The persisted action path cannot be used.
 *
 * @remarks
 * `outside-workspace` means it resolves beyond the workspace root, `inside-package` means a workspace-based path
 * lands inside the package being built, or a package-based path lands in its `dist` or staging directory,
 * `contains-package` means it is the package or an ancestor of it, the workspace root included,
 * `inside-other-package` means it is, or lies inside, another directory holding a `package.json` (named in
 * `packageDir`), and `dist-without-persist` means `dist = false` with nothing persisted.
 *
 * @public
 */
export class PersistPathError extends Schema.TaggedError<PersistPathError>()("PersistPathError", {
	/** The path as configured, or the resolved output path. */
	path: Schema.String,
	/** Why it was refused. */
	reason: Schema.Literals([
		"outside-workspace",
		"inside-package",
		"contains-package",
		"inside-other-package",
		"dist-without-persist",
	]),
	/** The other package's directory, for `inside-other-package`. */
	packageDir: Schema.optionalKey(Schema.String),
}) {
	override get message(): string {
		if (this.reason === "outside-workspace") return `The persist path ${this.path} is outside the workspace`;
		if (this.reason === "contains-package")
			return `The persist path ${this.path} is, or contains, the package being built, and a persist would delete it`;
		if (this.reason === "inside-package")
			return `The persist path ${this.path} is inside the package being built, its dist or its staging directory`;
		if (this.reason === "inside-other-package")
			return `The persist path ${this.path} is inside the package at ${this.packageDir ?? "an unnamed directory"}, and a persist would overwrite it`;
		return "persistLocal.dist = false needs persistLocal.enabled, or the build is written nowhere";
	}
}

/**
 * Check mode needs somewhere persisted to compare against, and there is none.
 *
 * @remarks
 * `persist-disabled` means the run persists nothing, either because `persistLocal.enabled` is false or because the
 * caller turned persisting off.
 *
 * @public
 */
export class CheckUnavailable extends Schema.TaggedError<CheckUnavailable>()("CheckUnavailable", {
	/** Why there is nothing to check. */
	reason: Schema.Literals(["persist-disabled"]),
}) {
	override get message(): string {
		return "Nothing is persisted, so there is no committed build to check";
	}
}

/**
 * The run would keep no output at all: the package's `dist` is not kept (`persistLocal.dist = false`) and this run
 * persists nothing.
 *
 * @remarks
 * Raised before validating or bundling, so nothing is written. Persist the run, or keep `dist`.
 *
 * @public
 */
export class NoOutput extends Schema.TaggedError<NoOutput>()("NoOutput", {
	/** Why there is no output. */
	reason: Schema.Literals(["persist-off"]),
}) {
	override get message(): string {
		return "persistLocal.dist = false keeps no dist, and this run persists nothing, so the build would be written nowhere";
	}
}
