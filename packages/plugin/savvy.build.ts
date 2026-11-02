import { build } from "@savvy-web/bundler";

await build({
	meta: {
		tsdoc: {
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
	},
});
