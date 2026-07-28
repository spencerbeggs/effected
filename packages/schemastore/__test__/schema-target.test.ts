import { assert, describe, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import { SchemaTarget, SchemaVersioning } from "../src/index.js";

const Config = Schema.Struct({ name: Schema.String });

describe("SchemaTarget", () => {
	it("builds a target and omits the version key when not given", () => {
		const target = SchemaTarget.make({
			schema: Config,
			$id: "https://example.com/config.schema.json",
			name: "config-tool",
			path: "schemas/config-tool.json",
		});
		assert.strictEqual(target.$id, "https://example.com/config.schema.json");
		assert.strictEqual(target.schema, Config);
		assert.notProperty(target, "version");
	});

	it("carries a version label for the versioned mode", () => {
		const version = Result.getOrThrow(SchemaVersioning.parseResult("1.2"));
		const target = SchemaTarget.make({
			schema: Config,
			$id: "https://example.com/config.schema.json",
			name: "config-tool",
			path: "schemas/config-tool-1.2.json",
			version,
		});
		assert.strictEqual(target.version, "1.2");
	});

	it("throws on empty identity fields (wiring defect, not a typed error)", () => {
		assert.throws(() => SchemaTarget.make({ schema: Config, $id: "", name: "x", path: "y" }));
		assert.throws(() => SchemaTarget.make({ schema: Config, $id: "https://x", name: "", path: "y" }));
		assert.throws(() => SchemaTarget.make({ schema: Config, $id: "https://x", name: "x", path: "" }));
	});
});
