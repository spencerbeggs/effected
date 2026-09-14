import { defineConfig } from "@effected/schemastore";
import { BasicConfig } from "./src/config-schema.js";

export default defineConfig({
	outputDir: "schemas",
	baseUrl: "https://example.com/schemas",
	schemas: {
		basic: {
			schema: BasicConfig,
			versions: ["1.0"],
			layout: "flat",
			catalog: { description: "basic fixture", fileMatch: ["basic.json"] },
		},
	},
});
