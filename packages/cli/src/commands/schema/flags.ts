// The flags and argument the subcommands share. The drift flags are optional so the engine can tell "the user said"
// from "the config says", and `--format` is optional so its default can follow the audience.

import { Argument, Flag } from "effect/cli";

/** The optional positional config path; omitted, the config is discovered upward from the working directory. */
export const configArgument = Argument.String("config").pipe(
	Argument.withDescription(
		"Path to a schemastore config module; omitted, schemastore.config.{ts,mts,js,mjs} is searched upward from the working directory",
	),
	Argument.optional,
);

/** `--format`: absent, JSON for an agent and human text for everyone else. */
export const formatFlag = Flag.Literals("format", ["human", "json"]).pipe(
	Flag.withDescription(
		"Output format, by default json for an agent and human otherwise; json writes one document to stdout and moves human text to stderr",
	),
	Flag.optional,
);

/** `--ignore-version-mismatch`: run on past a config from another `@effected/schemastore`. */
export const ignoreVersionMismatchFlag = Flag.Boolean("ignore-version-mismatch").pipe(
	// Omission fails unless a boolean flag is given a fallback.
	Flag.withDefault(false),
	Flag.withDescription(
		"Run even when the config's values come from a different @effected/schemastore than this tool's; warns loudly",
	),
);

/** What `build` and `check` take. */
export const commandFlags = {
	config: configArgument,
	drift: Flag.Literals("drift", ["strict", "semantic", "allow"]).pipe(
		Flag.withDescription("Drift tolerance for published schemas; overrides every schema's drift"),
		Flag.optional,
	),
	onDrift: Flag.Literals("on-drift", ["error", "warn"]).pipe(
		Flag.withDescription(
			"What drift does: refuse every write (error) or write and warn; overrides the config's onDrift",
		),
		Flag.optional,
	),
	force: Flag.Boolean("force").pipe(Flag.withDefault(false), Flag.withDescription("Shorthand for --drift=allow")),
	format: formatFlag,
	ignoreVersionMismatch: ignoreVersionMismatchFlag,
};
