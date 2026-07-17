import { build } from "@savvy-web/bundler";

await build({
	meta: {
		localPaths: ["../../website/lib/models/walker"],
		tsdoc: {
			// The one narrow suppression for the synthesized base of the
			// DescendError class factory (effect-api-extractor-bases). Never widen.
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
	},
});
