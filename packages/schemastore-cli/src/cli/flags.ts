// The flags and argument `build` and `check` share. The drift flags are
// optional so `execute` can tell "the user said" from "the config says" and
// report the effective policy's source.

import { Argument, Flag } from "effect/unstable/cli";

/**
 * The optional positional config path; omitted, the config is discovered
 * upward from the working directory.
 *
 * @public
 */
export const configArgument = Argument.String("config").pipe(
	Argument.withDescription(
		"Path to a schemastore config module; omitted, schemastore.config.{ts,mts,js,mjs} is searched upward from the working directory",
	),
	Argument.optional,
);

/**
 * `--drift`: the tolerance for published schemas, overriding the config.
 *
 * @public
 */
export const driftFlag = Flag.Literals("drift", ["strict", "semantic", "allow"]).pipe(
	Flag.withDescription("Drift tolerance for published schemas; overrides every schema's drift"),
	Flag.optional,
);

/**
 * `--on-drift`: what drift does, overriding the config.
 *
 * @public
 */
export const onDriftFlag = Flag.Literals("on-drift", ["error", "warn"]).pipe(
	Flag.withDescription("What drift does: refuse every write (error) or write and warn; overrides the config's onDrift"),
	Flag.optional,
);

/**
 * `--force`: shorthand for `--drift=allow`.
 *
 * @public
 */
export const forceFlag = Flag.Boolean("force").pipe(
	// Omission fails unless a boolean flag is given a fallback (`Flag.ts:69`).
	Flag.withDefault(false),
	Flag.withDescription("Shorthand for --drift=allow"),
);

/**
 * `--format`: `human` (default) or `json`.
 *
 * @public
 */
export const formatFlag = Flag.Literals("format", ["human", "json"]).pipe(
	Flag.withDefault("human"),
	Flag.withDescription("Output format; json writes one document to stdout and moves human text to stderr"),
);

/**
 * The config both commands take.
 *
 * @public
 */
export const commandFlags = {
	config: configArgument,
	drift: driftFlag,
	onDrift: onDriftFlag,
	force: forceFlag,
	format: formatFlag,
};
