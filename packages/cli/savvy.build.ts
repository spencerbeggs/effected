import { build } from "@savvy-web/bundler";

await build({
	// ./ui and ./ui/testing name the root's (and ./ui's) types through the package's own name; keep those imports
	// external in the declarations so each entry refers to the other's types instead of carrying copies. The match is
	// exact, so each subpath is listed.
	dtsExternals: ["@effected/cli", "@effected/cli/ui"],
	meta: {
		localPaths: ["../../website/lib/models/cli"],
		tsdoc: {
			suppressWarnings: [
				{ messageId: "ae-forgotten-export", pattern: "_base" },
				// API Extractor follows ./ui's self-referencing "@effected/cli" import back into the root's source and
				// reports every root type as forgotten. Scoped to the two ui entries only. What it would hide (a ui-local
				// declaration left unexported) is pinned by __test__/declarations.test.ts over the built ui.d.ts.
				{ messageId: "ae-forgotten-export", pattern: "entry point ui(?:-testing)?\\.d\\.ts$" },
			],
		},
	},
});
