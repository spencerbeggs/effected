import { build } from "@savvy-web/bundler";

await build({
	// ./ui names the root's types through the package's own name; keep that import external in the declarations
	// so ui.d.ts refers to the root's types instead of carrying copies.
	dtsExternals: ["@effected/cli"],
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
