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
				// The second API Extractor pass resolves ./ui's self-referencing "@effected/cli" import to the built root
				// declarations, but still reports every root type it reaches as forgotten. Scoped to the two ui entries only. What it would hide (a ui-local
				// declaration left unexported) is pinned by __test__/declarations.test.ts over the built ui.d.ts.
				{ messageId: "ae-forgotten-export", pattern: "entry point ui(?:-testing)?\\.d\\.ts$" },
			],
		},
	},
});
