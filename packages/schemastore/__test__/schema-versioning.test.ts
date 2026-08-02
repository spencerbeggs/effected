import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result } from "effect";
import type { SchemaVersion } from "../src/index.js";
import { CanonicalJson, InvalidSchemaVersionError, SchemaVersioning } from "../src/index.js";

const version = (label: string): SchemaVersion => Result.getOrThrow(SchemaVersioning.parseResult(label));

describe("SchemaVersioning", () => {
	describe("parse", () => {
		it("accepts one- to three-component labels with optional prerelease", () => {
			for (const label of ["1", "1.2", "1.2.3", "0.4", "2-beta", "1.2-rc.1"]) {
				assert.isTrue(Result.isSuccess(SchemaVersioning.parseResult(label)), label);
			}
		});

		it("accepts SemVer §9-legal prerelease identifiers: zero itself and leading-zero alphanumerics", () => {
			for (const label of ["1.2-0", "1.2-0abc", "1.2-rc.0", "1.2-01a", "1.2-0.3.7"]) {
				assert.isTrue(Result.isSuccess(SchemaVersioning.parseResult(label)), label);
			}
		});

		it("rejects leading-zero NUMERIC prerelease identifiers (they cannot survive the ordering pad)", () => {
			for (const label of ["1.2-01", "1.2-00", "1.2-1.02", "1.2.3-01"]) {
				const result = SchemaVersioning.parseResult(label);
				assert.isTrue(Result.isFailure(result), label);
				assert.instanceOf(
					(result as Result.Failure<SchemaVersion, InvalidSchemaVersionError>).failure,
					InvalidSchemaVersionError,
				);
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

		it("every grammar-accepted label survives the ordering pad (the closure invariant)", () => {
			// The Order pads a label to full SemVer and re-parses it through
			// @effected/semver; the grammar must therefore admit nothing that
			// parse rejects, or ordering throws on grammar-valid input (the
			// recorded 1.2-01 regression). Sweep a generated corpus of core ×
			// prerelease combinations: whatever the grammar accepts must order.
			const cores = ["0", "1", "1.2", "1.2.3", "10.20.30", "0.0.0"];
			const prereleases = [
				"",
				"-0",
				"-1",
				"-01",
				"-00",
				"-0abc",
				"-01a",
				"-alpha",
				"-alpha.1",
				"-0.3.7",
				"-x-y-z",
				"--",
			];
			let accepted = 0;
			for (const core of cores) {
				for (const prerelease of prereleases) {
					const label = `${core}${prerelease}`;
					const result = SchemaVersioning.parseResult(label);
					if (Result.isSuccess(result)) {
						accepted += 1;
						// Order calls the pad on both sides; a pad failure throws.
						assert.strictEqual(SchemaVersioning.Order(result.success, result.success), 0, label);
					}
				}
			}
			// The sweep must not be vacuous: only the two leading-zero numeric
			// prerelease suffixes ("-01", "-00") are rejected per core.
			assert.strictEqual(accepted, cores.length * (prereleases.length - 2));
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

		it("bare-major labels enumerate first — the JS-object caveat the docs record, pinned", () => {
			const urls = SchemaVersioning.catalogUrls({
				baseUrl: "https://example.com",
				name: "cfg",
				versions: ["1.5", "2"].map(version),
			});
			// "2" is the latest, so url points at it…
			assert.strictEqual(urls.url, "https://example.com/cfg-2.json");
			// …but as an array-index-like key it also ENUMERATES first, ahead
			// of the ascending insertion order ("1.5" was inserted first).
			// This is JavaScript object semantics, not a choice this package
			// can serialize around: key order is not the ordering contract.
			assert.deepStrictEqual(Object.keys(urls.versions ?? {}), ["2", "1.5"]);
			// The serialized catalog emits that same enumeration order.
			const text = Result.getOrThrow(CanonicalJson.serializeResult(urls.versions));
			assert.isBelow(text.indexOf('"2"'), text.indexOf('"1.5"'));
			// The map's CONTENT is authoritative regardless of key position.
			assert.deepStrictEqual(urls.versions, {
				"1.5": "https://example.com/cfg-1.5.json",
				"2": "https://example.com/cfg-2.json",
			});
		});

		it("throws on the versioned/empty contradiction", () => {
			assert.throws(() => SchemaVersioning.catalogUrls({ baseUrl: "https://example.com", name: "cfg", versions: [] }));
		});
	});
});
