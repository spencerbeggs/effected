import { defineConfig } from "@effected/schemastore";
import { Schema } from "effect";

export default defineConfig({
	name: "basic",
	outputDir: "schemas",
	baseUrl: "https://example.com/schemas",
	schemas: {
		basic: {
			schema: Schema.Struct({ name: Schema.String }).annotate({ description: "A basic fixture config" }),
			versions: ["1.0"],
			layout: "flat",
			catalog: { description: "basic fixture", fileMatch: ["basic.json"] },
		},
	},
});
