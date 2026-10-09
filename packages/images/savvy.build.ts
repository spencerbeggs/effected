import { build } from "@savvy-web/bundler";

await build({
	// ./cache names the root's types through the package's own name; keep that import external in the declarations so
	// cache.d.ts refers to the root's ImageFacts instead of carrying a copy.
	dtsExternals: ["@effected/images"],
	meta: {
		localPaths: ["../../website/lib/models/images"],
		tsdoc: {
			// The narrow, house-standard suppression for the anonymous heritage types Effect's class factories synthesize
			// (Schema.Class, TaggedError, Context.Service). Scoped to `_base` ONLY — never widen it.
			suppressWarnings: [
				{ messageId: "ae-forgotten-export", pattern: "_base" },
				// API Extractor follows ./cache's self-referencing "@effected/images" import back into the root's source and
				// reports every root type as forgotten from cache.d.ts. Scoped to that one entry.
				{ messageId: "ae-forgotten-export", pattern: "entry point cache\\.d\\.ts$" },
			],
		},
	},
});
