import { Bool, Str, Unsigned, entry } from "./schemas.js";

/** The `pnpm publish` and `pnpm version` settings. */
export const publish = {
	gitChecks: entry("gitChecks", {
		schema: Bool,
		kind: "boolean",
		description:
			"When `true` (the default), `pnpm publish` verifies the git working tree is clean, on the expected branch, and up to date with the remote before publishing.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
	}),
	gitTagVersion: entry("gitTagVersion", {
		schema: Bool,
		kind: "boolean",
		description: "Whether `pnpm version` creates a git commit and tag for the bump; `false` skips both.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: true,
	}),
	provenance: entry("provenance", {
		schema: Bool,
		kind: "boolean",
		description:
			"Whether `pnpm publish` attaches a provenance attestation. Unset lets trusted publishing decide from the package's visibility.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
	}),
	publishBranch: entry("publishBranch", {
		schema: Str,
		kind: "string",
		description: "The branch `pnpm publish` allows when git checks run. `None` allows `master` or `main`.",
		locations: ["workspace", "env"],
		envFormat: "text",
	}),
	publishWaitTimeout: entry("publishWaitTimeout", {
		schema: Unsigned,
		kind: "number",
		description: "Maximum time in milliseconds to wait for published versions and their tarballs to become available.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
	}),
	tagVersionPrefix: entry("tagVersionPrefix", {
		schema: Str,
		kind: "string",
		description:
			"Prefix prepended to the version when `pnpm version` creates its git tag, and stripped when `pnpm version from-git` reads the version back from the latest tag.",
		locations: ["workspace", "global", "env"],
		envFormat: "text",
	}),
} as const;
