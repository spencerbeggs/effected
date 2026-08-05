import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result } from "effect";
import type { SchemaVersion } from "../src/index.js";
import { CanonicalJson, InvalidSchemaVersionError, SchemaVersioning } from "../src/index.js";

const version = (label: string): SchemaVersion => Result.getOrThrow(SchemaVersioning.parseResult(label));

describe("SchemaVersioning", () => {
	describe("parse", () => {
		it("accepts full three-component SemVer labels with optional prerelease", () => {
			for (const label of ["1.2.3", "0.4.0", "2.0.0-beta", "1.2.0-rc.1", "10.20.30"]) {
				assert.isTrue(Result.isSuccess(SchemaVersioning.parseResult(label)), label);
			}
		});

		// The deliberate divergence from SchemaStore's own corpus, which uses
		// labels like `agripparc-1.2`: a partial label cannot be split back
		// out of a file name unambiguously.
		it("rejects the partial labels SchemaStore's corpus uses", () => {
			for (const label of ["1", "1.2", "0.4", "2-beta"]) {
				assert.isTrue(Result.isFailure(SchemaVersioning.parseResult(label)), label);
			}
		});

		it("accepts SemVer §9-legal prerelease identifiers: zero itself and leading-zero alphanumerics", () => {
			for (const label of ["1.2.0-0", "1.2.0-0abc", "1.2.0-rc.0", "1.2.0-01a", "1.2.0-0.3.7"]) {
				assert.isTrue(Result.isSuccess(SchemaVersioning.parseResult(label)), label);
			}
		});

		it("rejects leading-zero NUMERIC prerelease identifiers", () => {
			for (const label of ["1.2.0-01", "1.2.0-00", "1.2.0-1.02", "1.2.3-01"]) {
				const result = SchemaVersioning.parseResult(label);
				assert.isTrue(Result.isFailure(result), label);
				assert.instanceOf(
					(result as Result.Failure<SchemaVersion, InvalidSchemaVersionError>).failure,
					InvalidSchemaVersionError,
				);
			}
		});

		it("rejects malformed labels typed", () => {
			for (const label of [
				"",
				"v1.2.3",
				"1.2.3.4",
				"01.2.3",
				"1..2",
				"1.2.3-",
				"1.2.3+build",
				// SemVer.parseResult trims, so these parse if the label is not
				// guarded — and the padding would survive into the emitted
				// file name and URL verbatim.
				" 1.2.3",
				"1.2.3 ",
				" 1.2.3 ",
				"\t1.2.3",
			]) {
				const result = SchemaVersioning.parseResult(label);
				assert.isTrue(Result.isFailure(result), label);
				const error = (result as Result.Failure<SchemaVersion, InvalidSchemaVersionError>).failure;
				assert.instanceOf(error, InvalidSchemaVersionError);
				assert.strictEqual(error.input, label);
			}
		});

		it.effect("Effect form derives from the Result primitive", () =>
			Effect.gen(function* () {
				const parsed = yield* SchemaVersioning.parse("1.2.0");
				assert.strictEqual(parsed, "1.2.0");
				const error = yield* Effect.flip(SchemaVersioning.parse("nope"));
				assert.strictEqual(error._tag, "InvalidSchemaVersionError");
			}),
		);
	});

	describe("Order and latest", () => {
		it("orders numerically, not lexically", () => {
			assert.isAbove(SchemaVersioning.Order(version("1.10.0"), version("1.9.0")), 0);
			assert.isBelow(SchemaVersioning.Order(version("1.2.0"), version("1.2.1")), 0);
		});

		it("ranks prereleases below their release", () => {
			assert.isBelow(SchemaVersioning.Order(version("2.0.0-beta"), version("2.0.0")), 0);
		});

		it("every accepted label orders without throwing (the closure invariant)", () => {
			// The brand's filter and Order's parse are now the SAME call, so
			// this can no longer diverge the way the padded grammar could —
			// the sweep stays as a regression pin on that property.
			const cores = ["0.0.0", "1.0.0", "1.2.0", "1.2.3", "10.20.30"];
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
			const labels = ["1.9.0", "1.10.0", "1.2.3"].map(version);
			assert.deepStrictEqual(SchemaVersioning.latest(labels), Option.some(version("1.10.0")));
			// A higher-major prerelease still outranks a lower major.
			assert.deepStrictEqual(
				SchemaVersioning.latest([...labels, version("2.0.0-beta")]),
				Option.some(version("2.0.0-beta")),
			);
			assert.deepStrictEqual(SchemaVersioning.latest([]), Option.none());
		});
	});

	describe("fileName and schemaUrl", () => {
		it("derives unversioned and versioned file names", () => {
			assert.strictEqual(SchemaVersioning.fileName("agripparc"), "agripparc.json");
			// SchemaStore's own suffix convention, with a full SemVer label.
			assert.strictEqual(SchemaVersioning.fileName("agripparc", version("1.2.0")), "agripparc-1.2.0.json");
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
				versions: ["1.4.0", "1.2.0", "1.3.0"].map(version),
			});
			assert.strictEqual(urls.url, "https://example.com/agripparc-1.4.0.json");
			assert.deepStrictEqual(urls.versions, {
				"1.2.0": "https://example.com/agripparc-1.2.0.json",
				"1.3.0": "https://example.com/agripparc-1.3.0.json",
				"1.4.0": "https://example.com/agripparc-1.4.0.json",
			});
			assert.deepStrictEqual(Object.keys(urls.versions ?? {}), ["1.2.0", "1.3.0", "1.4.0"]);
		});

		// Requiring three components RETIRES the JS-object caveat the docs
		// used to record: a bare-major label ("2") is array-index-like and
		// enumerated ahead of every dotted key regardless of insertion order.
		// No SemVer label can be integer-like, so insertion order now holds
		// all the way through serialization.
		it("no label is array-index-like, so ascending insertion order survives serialization", () => {
			const urls = SchemaVersioning.catalogUrls({
				baseUrl: "https://example.com",
				name: "cfg",
				versions: ["2.0.0", "1.5.0"].map(version),
			});
			assert.strictEqual(urls.url, "https://example.com/cfg-2.0.0.json");
			assert.deepStrictEqual(Object.keys(urls.versions ?? {}), ["1.5.0", "2.0.0"]);
			const text = Result.getOrThrow(CanonicalJson.serializeResult(urls.versions));
			assert.isBelow(text.indexOf('"1.5.0"'), text.indexOf('"2.0.0"'));
		});

		it("throws on the versioned/empty contradiction", () => {
			assert.throws(() => SchemaVersioning.catalogUrls({ baseUrl: "https://example.com", name: "cfg", versions: [] }));
		});
	});
});
