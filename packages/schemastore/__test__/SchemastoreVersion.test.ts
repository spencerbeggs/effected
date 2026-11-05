import { assert, describe, it } from "@effect/vitest";
import { Equal, Option, Schema } from "effect";
import { HostedSchema, SchemastoreVersion, defineConfig, isSchemastoreConfig } from "../src/index.js";

const STAMP = Symbol.for("@effected/schemastore/version");
const BRAND = Symbol.for("@effected/schemastore/HostedSchema");

const hosted = () => HostedSchema.github({ repo: "o/r", name: "a", versions: ["1.0"] });
const Config = Schema.Struct({ name: Schema.String });

describe("SchemastoreVersion", () => {
	it("of reads the stamp from a HostedSchema and a defineConfig result", () => {
		const config = defineConfig({ name: "t", outputDir: "s", schemas: { a: { schema: Config, hosted: hosted() } } });
		assert.deepStrictEqual(SchemastoreVersion.of(hosted()), Option.some(SchemastoreVersion.current));
		assert.deepStrictEqual(SchemastoreVersion.of(config), Option.some(SchemastoreVersion.current));
	});

	it("of reads a foreign copy's version rather than answering its own", () => {
		const foreign = Object.defineProperty({}, STAMP, { value: "9.9.9" });
		assert.deepStrictEqual(SchemastoreVersion.of(foreign), Option.some("9.9.9"));
	});

	it("of is none for an ordinary object", () => {
		for (const value of [{}, null, undefined, "1.0.0", 1, { version: "1.0.0" }]) {
			assert.isTrue(Option.isNone(SchemastoreVersion.of(value)), String(value));
		}
		assert.isTrue(Option.isNone(SchemastoreVersion.of(Object.defineProperty({}, STAMP, { value: 1 }))));
	});

	it("the stamp doesn't enter encoding or equality", () => {
		const encoded = Schema.encodeUnknownSync(HostedSchema)(hosted());
		assert.deepStrictEqual(encoded, {
			name: "a",
			baseUrl: "https://raw.githubusercontent.com/o/r/main",
			versions: ["1.0"],
		});
		assert.deepStrictEqual(Object.getOwnPropertySymbols(encoded), []);
		assert.deepStrictEqual(Object.getOwnPropertySymbols(hosted()), []);
		assert.isTrue(Equal.equals(hosted(), hosted()));
		assert.isFalse(Equal.equals(hosted(), HostedSchema.github({ repo: "o/x", name: "a", versions: ["1.0"] })));
	});

	it("the stamp on a defineConfig result is not enumerable, while its brand stays so", () => {
		const config = defineConfig({
			name: "t",
			outputDir: "s",
			baseUrl: "https://x/s",
			schemas: { a: { schema: Config } },
		});
		assert.isFalse(Object.getOwnPropertyDescriptor(config, STAMP)?.enumerable);
		assert.isFalse(Object.hasOwn({ ...config }, STAMP));
		const brand = Symbol.for("@effected/schemastore/SchemastoreConfig");
		assert.isTrue(Object.getOwnPropertyDescriptor(config, brand)?.enumerable);
		assert.isTrue(isSchemastoreConfig({ ...config }));
	});
});

describe("defineConfig's hosted recognition", () => {
	const foreign = (fields: object, version = "9.9.9") =>
		Object.defineProperties(
			{ ...fields },
			{ [BRAND]: { value: true }, [STAMP]: { value: version } },
		) as unknown as HostedSchema;

	it("defineConfig accepts a foreign HostedSchema by brand", () => {
		const config = defineConfig({
			name: "t",
			outputDir: "s",
			schemas: {
				a: { schema: Config, hosted: foreign({ name: "a", baseUrl: "https://x/s", versions: ["1.0", "1.1"] }) },
			},
		});
		const [schema] = config.schemas;
		assert.strictEqual(schema?.target.$id, "https://x/s/1.1/a-1.1.json");
		assert.strictEqual(schema?.frozen[0]?.$id, "https://x/s/1.0/a-1.0.json");
	});

	it("keeps the hosted value it was given, so the engine can read a foreign stamp", () => {
		const given = foreign({ name: "a", baseUrl: "https://x/s" });
		const config = defineConfig({ name: "t", outputDir: "s", schemas: { a: { schema: Config, hosted: given } } });
		assert.strictEqual(config.schemas[0]?.hosted, given);
		assert.deepStrictEqual(SchemastoreVersion.of(config.schemas[0]?.hosted), Option.some("9.9.9"));
		const own = defineConfig({ name: "t", outputDir: "s", baseUrl: "https://x/s", schemas: { a: { schema: Config } } });
		assert.isFalse(Object.hasOwn(own.schemas[0] ?? {}, "hosted"));
	});

	it("still validates a foreign value's fields", () => {
		assert.throws(
			() =>
				defineConfig({
					name: "t",
					outputDir: "s",
					schemas: { a: { schema: Config, hosted: foreign({ name: "a", baseUrl: "http://insecure" }) } },
				}),
			/https:\/\//,
		);
	});

	it("defineConfig still rejects a plain object as hosted", () => {
		assert.throws(
			() =>
				defineConfig({
					name: "t",
					outputDir: "s",
					schemas: { a: { schema: Config, hosted: { name: "a", baseUrl: "https://x/s" } as unknown as HostedSchema } },
				}),
			/Expected a HostedSchema/,
		);
	});
});
