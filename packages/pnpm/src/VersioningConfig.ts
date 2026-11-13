// The `versioning` block of pnpm-workspace.yaml: pnpm's native release
// management settings. Pure schemas; `PnpmSettings.versioning` reads it.

import { Schema } from "effect";

/**
 * A release lane name as pnpm's planner reads one: anything but the reserved
 * `main`, in any letter case (`resolve_lanes`, crates/versioning/src/plan/configuration.rs:18).
 * The alphanumerics-and-hyphens, not-purely-numeric syntax is checked only by
 * the `pnpm lane` command when it assigns a lane (`check_lane_name`,
 * crates/cli/src/cli_args/lane.rs:203), so an existing file is not held to it.
 */
const LaneName = Schema.String.check(
	Schema.makeFilter((name: string) =>
		name.toLowerCase() === "main" ? "`main` is the reserved default lane and cannot be assigned" : undefined,
	),
);

/**
 * An epic: a lead package whose major version defines a band, and the member
 * packages whose majors live inside it.
 *
 * @remarks
 * While the lead is on major `M`, members live in `M×100` to `M×100+99`.
 * `lead` is a package name or a `./`-prefixed workspace directory; `packages`
 * are selectors: name globs, `./` directory globs and `!` negations, where the
 * last match decides.
 *
 * @public
 */
export class Epic extends Schema.Class<Epic>("Epic")({
	/** The package whose major defines the band. */
	lead: Schema.String,
	/** Selectors matching the member packages. */
	packages: Schema.Array(Schema.String),
}) {}

/**
 * The `versioning` block of `pnpm-workspace.yaml`: pnpm's native workspace
 * release management.
 *
 * @remarks
 * Every key is optional and an absent key means the default (no groups, no
 * cap, every package on the `main` lane, `registry` changelog storage). A
 * package is named by its name or by a `./`-prefixed workspace directory, in
 * `fixed`, `ignore`, the keys of `lanes`, and an epic's selectors. A lane name
 * may be anything but `main` (in any letter case), the reserved default lane,
 * as pnpm's planner reads the block; the stricter syntax `pnpm lane` applies
 * when it assigns a lane (alphanumerics and hyphens, not purely numeric) is
 * not a reading rule. `maxBump` is one of
 * `patch`, `minor` or `major`; there is no `none`. pnpm reads this block from
 * the workspace file only, never from the global config.
 *
 * @example
 * ```ts
 * import { VersioningConfig } from "@effected/pnpm";
 * import { Schema } from "effect";
 *
 * const config = Schema.decodeUnknownSync(VersioningConfig)({
 *   maxBump: "minor",
 *   lanes: { "@example/cli": "alpha" },
 * });
 * console.log(config.maxBump);
 * // => "minor"
 * ```
 *
 * @public
 */
export class VersioningConfig extends Schema.Class<VersioningConfig>("VersioningConfig")({
	/** Groups of packages that always release together at one shared version. */
	fixed: Schema.optionalKey(Schema.Array(Schema.Array(Schema.String))),
	/** Packages permanently excluded from versioning and dependent propagation. */
	ignore: Schema.optionalKey(Schema.Array(Schema.String)),
	/** The largest bump a release from this checkout may apply. */
	maxBump: Schema.optionalKey(Schema.Literals(["patch", "minor", "major"])),
	/** Per-package release lanes: package to lane name. */
	lanes: Schema.optionalKey(Schema.Record(Schema.String, LaneName)),
	/** Epics banding member majors to a lead package's major. */
	epics: Schema.optionalKey(Schema.Array(Epic)),
	/** Where changelogs live and how they are formatted. */
	changelog: Schema.optionalKey(
		Schema.Struct({
			format: Schema.optionalKey(Schema.String),
			storage: Schema.optionalKey(Schema.Literals(["registry", "repository"])),
		}),
	),
}) {}
