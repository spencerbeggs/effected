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

/**
 * A changeset names a package by a name that more than one workspace project
 * publishes, so the name identifies none of them. Name the project by its
 * `./`-prefixed workspace-relative directory instead.
 *
 * @remarks
 * Same-named projects are not yet plannable: the release plan is keyed by
 * package name, so a `./` directory key naming one of several same-named
 * projects fails this error too, listing every directory, rather than plan
 * against a twin the changeset did not name.
 *
 * @public
 */
export class AmbiguousPackageError extends Schema.TaggedError<AmbiguousPackageError>()("AmbiguousPackageError", {
	/** The package name the changeset gave. */
	packageName: Schema.String,
	/** The workspace-relative directories of the projects that publish it, in discovery order. */
	directories: Schema.Array(Schema.String),
	/** The changeset file that named it. */
	changeset: Schema.String,
}) {
	override get message(): string {
		return `Changeset ${this.changeset} names ${this.packageName}, which ${this.directories.length} projects publish (${this.directories.map((dir) => `./${dir}`).join(", ")}); name one by its ./ directory`;
	}
}

/**
 * A snapshot release was asked for while `.changeset/pre.json` has the
 * repository in pre mode. `changeset version --snapshot` refuses the same
 * way; leave pre mode (`changeset pre exit`) first.
 *
 * @public
 */
export class SnapshotPreModeError extends Schema.TaggedError<SnapshotPreModeError>()("SnapshotPreModeError", {
	/** The pre-release tag of the pre mode the repository is in. */
	preTag: Schema.String,
}) {
	override get message(): string {
		return `A snapshot release is not allowed in pre mode (tag "${this.preTag}"); exit pre mode first`;
	}
}

/**
 * A snapshot prerelease template could not be filled, for one of the two
 * reasons `@changesets/assemble-release-plan` refuses one:
 *
 * - `missingValue`: the template uses `{commit}`, `{commit-short}` or `{tag}`
 *   and the snapshot gave no value for it.
 * - `missingPlaceholder`: the snapshot gave a tag and the template has no
 *   `{tag}` to put it in.
 *
 * @public
 */
export class SnapshotTemplateError extends Schema.TaggedError<SnapshotTemplateError>()("SnapshotTemplateError", {
	/** The template that could not be filled. */
	template: Schema.String,
	/** The placeholder at fault. */
	placeholder: Schema.Literals(["commit", "commit-short", "tag"]),
	/** Which of the two refusals this is. */
	kind: Schema.Literals(["missingValue", "missingPlaceholder"]),
}) {
	override get message(): string {
		return this.kind === "missingValue"
			? `Snapshot template "${this.template}" uses {${this.placeholder}}, which has no value`
			: `Snapshot template "${this.template}" has no {${this.placeholder}} placeholder, but a ${this.placeholder} was given`;
	}
}

/**
 * A release plan names a package the packages given to
 * {@link ReleasePlan.edits} do not contain: the plan was made from a
 * different workspace than the one being edited.
 *
 * @public
 */
export class MissingPackageError extends Schema.TaggedError<MissingPackageError>()("MissingPackageError", {
	/** The package the plan releases. */
	packageName: Schema.String,
}) {
	override get message(): string {
		return `The release plan releases ${this.packageName}, which is not among the packages given`;
	}
}
