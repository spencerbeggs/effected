// `--format` is shared with `effected schema`, so its default follows the audience the same way.

import { Flag } from "effect/cli";
import { formatFlag } from "../schema/flags.js";

/** What `action build` takes. */
export const buildFlags = {
	format: formatFlag,
	noValidate: Flag.Boolean("no-validate").pipe(
		// Omission fails unless a boolean flag is given a fallback.
		Flag.withDefault(false),
		Flag.withDescription("Skip validating the config and action.yml, and the bundle size check"),
	),
	noPersist: Flag.Boolean("no-persist").pipe(
		Flag.withDefault(false),
		Flag.withDescription("Skip copying the build to the local action directory"),
	),
};
