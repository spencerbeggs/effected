import { build } from "@savvy-web/bundler";

await build({
	meta: {
		localPaths: ["../../website/lib/models/crypto"],
		tsdoc: {
			// The narrow, house-standard suppression for the anonymous heritage types Effect's class factories synthesize
			// (Schema.Class, TaggedError, Context.Service). Scoped to `_base` ONLY — never widen it.
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
	},
});
