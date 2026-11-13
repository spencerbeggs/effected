import type { VersioningConfig } from "@effected/pnpm";
import type { WorkspacePackage } from "@effected/workspaces";
import { Result, Schema } from "effect";
import type { VersioningError } from "./errors.js";
import { checkPnpm } from "./internal/pnpmPlan.js";

/**
 * An epic member whose committed major is outside the band of its lead.
 *
 * @public
 */
export class EpicOutOfBand extends Schema.TaggedClass<EpicOutOfBand>()("EpicOutOfBand", {
	/** The epic's lead, as configured. */
	epic: Schema.String,
	/** The member at fault, by name. */
	package: Schema.String,
	/** The member's committed version. */
	version: Schema.String,
	/** The member's committed major, the one outside the band. */
	major: Schema.Number,
	/** The lead's major the band derives from: members live in `bandMajor*100` to `bandMajor*100+99`. */
	bandMajor: Schema.Number,
}) {
	/** One line, as `pnpm change check` words it. */
	get message(): string {
		const low = this.bandMajor * 100;
		return `${this.package} is at ${this.version}, whose major ${this.major} is outside the band ${low}-${low + 99} of the epic led by "${this.epic}" (major ${this.bandMajor}).`;
	}
}

/**
 * A fixed group whose members do not share one version.
 *
 * @public
 */
export class FixedOutOfStep extends Schema.TaggedClass<FixedOutOfStep>()("FixedOutOfStep", {
	/** The group, as written in `versioning.fixed`. */
	group: Schema.Array(Schema.String),
	/** Each participating member and its committed version, in the group's order. */
	versions: Schema.Array(Schema.Struct({ package: Schema.String, version: Schema.String })),
}) {
	/** One line, as `pnpm change check` words it. */
	get message(): string {
		return `The fixed group [${this.group.join(", ")}] is not in lockstep: ${this.versions
			.map((member) => `${member.package}@${member.version}`)
			.join(", ")}.`;
	}
}

/**
 * A committed-version invariant the `versioning` block declares and the
 * workspace currently breaks.
 *
 * @public
 */
export type VersioningViolation = EpicOutOfBand | FixedOutOfStep;

/**
 * The check behind `pnpm change check`: are the committed versions where the
 * `versioning` block says they must be?
 *
 * @remarks
 * A port of `check_versioning_invariants`
 * (`.repos/pnpm/pnpm/crates/versioning/src/plan.rs:217`). It looks at no
 * intent and plans nothing: with no plan, an epic's band comes from its lead's
 * current major (a lead on `N.0.0-<lane>.x` is still in the band of `N-1`),
 * and every member is held to it; every fixed group must share one version.
 * The band rule is the one the planner enforces on new versions, read from the
 * same function, so the two cannot disagree.
 *
 * Every violation is returned, not the first: epic members in directory order
 * per epic, then fixed groups in declaration order. A `versioning` block pnpm
 * refuses (an ambiguous name, an unknown lead, overlapping epics) fails with
 * {@link VersioningError} before any version is looked at, as pnpm's does.
 *
 * @example
 * ```ts
 * import { VersioningCheck } from "@effected/changesets";
 * import { Result } from "effect";
 *
 * const found = VersioningCheck.check([], undefined);
 * console.log(Result.isSuccess(found) && found.success.length);
 * // => 0
 * ```
 *
 * @public
 */
export class VersioningCheck {
	private constructor() {}

	/**
	 * Check `packages`' committed versions against `versioning`.
	 *
	 * @param packages - Every package of the workspace, the root included.
	 * @param versioning - The `versioning` block, or none.
	 */
	static check(
		packages: ReadonlyArray<WorkspacePackage>,
		versioning: VersioningConfig | undefined,
	): Result.Result<ReadonlyArray<VersioningViolation>, VersioningError> {
		return Result.map(checkPnpm({ packages, versioning }), (found) =>
			found.map((violation) =>
				violation._tag === "EpicOutOfBand"
					? EpicOutOfBand.make({
							epic: violation.epic,
							package: violation.package,
							version: violation.version,
							bandMajor: violation.bandMajor,
							major: violation.major,
						})
					: FixedOutOfStep.make({
							group: [...violation.group],
							versions: violation.versions.map((member) => ({ ...member })),
						}),
			),
		);
	}
}
