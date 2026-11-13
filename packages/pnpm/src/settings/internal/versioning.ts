import { VersioningConfig } from "@effected/pnpm";
import { entry } from "./schemas.js";

/** The `versioning` block (`docs/settings/versioning.md`). */
export const versioning = {
	versioning: entry("versioning", {
		schema: VersioningConfig,
		kind: "object",
		description: "Groups of packages that always release together at one shared version.",
		locations: ["workspace"],
		anchor: "settings/versioning#versioningfixed",
	}),
} as const;
