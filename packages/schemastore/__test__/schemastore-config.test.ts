import { assert, describe, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import type { SchemaVersion } from "../src/index.js";
import { SchemaVersioning, defineConfig, isSchemastoreConfig } from "../src/index.js";

const version = (label: string): SchemaVersion => Result.getOrThrow(SchemaVersioning.parseResult(label));

const Config = Schema.Struct({ name: Schema.String });
const catalog = { description: "okfit config", fileMatch: ["okfit.toml"] };
const CUSTOM = "https://raw.githubusercontent.com/o/r/main/schemas";

const one = (entry: Record<string, unknown>, top: Record<string, unknown> = {}) =>
	defineConfig({
		outputDir: "schemas",
		baseUrl: "schemastore",
		schemas: { okfit: { schema: Config, catalog, ...entry } },
		...top,
	});

const only = (config: ReturnType<typeof defineConfig>) => {
	const [schema] = config.schemas;
	assert.isDefined(schema);
	return schema;
};

describe("defineConfig derivation", () => {
	it("schemastore + versioned: flat file, $id on json., catalog on www., url at current", () => {
		const schema = only(one({ versions: ["1.0", "1.1"] }));
		assert.strictEqual(schema.name, "okfit");
		assert.strictEqual(schema.target.path, "schemas/okfit-1.1.json");
		assert.strictEqual(schema.target.$id, "https://json.schemastore.org/okfit-1.1.json");
		assert.strictEqual(schema.target.version, "1.1");
		assert.strictEqual(schema.target.name, "okfit");
		assert.deepStrictEqual(schema.frozen, [
			{ version: version("1.0"), path: "schemas/okfit-1.0.json", url: "https://www.schemastore.org/okfit-1.0.json" },
		]);
		assert.strictEqual(schema.catalog?.url, "https://www.schemastore.org/okfit-1.1.json");
		assert.deepStrictEqual(schema.catalog?.versions, {
			"1.0": "https://www.schemastore.org/okfit-1.0.json",
			"1.1": "https://www.schemastore.org/okfit-1.1.json",
		});
	});

	it("custom URL defaults to the versioned layout with one base for $id and catalog", () => {
		const schema = only(one({ versions: ["1.0", "1.1"], baseUrl: `${CUSTOM}/` }));
		assert.strictEqual(schema.target.path, "schemas/1.1/okfit-1.1.json");
		assert.strictEqual(schema.target.$id, `${CUSTOM}/1.1/okfit-1.1.json`);
		assert.strictEqual(schema.catalog?.url, schema.target.$id);
		assert.strictEqual(schema.frozen[0]?.path, "schemas/1.0/okfit-1.0.json");
		assert.strictEqual(schema.frozen[0]?.url, `${CUSTOM}/1.0/okfit-1.0.json`);
	});

	it("custom URL with layout flat", () => {
		const schema = only(one({ versions: ["1.0"], baseUrl: CUSTOM, layout: "flat" }));
		assert.strictEqual(schema.target.path, "schemas/okfit-1.0.json");
		assert.strictEqual(schema.target.$id, `${CUSTOM}/okfit-1.0.json`);
		assert.strictEqual(schema.catalog?.url, `${CUSTOM}/okfit-1.0.json`);
	});

	it("defaults current to the newest label under Order", () => {
		const schema = only(one({ versions: ["1.1", "1.0"] }));
		assert.strictEqual(schema.target.version, "1.1");
		assert.deepStrictEqual(
			schema.frozen.map((f) => f.version),
			["1.0"],
		);
	});

	it("orders current numerically, not lexically", () => {
		const schema = only(one({ versions: ["1.2", "1.10"] }));
		assert.strictEqual(schema.target.version, "1.10");
	});

	it("unversioned: name.json, url only, no frozen, no version on the target", () => {
		const schema = only(one({}));
		assert.strictEqual(schema.target.path, "schemas/okfit.json");
		assert.strictEqual(schema.target.$id, "https://json.schemastore.org/okfit.json");
		assert.isUndefined(schema.target.version);
		assert.deepStrictEqual(schema.frozen, []);
		assert.strictEqual(schema.catalog?.url, "https://www.schemastore.org/okfit.json");
		assert.isUndefined(schema.catalog?.versions);
	});

	it("explicit current generates that label and freezes the rest, even a higher one", () => {
		const schema = only(one({ versions: ["1.0", "2.0.0-alpha.1"], current: "1.0" }));
		assert.strictEqual(schema.target.version, "1.0");
		assert.deepStrictEqual(
			schema.frozen.map((f) => f.version),
			["2.0.0-alpha.1"],
		);
		assert.strictEqual(schema.catalog?.url, "https://www.schemastore.org/okfit-1.0.json");
	});

	it("catalog is optional on a custom host and absent from the resolved schema when omitted", () => {
		const config = defineConfig({ outputDir: "schemas", schemas: { okfit: { schema: Config, baseUrl: CUSTOM } } });
		assert.isUndefined(only(config).catalog);
	});

	it("fills top-level defaults: drift semantic, onDrift error, catalogPath under outputDir", () => {
		const config = one({});
		assert.strictEqual(config.outputDir, "schemas");
		assert.strictEqual(config.onDrift, "error");
		assert.strictEqual(config.catalogPath, "schemas/catalog.json");
		assert.strictEqual(only(config).drift, "semantic");
		assert.isFalse(only(config).target.published);
		assert.isTrue(isSchemastoreConfig(config));
	});

	it("per-entry drift, published and baseUrl override the top level; onDrift and catalogPath are top-level", () => {
		const config = one(
			{ drift: "allow", published: true, baseUrl: CUSTOM },
			{ drift: "strict", onDrift: "warn", catalogPath: "catalog/okfit.json" },
		);
		assert.strictEqual(only(config).drift, "allow");
		assert.isTrue(only(config).target.published);
		assert.strictEqual(only(config).target.$id, `${CUSTOM}/okfit.json`);
		assert.strictEqual(config.onDrift, "warn");
		assert.strictEqual(config.catalogPath, "catalog/okfit.json");
	});

	it("forwards jsonSchema and rootAnnotations onto the target", () => {
		const schema = only(one({ jsonSchema: { onExcessProperty: "error" }, rootAnnotations: { title: "T" } }));
		assert.deepStrictEqual(schema.target.jsonSchema, { onExcessProperty: "error" });
		assert.deepStrictEqual(schema.target.rootAnnotations, { title: "T" });
	});

	it("trims a trailing slash on outputDir", () => {
		assert.strictEqual(only(one({}, { outputDir: "schemas/" })).target.path, "schemas/okfit.json");
	});
});

describe("defineConfig validation", () => {
	const rejects = (entry: Record<string, unknown>, top: Record<string, unknown>, pattern: RegExp) =>
		assert.throws(() => one(entry, top), pattern);

	it("rejects an empty schemas record", () => {
		assert.throws(() => defineConfig({ outputDir: "schemas", schemas: {} }), /at least one schema/);
	});

	it("rejects a missing or empty outputDir", () => {
		assert.throws(
			() => defineConfig({ outputDir: "", schemas: { okfit: { schema: Config, baseUrl: CUSTOM } } }),
			/outputDir/,
		);
	});

	it("rejects a key that is not a simple file base name", () => {
		assert.throws(
			() => defineConfig({ outputDir: "s", baseUrl: CUSTOM, schemas: { "a/b": { schema: Config } } }),
			/schema "a\/b".*simple file base name/,
		);
	});

	it("rejects an entry with no baseUrl anywhere", () => {
		assert.throws(() => defineConfig({ outputDir: "s", schemas: { okfit: { schema: Config } } }), /"okfit".*baseUrl/);
	});

	it("rejects a custom baseUrl that is not https", () => {
		rejects({ baseUrl: "http://x" }, {}, /"okfit".*https:\/\//);
		rejects({ baseUrl: "example.com" }, {}, /"okfit".*https:\/\//);
	});

	it("rejects an empty versions array, an invalid label and two spellings of one label", () => {
		rejects({ versions: [] }, {}, /"okfit".*versions.*empty/);
		rejects({ versions: ["nope!"] }, {}, /"okfit".*invalid version label "nope!"/);
		rejects({ versions: ["1.2", "1.2.0"] }, {}, /"okfit".*"1\.2".*"1\.2\.0"/);
	});

	it("rejects current without versions or not among them", () => {
		rejects({ current: "1.0" }, {}, /"okfit".*current.*versions/);
		rejects({ versions: ["1.0"], current: "1.1" }, {}, /"okfit".*current "1\.1".*versions/);
	});

	it("rejects layout under schemastore", () => {
		rejects({ versions: ["1.0"], layout: "versioned" }, {}, /"okfit".*layout.*schemastore/);
	});

	it("requires catalog under schemastore and a non-empty fileMatch", () => {
		assert.throws(
			() => defineConfig({ outputDir: "s", baseUrl: "schemastore", schemas: { okfit: { schema: Config } } }),
			/"okfit".*catalog.*schemastore/,
		);
		rejects({ catalog: { description: "d", fileMatch: [] } }, {}, /"okfit".*fileMatch/);
	});

	it("rejects an invalid drift tolerance and onDrift", () => {
		rejects({ drift: "loose" as never }, {}, /"okfit".*drift/);
		assert.throws(() => one({}, { onDrift: "ignore" as never }), /onDrift/);
	});

	it("rejects an invalid top-level drift tolerance", () => {
		assert.throws(() => one({}, { drift: "loose" as never }), /config has an invalid drift tolerance "loose"/);
	});

	it("rejects an invalid layout", () => {
		rejects({ baseUrl: CUSTOM, layout: "nested" as never }, {}, /"okfit".*invalid layout "nested"/);
	});

	it("rejects an empty catalogPath", () => {
		assert.throws(() => one({}, { catalogPath: "" }), /catalogPath/);
	});

	it("rejects an untyped schema entry", () => {
		assert.throws(
			() => defineConfig({ outputDir: "s", baseUrl: CUSTOM, schemas: { okfit: null as never } }),
			/"okfit".*must be an object/,
		);
	});

	it("rejects an invalid catalog block", () => {
		rejects({ catalog: { description: "d" } as never }, {}, /"okfit".*invalid catalog block/);
	});

	it("rejects a catalogPath colliding with a derived file, after lexical normalisation", () => {
		assert.throws(() => one({}, { catalogPath: "./schemas/x/../okfit.json" }), /output path .* is declared twice/);
	});

	it("rejects two entries deriving one file (mixed layouts)", () => {
		assert.throws(
			() =>
				defineConfig({
					outputDir: "s",
					baseUrl: CUSTOM,
					schemas: {
						okfit: { schema: Config, versions: ["1.0"], layout: "flat" },
						"okfit-1.0": { schema: Config },
					},
				}),
			/output path "s\/okfit-1\.0\.json" is declared twice/,
		);
	});
});

describe("isSchemastoreConfig", () => {
	it("rejects unbranded values", () => {
		assert.isFalse(isSchemastoreConfig({ schemas: [] }));
		assert.isFalse(isSchemastoreConfig(null));
	});
});
