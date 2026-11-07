import { Schema } from "effect";

/**
 * A changeset file could not be parsed: no front matter, a malformed YAML
 * block, or a bump outside `patch | minor | major`.
 *
 * @public
 */
export class ChangesetParseError extends Schema.TaggedError<ChangesetParseError>()("ChangesetParseError", {
	/** What was wrong with the file. */
	reason: Schema.String,
	/** The 1-based line the problem was found on, when known. */
	line: Schema.optionalKey(Schema.Number),
	/** The changeset file name, when the file was read from `.changeset/`. */
	file: Schema.optionalKey(Schema.String),
}) {
	override get message(): string {
		const where = this.file === undefined ? "" : ` (${this.file}${this.line === undefined ? "" : `:${this.line}`})`;
		return `Invalid changeset${where}: ${this.reason}`;
	}
}

/**
 * `.changeset/config.json` is missing, is not valid JSON, or does not match
 * the documented shape.
 *
 * @public
 */
export class ChangesetConfigError extends Schema.TaggedError<ChangesetConfigError>()("ChangesetConfigError", {
	/** `"missing"` when the file does not exist, otherwise what was wrong. */
	reason: Schema.String,
}) {
	override get message(): string {
		return `Invalid changeset config: ${this.reason}`;
	}
}

/**
 * The repository uses a changesets mode the release planner does not model:
 * pre-release (`.changeset/pre.json` present), snapshot, or a `fixed` or
 * `linked` group.
 *
 * @public
 */
export class UnsupportedChangesetModeError extends Schema.TaggedError<UnsupportedChangesetModeError>()(
	"UnsupportedChangesetModeError",
	{
		/** The unsupported mode. */
		mode: Schema.Literals(["pre", "snapshot", "fixed", "linked"]),
	},
) {
	override get message(): string {
		return `Changesets ${this.mode} mode is not supported`;
	}
}

/**
 * A changeset names a package the workspace does not contain.
 *
 * @public
 */
export class UnknownPackageError extends Schema.TaggedError<UnknownPackageError>()("UnknownPackageError", {
	/** The package name the changeset gave. */
	packageName: Schema.String,
	/** The changeset file that named it. */
	changeset: Schema.String,
}) {
	override get message(): string {
		return `Changeset ${this.changeset} names ${this.packageName}, which is not in the workspace`;
	}
}
