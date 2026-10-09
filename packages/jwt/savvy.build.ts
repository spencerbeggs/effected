import { build } from "@savvy-web/bundler";

await build({
	// ./testing names the root's types through the package's own name; keep that import external in the declarations so
	// testing.d.ts refers to the root's types instead of carrying a copy.
	dtsExternals: ["@effected/jwt"],
	meta: {
		localPaths: ["../../website/lib/models/jwt"],
		tsdoc: {
			// The narrow, house-standard suppression for the anonymous heritage types Effect's class factories synthesize
			// (Schema.Class, TaggedError, Context.Service). Scoped to `_base` ONLY — never widen it.
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
	},
});
