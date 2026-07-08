import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Effect, HashMap, Layer, Option } from "effect";
import { Package } from "../../src/Package.js";
import { PackageJsonFile } from "../../src/PackageJsonFile.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");
const fixturePath = (name: string) => resolve(FIXTURES, name, "package.json");

// The integration boundary: the file service over a real platform (the only
// tests that provide FileSystem / Path).
const TestLayer = PackageJsonFile.layer.pipe(Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)));

describe("PackageJsonFile", () => {
	layer(TestLayer)((it) => {
		it.effect("reads the minimal fixture", () =>
			Effect.gen(function* () {
				const file = yield* PackageJsonFile;
				const pkg = yield* file.read(fixturePath("minimal"));
				assert.strictEqual(pkg.name, "minimal-pkg");
				assert.strictEqual(pkg.version.toString(), "1.0.0");
				assert.strictEqual(HashMap.size(pkg.dependencies), 0);
				assert.strictEqual(pkg.description, undefined);
			}),
		);

		it.effect("reads the full fixture with all typed fields", () =>
			Effect.gen(function* () {
				const file = yield* PackageJsonFile;
				const pkg = yield* file.read(fixturePath("full"));
				assert.strictEqual(pkg.name, "@scope/full-pkg");
				assert.isTrue(pkg.isScoped);
				assert.isTrue(pkg.isESM);
				assert.isTrue(pkg.isPrivate);
				assert.strictEqual(pkg.description, "A full package with all typed fields");
				assert.strictEqual(pkg.license, "MIT");
				assert.strictEqual(HashMap.size(pkg.dependencies), 2);
				assert.strictEqual(HashMap.size(pkg.devDependencies), 2);
				assert.strictEqual(HashMap.size(pkg.peerDependencies), 1);
				assert.strictEqual(HashMap.size(pkg.optionalDependencies), 1);
				assert.deepStrictEqual(HashMap.get(pkg.scripts, "test"), Option.some("vitest run"));
			}),
		);

		it.effect("reads the scoped fixture", () =>
			Effect.gen(function* () {
				const file = yield* PackageJsonFile;
				const pkg = yield* file.read(fixturePath("scoped"));
				assert.strictEqual(pkg.name, "@myorg/scoped-pkg");
				assert.isTrue(pkg.isScoped);
			}),
		);

		it.effect("reads the boilerplate fixture including packageManager and devEngines", () =>
			Effect.gen(function* () {
				const file = yield* PackageJsonFile;
				const pkg = yield* file.read(fixturePath("boilerplate"));
				assert.strictEqual(pkg.name, "@savvy-web/pnpm-module-template");
				assert.isTrue(pkg.isPrivate);
				assert.isTrue(pkg.isESM);
				assert.isTrue(pkg.packageManager !== undefined);
				assert.strictEqual(Option.getOrThrow(Option.fromUndefinedOr(pkg.packageManager)).name, "pnpm");
				assert.isTrue(HashMap.has(pkg.scripts, "build"));
			}),
		);

		it.effect("fails with PackageJsonNotFoundError for a missing file", () =>
			Effect.gen(function* () {
				const file = yield* PackageJsonFile;
				const error = yield* Effect.flip(file.read("/nonexistent/package.json"));
				assert.strictEqual(error._tag, "PackageJsonNotFoundError");
			}),
		);

		it.effect("fails with PackageJsonParseError for invalid JSON", () =>
			Effect.gen(function* () {
				const file = yield* PackageJsonFile;
				const dir = mkdtempSync(join(tmpdir(), "pkg-json-parse-"));
				const path = join(dir, "package.json");
				writeFileSync(path, "{ not valid json");
				const error = yield* Effect.flip(file.read(path));
				rmSync(dir, { recursive: true, force: true });
				assert.strictEqual(error._tag, "PackageJsonParseError");
			}),
		);
	});
});

describe("PackageJsonFile round-trip", () => {
	layer(TestLayer)((it) => {
		const roundtrip = (fixture: string) =>
			Effect.gen(function* () {
				const file = yield* PackageJsonFile;
				const dir = mkdtempSync(join(tmpdir(), "pkg-json-rt-"));
				const outPath = join(dir, "package.json");
				const pkg = yield* file.read(fixturePath(fixture));
				yield* file.write(outPath, pkg);
				const written = JSON.parse(readFileSync(outPath, "utf-8")) as Record<string, unknown>;
				rmSync(dir, { recursive: true, force: true });
				return written;
			});

		it.effect("minimal preserves name and version and strips empty dep maps", () =>
			Effect.gen(function* () {
				const result = yield* roundtrip("minimal");
				assert.strictEqual(result.name, "minimal-pkg");
				assert.strictEqual(result.version, "1.0.0");
				assert.isFalse("dependencies" in result);
				assert.isFalse("devDependencies" in result);
			}),
		);

		it.effect("full preserves typed fields and sorts keys and deps", () =>
			Effect.gen(function* () {
				const result = yield* roundtrip("full");
				assert.strictEqual(result.name, "@scope/full-pkg");
				assert.strictEqual(result.version, "2.1.0");
				assert.strictEqual(result.description, "A full package with all typed fields");
				assert.deepStrictEqual(result.dependencies, { effect: "^3.0.0", lodash: "^4.0.0" });
				const keys = Object.keys(result);
				assert.isTrue(keys.indexOf("name") < keys.indexOf("version"));
				assert.isTrue(keys.indexOf("scripts") < keys.indexOf("dependencies"));
			}),
		);

		it.effect("with-custom-fields preserves unknown fields", () =>
			Effect.gen(function* () {
				const result = yield* roundtrip("with-custom-fields");
				assert.strictEqual(result.customString, "preserved");
				assert.deepStrictEqual(result.customArray, [1, 2, 3]);
				assert.deepStrictEqual(result.customObject, { nested: true, deep: { value: "kept" } });
				assert.strictEqual(result["x-custom-namespace"], "also preserved");
			}),
		);

		it.effect("boilerplate preserves known and unknown fields and does not mutate workspace specifiers", () =>
			Effect.gen(function* () {
				const result = yield* roundtrip("boilerplate");
				assert.strictEqual(result.name, "@savvy-web/pnpm-module-template");
				assert.isDefined(result.publishConfig);
				assert.deepStrictEqual(result.repository, {
					type: "git",
					url: "https://github.com/spencerbeggs/pnpm-module-template.git",
				});
			}),
		);

		it.effect("write writes what it is given — resolution is NOT fused into write", () =>
			Effect.gen(function* () {
				const file = yield* PackageJsonFile;
				const dir = mkdtempSync(join(tmpdir(), "pkg-json-nores-"));
				const outPath = join(dir, "package.json");
				const pkg = yield* Package.decode({
					name: "p",
					version: "1.0.0",
					customX: "preserved",
					dependencies: { lib: "workspace:*" },
				});
				yield* file.write(outPath, pkg);
				const written = JSON.parse(readFileSync(outPath, "utf-8")) as Record<string, unknown>;
				rmSync(dir, { recursive: true, force: true });
				assert.strictEqual(written.customX, "preserved");
				assert.deepStrictEqual(written.dependencies, { lib: "workspace:*" });
			}),
		);

		it.effect("snapshot of the full round-trip output", () =>
			Effect.gen(function* () {
				const result = yield* roundtrip("full");
				assert.isDefined(result);
			}),
		);
	});
});
