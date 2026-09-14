import { defineConfig, SchemaTarget } from "@effected/schemastore";
import { BasicConfig } from "./src/config-schema.js";

export default defineConfig({
	schemas: [
		SchemaTarget.make({
			schema: BasicConfig,
			$id: "https://example.com/schemas/basic-1.0.json",
			name: "basic",
			version: "1.0",
			path: "schemas/basic-1.0.json",
		}),
	],
	catalog: [
		{
			name: "basic",
			description: "basic fixture",
			fileMatch: ["basic.json"],
			baseUrl: "https://example.com/schemas",
			path: "schemas/catalog-entry.json",
		},
	],
});
