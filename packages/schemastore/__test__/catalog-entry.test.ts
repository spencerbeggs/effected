import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import type { SchemaVersion } from "../src/index.js";
import { CatalogEntry, SchemaVersioning } from "../src/index.js";

const version = (label: string): SchemaVersion => Result.getOrThrow(SchemaVersioning.parseResult(label));

describe("CatalogEntry", () => {
	describe("assemble", () => {
		it("unversioned mode omits the versions key entirely", () => {
			const entry = CatalogEntry.assemble({
				name: "silk-release",
				description: "Silk release action output",
				fileMatch: ["silk-release.json"],
				baseUrl: "https://example.com/schemas",
			});
			assert.strictEqual(entry.url, "https://example.com/schemas/silk-release.json");
			assert.notProperty(entry, "versions");
		});

		it("versioned mode derives the map and points url at the latest", () => {
			const entry = CatalogEntry.assemble({
				name: "Agripparc",
				description: "Agripparc config",
				fileMatch: ["agripparc.yaml"],
				baseUrl: "https://example.com/schemas",
				fileBaseName: "agripparc",
				versions: ["1.2", "1.4", "1.3"].map(version),
			});
			assert.strictEqual(entry.url, "https://example.com/schemas/agripparc-1.4.json");
			assert.deepStrictEqual(entry.versions, {
				"1.2": "https://example.com/schemas/agripparc-1.2.json",
				"1.3": "https://example.com/schemas/agripparc-1.3.json",
				"1.4": "https://example.com/schemas/agripparc-1.4.json",
			});
		});
	});

	describe("codec round trip", () => {
		it.effect("decodes a catalog.json entry and encodes it back unchanged (versioned)", () =>
			Effect.gen(function* () {
				const raw = {
					name: "agripparc",
					description: "Agripparc config",
					fileMatch: ["agripparc.yaml"],
					url: "https://example.com/agripparc-1.4.json",
					versions: {
						"1.2": "https://example.com/agripparc-1.2.json",
						"1.4": "https://example.com/agripparc-1.4.json",
					},
				};
				const entry = yield* Schema.decodeUnknownEffect(CatalogEntry)(raw);
				assert.instanceOf(entry, CatalogEntry);
				const encoded = yield* Schema.encodeUnknownEffect(CatalogEntry)(entry);
				assert.deepStrictEqual(encoded, raw);
			}),
		);

		it.effect("decodes and re-encodes the unversioned shape without minting a versions key", () =>
			Effect.gen(function* () {
				const raw = {
					name: "cfg",
					description: "Config",
					fileMatch: ["cfg.json"],
					url: "https://example.com/cfg.json",
				};
				const entry = yield* Schema.decodeUnknownEffect(CatalogEntry)(raw);
				const encoded = yield* Schema.encodeUnknownEffect(CatalogEntry)(entry);
				assert.deepStrictEqual(encoded, raw);
				assert.notProperty(encoded, "versions");
			}),
		);

		it.effect("assemble output survives an encode/decode round trip", () =>
			Effect.gen(function* () {
				const entry = CatalogEntry.assemble({
					name: "agripparc",
					description: "Agripparc config",
					fileMatch: ["agripparc.yaml"],
					baseUrl: "https://example.com",
					versions: ["1.2", "1.3"].map(version),
				});
				const encoded = yield* Schema.encodeUnknownEffect(CatalogEntry)(entry);
				const decoded = yield* Schema.decodeUnknownEffect(CatalogEntry)(encoded);
				assert.deepStrictEqual(decoded, entry);
			}),
		);
	});

	describe("lint", () => {
		it("fires GenericFileMatch on extension-wide patterns", () => {
			for (const pattern of ["*.json", "**/*.yml", "*.toml"]) {
				const findings = CatalogEntry.lintFileMatch([pattern]);
				assert.strictEqual(findings.length, 1, pattern);
				assert.strictEqual(findings[0]?.check, "GenericFileMatch");
				assert.strictEqual(findings[0]?.pattern, pattern);
			}
		});

		it("fires GenericFileMatch on generic base names (the Hugo config.toml case)", () => {
			for (const pattern of ["config.toml", "settings.json", "**/config.yaml"]) {
				const findings = CatalogEntry.lintFileMatch([pattern]);
				assert.strictEqual(findings.length, 1, pattern);
				assert.strictEqual(findings[0]?.check, "GenericFileMatch");
			}
		});

		it("fires ComplexFileMatch on braces, extglobs, classes and negation", () => {
			for (const pattern of ["*.{yml,yaml}", "@(a|b).json", "file[0-9].json", "!excluded.json"]) {
				const findings = CatalogEntry.lintFileMatch([pattern]);
				assert.isTrue(
					findings.some((finding) => finding.check === "ComplexFileMatch"),
					pattern,
				);
			}
		});

		it("passes clean on specific simple patterns", () => {
			const findings = CatalogEntry.lintFileMatch([
				"agripparc.yaml",
				"**/.myTool/settings-file.json",
				"silk-release.json",
				"tool.config.json",
			]);
			assert.deepStrictEqual(findings, []);
		});

		it("instance lint delegates to lintFileMatch", () => {
			const entry = CatalogEntry.make({
				name: "x",
				description: "x",
				fileMatch: ["*.json"],
				url: "https://example.com/x.json",
			});
			assert.strictEqual(entry.lint().length, 1);
		});
	});
});
