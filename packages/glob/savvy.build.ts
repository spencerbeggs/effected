import { build } from "@savvy-web/bundler";

await build({
	meta: {
		localPaths: ["../../website/lib/models/glob"],
		tsdoc: {
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
	},
});
