import { build } from "@savvy-web/bundler";

// Bin plus one library entry (`AjvValidator`): the entry earns a declaration
// bundle and an API model like any other kit package.
await build({
	meta: {
		localPaths: ["../../website/lib/models/schemastore-cli"],
	},
});
