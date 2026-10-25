import { build } from "@savvy-web/bundler";

await build({
	// The ./jsonc, ./yaml and ./toml codec modules name `ConfigCodec` through the package's own name; keep that import
	// external in the declarations so each subpath refers to the root's type instead of carrying a copy.
	dtsExternals: ["@effected/config-file"],
	meta: {
		localPaths: ["../../website/lib/models/config-file"],
		tsdoc: {
			suppressWarnings: [
				{ messageId: "ae-forgotten-export", pattern: "_base" },
				// The second API Extractor pass resolves each codec subpath's self-referencing "@effected/config-file" import
				// to the built root declarations, but still reports the root types it reaches as forgotten (the
				// @effected/cli ./ui precedent). Scoped to the three codec entries only; what it would hide (a subpath-local
				// declaration left unexported) is pinned by __test__/subpaths.test.ts over the built declarations.
				{ messageId: "ae-forgotten-export", pattern: "entry point (?:jsonc|yaml|toml)\\.d\\.ts$" },
			],
		},
	},
});
