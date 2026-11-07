import { BuildIssuesSchema, BuildReport, ResolvedEffectedConfig } from "@effected/bundler";
import { Schema } from "effect";

/**
 * One build's answer: the verdict a front end maps to an exit code or returns as data, the `issues.json` it rests
 * on, everything the build recorded, and the config files it read.
 *
 * @public
 */
export class BuildRunResult extends Schema.Class<BuildRunResult>("BuildRunResult")({
	/** The package's name. */
	package: Schema.String,
	/** `failed` when the build did not reach its end or recorded an error. */
	verdict: Schema.Literals(["ok", "failed"]),
	/** The build's `issues.json`. */
	issues: BuildIssuesSchema,
	/** Everything the build recorded. */
	report: BuildReport,
	/** The config the build ran on. */
	config: Schema.Struct({
		/** The file each tier read, absent for a tier that found none. */
		sources: ResolvedEffectedConfig.fields.sources,
	}),
}) {}
