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
		const version = Result.getOrThrow(SchemaVersioning.parseResult("1.2.0"));
		const target = SchemaTarget.make({
			schema: Config,
			$id: "https://example.com/config.schema.json",
			name: "config-tool",
			path: "schemas/config-tool-1.2.0.json",
			version,
		});
		assert.strictEqual(target.version, "1.2.0");
	});

	it("throws on empty identity fields (wiring defect, not a typed error)", () => {
		assert.throws(() => SchemaTarget.make({ schema: Config, $id: "", name: "x", path: "y" }));
		assert.throws(() => SchemaTarget.make({ schema: Config, $id: "https://x", name: "", path: "y" }));
		assert.throws(() => SchemaTarget.make({ schema: Config, $id: "https://x", name: "x", path: "" }));
	});

	// Only catalog naming reads `name`; a file-emitting target that invents
	// one just duplicates its path's basename.
	it("omits name entirely for a target that only emits a file", () => {
		const target = SchemaTarget.make({ schema: Config, $id: "https://x", path: "out/config.json" });
		assert.isUndefined(target.name);
		assert.strictEqual(target.path, "out/config.json");
	});

	// #688 — a target-level jsonSchema option threads Schema.ToJsonSchemaOptions
	// through to StoreDocument.fromSchema so a document's generation contract
	// is self-describing rather than relying on core's default.
	it("carries a jsonSchema option when given", () => {
		const target = SchemaTarget.make({
			schema: Config,
			$id: "https://example.com/config.schema.json",
			name: "config-tool",
			path: "schemas/config-tool.json",
			jsonSchema: { onExcessProperty: "error" },
		});
		assert.deepStrictEqual(target.jsonSchema, { onExcessProperty: "error" });
	});

	it("omits the jsonSchema key entirely when not given", () => {
		const target = SchemaTarget.make({
			schema: Config,
			$id: "https://example.com/config.schema.json",
			name: "config-tool",
			path: "schemas/config-tool.json",
		});
		assert.notProperty(target, "jsonSchema");
	});

	// #624 — rootAnnotations is a target-level field for the same
	// self-describing reason as jsonSchema.
	it("carries rootAnnotations when given and omits the key when not", () => {
		const with_ = SchemaTarget.make({
			schema: Schema.String,
			$id: "https://e.com/a.json",
			path: "a.json",
			rootAnnotations: { title: "T" },
		});
		assert.deepStrictEqual(with_.rootAnnotations, { title: "T" });
		const without = SchemaTarget.make({ schema: Schema.String, $id: "https://e.com/a.json", path: "a.json" });
		assert.isFalse(Object.hasOwn(without, "rootAnnotations"));
	});

	// The overload pair makes version-without-name a COMPILE error; the
	// runtime throw remains for untyped callers, which is what the cast
	// simulates here.
	it("requires a name when a version is given — versioned naming is name-<version>.json", () => {
		const untyped = SchemaTarget.make as (options: Record<string, unknown>) => unknown;
		assert.throws(
			() =>
				untyped({
					schema: Config,
					$id: "https://x",
					path: "out/config.json",
					version: Result.getOrThrow(SchemaVersioning.parseResult("1.0.0")),
				}),
			/requires a "name"/,
		);
	});
});

describe("published", () => {
	it("defaults to false", () => {
		const target = SchemaTarget.make({ schema: Config, $id: "https://x/a.json", path: "a.json" });
		assert.strictEqual(target.published, false);
	});

	it("carries an explicit true", () => {
		const target = SchemaTarget.make({
			schema: Config,
			$id: "https://x/a-1.2.json",
			name: "a",
			version: "1.2",
			path: "a-1.2.json",
			published: true,
		});
		assert.strictEqual(target.published, true);
	});
});

describe("version as a string label", () => {
	it("parses a valid label into a SchemaVersion", () => {
		const target = SchemaTarget.make({
			schema: Config,
			$id: "https://x/a-1.2.json",
			name: "a",
			version: "1.2",
			path: "a-1.2.json",
		});
		assert.strictEqual(target.version, "1.2");
	});

	it("throws on an invalid label, naming it", () => {
		assert.throws(
			() => SchemaTarget.make({ schema: Config, $id: "https://x/a.json", name: "a", version: "v1.2", path: "a.json" }),
			/SchemaTarget\.make received an invalid version label "v1\.2"/,
		);
	});
});
