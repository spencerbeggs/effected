import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result } from "effect";
import type { SchemaVersion } from "../src/index.js";
import { InvalidSchemaVersionError, SchemaVersioning } from "../src/index.js";

const version = (label: string): SchemaVersion => Result.getOrThrow(SchemaVersioning.parseResult(label));

describe("SchemaVersioning", () => {
	describe("parse", () => {
		it("accepts one- to three-component labels with optional prerelease", () => {
			for (const label of ["1", "1.2", "1.2.3", "0.4", "2-beta", "1.2-rc.1"]) {
				assert.isTrue(Result.isSuccess(SchemaVersioning.parseResult(label)), label);
			}
		});

		it("rejects malformed labels typed", () => {
			for (const label of ["", "v1.2", "1.2.3.4", "01.2", "1..2", "1.2-", "1.2+build"]) {
				const result = SchemaVersioning.parseResult(label);
				assert.isTrue(Result.isFailure(result), label);
				const error = (result as Result.Failure<SchemaVersion, InvalidSchemaVersionError>).failure;
				assert.instanceOf(error, InvalidSchemaVersionError);
				assert.strictEqual(error.input, label);
			}
		});

		it.effect("Effect form derives from the Result primitive", () =>
			Effect.gen(function* () {
				const parsed = yield* SchemaVersioning.parse("1.2");
				assert.strictEqual(parsed, "1.2");
				const error = yield* Effect.flip(SchemaVersioning.parse("nope"));
				assert.strictEqual(error._tag, "InvalidSchemaVersionError");
			}),
		);
	});

	describe("Order and latest", () => {
		it("orders numerically, not lexically", () => {
			assert.isAbove(SchemaVersioning.Order(version("1.10"), version("1.9")), 0);
			assert.isBelow(SchemaVersioning.Order(version("1.2"), version("1.2.1")), 0);
			assert.strictEqual(SchemaVersioning.Order(version("1.2"), version("1.2.0")), 0);
		});

		it("ranks prereleases below their release", () => {
			assert.isBelow(SchemaVersioning.Order(version("2-beta"), version("2")), 0);
		});

		it("latest picks the highest label and none for empty input", () => {
			const labels = ["1.9", "1.10", "1.2.3"].map(version);
			assert.deepStrictEqual(SchemaVersioning.latest(labels), Option.some(version("1.10")));
			// A higher-major prerelease still outranks a lower major.
			assert.deepStrictEqual(SchemaVersioning.latest([...labels, version("2-beta")]), Option.some(version("2-beta")));
			assert.deepStrictEqual(SchemaVersioning.latest([]), Option.none());
		});
	});

	describe("fileName and schemaUrl", () => {
		it("derives unversioned and versioned file names", () => {
			assert.strictEqual(SchemaVersioning.fileName("agripparc"), "agripparc.json");
			assert.strictEqual(SchemaVersioning.fileName("agripparc", version("1.2")), "agripparc-1.2.json");
		});

		it("throws on names that are not simple file base names", () => {
			assert.throws(() => SchemaVersioning.fileName(""));
			assert.throws(() => SchemaVersioning.fileName("a/b"));
			assert.throws(() => SchemaVersioning.fileName("a b"));
		});

		it("joins baseUrl without doubling slashes", () => {
			assert.strictEqual(
				SchemaVersioning.schemaUrl("https://example.com/schemas/", "cfg"),
				"https://example.com/schemas/cfg.json",
			);
			assert.strictEqual(
				SchemaVersioning.schemaUrl("https://example.com/schemas", "cfg"),
				"https://example.com/schemas/cfg.json",
			);
		});
	});

	describe("catalogUrls", () => {
		it("unversioned mode: url only, no versions map", () => {
			const urls = SchemaVersioning.catalogUrls({ baseUrl: "https://example.com", name: "cfg" });
			assert.deepStrictEqual(urls, { url: "https://example.com/cfg.json" });
		});

		it("versioned mode: ascending versions map with url at the latest", () => {
			const urls = SchemaVersioning.catalogUrls({
				baseUrl: "https://example.com",
				name: "agripparc",
				versions: ["1.4", "1.2", "1.3"].map(version),
			});
			assert.strictEqual(urls.url, "https://example.com/agripparc-1.4.json");
			assert.deepStrictEqual(urls.versions, {
				"1.2": "https://example.com/agripparc-1.2.json",
				"1.3": "https://example.com/agripparc-1.3.json",
				"1.4": "https://example.com/agripparc-1.4.json",
			});
			assert.deepStrictEqual(Object.keys(urls.versions ?? {}), ["1.2", "1.3", "1.4"]);
		});

		it("throws on the versioned/empty contradiction", () => {
			assert.throws(() => SchemaVersioning.catalogUrls({ baseUrl: "https://example.com", name: "cfg", versions: [] }));
		});
	});
});
