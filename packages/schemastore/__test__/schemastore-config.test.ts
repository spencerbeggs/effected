import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { SchemaTarget, defineConfig, isSchemastoreConfig } from "../src/index.js";

const Config = Schema.Struct({ name: Schema.String });
const versioned = (version: string, published = false) =>
	SchemaTarget.make({
		schema: Config,
		$id: `https://x/okfit-${version}.json`,
		name: "okfit",
		version,
		path: `schemas/okfit-${version}.json`,
		published,
	});
const unversioned = SchemaTarget.make({ schema: Config, $id: "https://x/input.json", path: "input.schema.json" });

describe("defineConfig", () => {
	it("fills drift defaults and an empty catalog", () => {
		const config = defineConfig({ schemas: [unversioned] });
		assert.deepStrictEqual(config.drift, { policy: "semantic", onDrift: "error" });
		assert.deepStrictEqual(config.catalog, []);
		assert.isTrue(isSchemastoreConfig(config));
	});

	it("merges a partial drift block over the defaults", () => {
		const config = defineConfig({ schemas: [unversioned], drift: { onDrift: "warn" } });
		assert.deepStrictEqual(config.drift, { policy: "semantic", onDrift: "warn" });
	});

	it("rejects an empty schemas array", () => {
		assert.throws(() => defineConfig({ schemas: [] }), /at least one schema/);
	});

	it("rejects two spellings of one version under one name", () => {
		assert.throws(
			() => defineConfig({ schemas: [versioned("1.2"), versioned("1.2.0")] }),
			/"okfit".*"1\.2".*"1\.2\.0"/,
		);
	});

	it("derives catalog versions from every versioned schema of that name, published or not", () => {
		const config = defineConfig({
			schemas: [versioned("1.0", true), versioned("1.1"), unversioned],
			catalog: [
				{
					name: "okfit",
					description: "okfit config",
					fileMatch: ["okfit.toml"],
					baseUrl: "https://x/schemas",
					path: "schemas/catalog-entry.json",
				},
			],
		});
		const entry = config.catalog[0]?.entry;
		assert.isDefined(entry);
		assert.deepStrictEqual(Object.keys(entry.versions ?? {}), ["1.0", "1.1"]);
		assert.strictEqual(entry.url, "https://x/schemas/okfit-1.1.json");
	});

	it("rejects a catalog name that matches no versioned schema", () => {
		assert.throws(
			() =>
				defineConfig({
					schemas: [unversioned],
					catalog: [{ name: "ghost", description: "", fileMatch: ["x"], baseUrl: "https://x", path: "c.json" }],
				}),
			/catalog entry "ghost" matches no versioned schema/,
		);
	});

	it("rejects a malformed drift block", () => {
		assert.throws(() => defineConfig({ schemas: [unversioned], drift: { policy: "loose" as never } }), /drift/);
	});

	it("does not recognise a plain object as a config", () => {
		assert.isFalse(isSchemastoreConfig({ schemas: [], catalog: [], drift: {} }));
	});
});
