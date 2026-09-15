import { defineConfig } from "@effected/schemastore";
import { ReleaseOutput } from "./src/output-schema.js";

export default defineConfig({
	outputDir: "schemas",
	baseUrl: "https://raw.githubusercontent.com/o/release-action/main/schemas",
	schemas: {
		"release-action": {
			schema: ReleaseOutput,
			versions: ["4.0.0", "5.0.0"],
			published: true,
			catalog: { description: "release-action output", fileMatch: ["release-action.output.json"] },
		},
	},
});
