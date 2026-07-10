import { build } from "@savvy-web/bundler";

await build({
	meta: {
		localPaths: ["../../website/lib/models/config-file-toml"],
		tsdoc: {
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
	},
});
