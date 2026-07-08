import { build } from "@savvy-web/bundler";

await build({
	meta: {
		localPaths: ["../../website/lib/models/npm"],
	},
});
