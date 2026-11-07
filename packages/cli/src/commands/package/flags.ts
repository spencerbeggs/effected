// `--format` is shared with `effected schema`, so its default follows the audience the same way.

import { Flag } from "effect/cli";
import { formatFlag } from "../schema/flags.js";

/** What `package build` takes. */
export const buildFlags = {
	format: formatFlag,
	noExe: Flag.Boolean("no-exe").pipe(
		// Omission fails unless a boolean flag is given a fallback.
		Flag.withDefault(false),
		Flag.withDescription("Skip the single-executable compile; the manifest still points at the binary"),
	),
	verbose: Flag.Boolean("verbose").pipe(
		Flag.withDefault(false),
		Flag.withDescription("Measure gzip sizes for the report"),
	),
};
