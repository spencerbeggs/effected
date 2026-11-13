import { Schema } from "effect";
import { BumpType } from "./BumpType.js";

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
 * Only a BARE name is ambiguous. Under `manager: "pnpm"` the plan is keyed by
 * directory, so a `./` key naming one of several same-named projects plans
 * that project alone; this error is pnpm's `AmbiguousPackage` for an intent
 * (`ERR_PNPM_VERSIONING_AMBIGUOUS_PACKAGE`). A Changesets plan never raises
 * it.
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

/**
 * `.changeset/ledger.yaml` is not YAML, is not a mapping of releases, or has
 * an entry that is neither a list of intent ids nor a `dir`/`intents` mapping.
 *
 * @public
 */
export class LedgerError extends Schema.TaggedError<LedgerError>()("LedgerError", {
	/** Which way the ledger was malformed. */
	code: Schema.Literals(["invalid-yaml", "not-a-mapping", "invalid-entry"]),
	/** What was wrong, naming the ledger key when one is at fault. */
	detail: Schema.String,
}) {
	override get message(): string {
		return `Invalid release ledger: ${this.detail}`;
	}
}

/**
 * The `ERR_PNPM_*` code pnpm reports for each {@link VersioningError} reason,
 * as its `VersioningError` enum declares them (`crates/versioning/src/error.rs`).
 *
 * @public
 */
export type VersioningErrorCode =
	| "ERR_PNPM_VERSIONING_MAX_BUMP_EXCEEDED"
	| "ERR_PNPM_VERSIONING_UNRELEASABLE_PACKAGE"
	| "ERR_PNPM_VERSIONING_EPIC_OUT_OF_BAND"
	| "ERR_PNPM_VERSIONING_EPIC_UNKNOWN_LEAD"
	| "ERR_PNPM_VERSIONING_EPIC_OVERLAP"
	| "ERR_PNPM_VERSIONING_EPIC_FIXED_GROUP_CONFLICT"
	| "ERR_PNPM_VERSIONING_CONFLICTING_CONFIG"
	| "ERR_PNPM_VERSIONING_DUPLICATE_RELEASE"
	| "ERR_PNPM_VERSIONING_AMBIGUOUS_PACKAGE"
	| "ERR_PNPM_INVALID_VERSIONING_LEDGER"
	| "ERR_PNPM_VERSIONING_INTERNAL_RANGE";

const VERSIONING_CODES = {
	maxBumpExceeded: "ERR_PNPM_VERSIONING_MAX_BUMP_EXCEEDED",
	unreleasablePackage: "ERR_PNPM_VERSIONING_UNRELEASABLE_PACKAGE",
	epicOutOfBand: "ERR_PNPM_VERSIONING_EPIC_OUT_OF_BAND",
	epicUnknownLead: "ERR_PNPM_VERSIONING_EPIC_UNKNOWN_LEAD",
	epicOverlap: "ERR_PNPM_VERSIONING_EPIC_OVERLAP",
	epicFixedGroupConflict: "ERR_PNPM_VERSIONING_EPIC_FIXED_GROUP_CONFLICT",
	conflictingConfig: "ERR_PNPM_VERSIONING_CONFLICTING_CONFIG",
	duplicateRelease: "ERR_PNPM_VERSIONING_DUPLICATE_RELEASE",
	ambiguousPackage: "ERR_PNPM_VERSIONING_AMBIGUOUS_PACKAGE",
	ambiguousLedgerEntry: "ERR_PNPM_INVALID_VERSIONING_LEDGER",
	internalRange: "ERR_PNPM_VERSIONING_INTERNAL_RANGE",
} as const satisfies Record<string, VersioningErrorCode>;

/**
 * pnpm's native versioning refuses the plan: a `versioning` rule in
 * `pnpm-workspace.yaml` is broken by the plan, the configuration cannot be
 * attributed to one project, or an intent asks for a release pnpm cannot make.
 * Only {@link ReleasePlan.assemble} under `manager: "pnpm"` fails with it.
 *
 * @remarks
 * Each `reason` is one of pnpm's own refusals, and `code` is the
 * `ERR_PNPM_*` code pnpm prints for it, so a caller comparing with
 * `pnpm change status` compares codes:
 *
 * - `maxBumpExceeded`: a release moves further than `versioning.maxBump`
 *   allows, measured on the final plan (`package`, `bump`, `maxBump`,
 *   `raisedBy`: the intent files that ask for that bump, or the causes when
 *   none does).
 * - `unreleasablePackage`: an intent asks for a real bump of a project that
 *   cannot release, because it is in `versioning.ignore`, has no version or
 *   has a non-semver one (`package`, `bump`, `changeset`). Name it `none`
 *   instead.
 * - `epicOutOfBand`: an epic member's new major leaves the band of its lead
 *   (`package`, `version`, `lead`, `bandMajor`).
 * - `epicUnknownLead`: an epic's `lead` names no releasable project (`lead`).
 * - `epicOverlap`: a project is matched by two epics (`directories`, `lead`
 *   and `secondLead`).
 * - `epicFixedGroupConflict`: a fixed group mixes epic members with projects
 *   outside the epic (`lead`, `directories`: the outsiders).
 * - `conflictingConfig`: a fixed group's members are on different lanes
 *   (`group`, as written).
 * - `duplicateRelease`: two same-named projects would release the same
 *   version (`package`, `version`, `directories`).
 * - `ambiguousPackage`: a `versioning` setting, or a dependency, names a
 *   package more than one project publishes (`package`, `context`,
 *   `directories`). An intent naming one is {@link AmbiguousPackageError}.
 * - `ambiguousLedgerEntry`: a bare-list ledger entry names a package more
 *   than one project publishes, so it cannot be attributed (`ledgerKey`,
 *   `package`, `directories`). Write it with a `dir`.
 * - `internalRange`: with `enforceWorkspaceProtocol`, an internal production
 *   dependency is not a `workspace:` range (`package`, `dependency`).
 *
 * A lane named `main` is refused earlier, by `VersioningConfig`'s schema,
 * and an unknown intent key is {@link UnknownPackageError}.
 *
 * @public
 */
export class VersioningError extends Schema.TaggedError<VersioningError>()("VersioningError", {
	/** Which of pnpm's refusals this is. */
	reason: Schema.Literals([
		"maxBumpExceeded",
		"unreleasablePackage",
		"epicOutOfBand",
		"epicUnknownLead",
		"epicOverlap",
		"epicFixedGroupConflict",
		"conflictingConfig",
		"duplicateRelease",
		"ambiguousPackage",
		"ambiguousLedgerEntry",
		"internalRange",
	]),
	/** The package at fault, by name, or the reference as written for `ambiguousPackage`. */
	package: Schema.optionalKey(Schema.String),
	/** The version the plan would release (`epicOutOfBand`, `duplicateRelease`). */
	version: Schema.optionalKey(Schema.String),
	/** The bump at fault: the release's effective bump, or the bump an intent asks for. */
	bump: Schema.optionalKey(BumpType),
	/** The configured `versioning.maxBump`. */
	maxBump: Schema.optionalKey(BumpType),
	/** What raised a release past `maxBump`: intent files, or its causes when no intent asks for the bump. */
	raisedBy: Schema.optionalKey(Schema.Array(Schema.String)),
	/** The epic's lead, as configured. */
	lead: Schema.optionalKey(Schema.String),
	/** The second epic's lead, for `epicOverlap`. */
	secondLead: Schema.optionalKey(Schema.String),
	/** The lead's major the band derives from: members live in `bandMajor*100` to `bandMajor*100+99`. */
	bandMajor: Schema.optionalKey(Schema.Number),
	/** The workspace-relative directories involved. */
	directories: Schema.optionalKey(Schema.Array(Schema.String)),
	/** The changeset (intent) file at fault, relative to `.changeset/`. */
	changeset: Schema.optionalKey(Schema.String),
	/** Where an ambiguous reference was written: a setting such as `versioning.fixed`, or the dependent package. */
	context: Schema.optionalKey(Schema.String),
	/** A fixed group, as configured. */
	group: Schema.optionalKey(Schema.Array(Schema.String)),
	/** The ledger key at fault, `name@version`. */
	ledgerKey: Schema.optionalKey(Schema.String),
	/** The internal dependency at fault, for `internalRange`. */
	dependency: Schema.optionalKey(
		Schema.Struct({ alias: Schema.String, field: Schema.String, specifier: Schema.String }),
	),
}) {
	/** The `ERR_PNPM_*` code pnpm reports for this refusal. */
	get code(): VersioningErrorCode {
		return VERSIONING_CODES[this.reason];
	}

	override get message(): string {
		const dirs = (this.directories ?? []).map((dir) => `./${dir}`).join(", ");
		const band = this.bandMajor === undefined ? "" : `${this.bandMajor * 100}-${this.bandMajor * 100 + 99}`;
		return this.reason === "maxBumpExceeded"
			? `The release plan bumps ${this.package} by ${this.bump}, but versioning.maxBump caps releases at ${this.maxBump}; raised by ${(this.raisedBy ?? []).join(", ")}`
			: this.reason === "unreleasablePackage"
				? `Changeset ${this.changeset} requests a ${this.bump} release of ${this.package}, which cannot release (ignored, version-less or not semver); remove the entry or change it to "none"`
				: this.reason === "epicOutOfBand"
					? `The release plan takes ${this.package} to ${this.version}, outside the band ${band} of the epic led by "${this.lead}"`
					: this.reason === "epicUnknownLead"
						? `versioning.epics lead "${this.lead}" is not a releasable workspace project`
						: this.reason === "epicOverlap"
							? `${dirs} is matched by two epics (leads "${this.lead}" and "${this.secondLead}")`
							: this.reason === "epicFixedGroupConflict"
								? `A fixed group straddles the epic led by "${this.lead}": it also holds ${dirs}`
								: this.reason === "conflictingConfig"
									? `The fixed group [${(this.group ?? []).join(", ")}] mixes packages on different lanes`
									: this.reason === "duplicateRelease"
										? `Two projects both release ${this.package}@${this.version}: ${dirs}`
										: this.reason === "ambiguousPackage"
											? `${this.context} names ${this.package}, which matches several projects: ${dirs}; reference the project by directory`
											: this.reason === "ambiguousLedgerEntry"
												? `The ledger entry ${this.ledgerKey} names ${this.package}, which matches several projects (${dirs}); give it a "dir"`
												: `Package ${this.package} declares ${this.dependency?.alias} in ${this.dependency?.field} as "${this.dependency?.specifier}"; internal dependencies must use the workspace: protocol`;
	}
}
