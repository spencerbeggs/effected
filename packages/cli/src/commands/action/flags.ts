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
	check: Flag.Boolean("check").pipe(
		Flag.withDefault(false),
		Flag.withDescription("Build to a staging directory and fail if the committed build differs, writing nothing"),
	),
	watch: Flag.Boolean("watch").pipe(
		Flag.withDefault(false),
		Flag.withDescription("Rebuild whenever a source file or effected.toml changes, until interrupted"),
	),
};

/** What `action init` takes. A name or description left out is read from `package.json`. */
export const initFlags = {
	format: formatFlag,
	name: Flag.String("name").pipe(
		Flag.optional,
		Flag.withDescription("The action's display name in action.yml; omitted, package.json's name without its scope"),
	),
	description: Flag.String("description").pipe(
		Flag.optional,
		Flag.withDescription("What the action does, for action.yml; omitted, package.json's description"),
	),
	local: Flag.Boolean("local").pipe(
		Flag.withDefault(false),
		Flag.withDescription(
			"Scaffold a local-only action: persist to .github/actions/<name> at the workspace root and keep no package dist",
		),
	),
	force: Flag.Boolean("force").pipe(
		Flag.withDefault(false),
		Flag.withDescription(
			"Replace files that already exist; without it, any existing file stops the run before a write",
		),
	),
};
