import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { HostedSchema, SchemastoreVersion, defineConfig } from "@effected/schemastore";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import type { SchemaProgress, SchemaRunInput } from "../../src/schema/SchemaRun.js";
import { SchemaRun } from "../../src/schema/SchemaRun.js";
import { VersionCheck } from "../../src/schema/VersionCheck.js";

const STAMP = Symbol.for("@effected/schemastore/version");
const BRAND = Symbol.for("@effected/schemastore/HostedSchema");

const Fixture = Schema.Struct({ name: Schema.String });
const BASE = "https://example.com/schemas";

// A HostedSchema from another copy of the package: the brand and its own stamp,
// and none of this copy's methods.
const foreignHosted = (version: string, fields: object = { name: "app", baseUrl: BASE }) =>
	Object.defineProperties(
		{ ...fields },
		{
			[BRAND]: { value: true },
			[STAMP]: { value: version },
		},
	) as HostedSchema;

const local = () =>
	defineConfig({
		name: "test",
		outputDir: "schemas",
		schemas: { app: { schema: Fixture, hosted: HostedSchema.github({ repo: "o/r", name: "app" }) } },
	});

const withForeign = (version: string) =>
	defineConfig({
		name: "test",
		outputDir: "schemas",
		schemas: { app: { schema: Fixture, hosted: foreignHosted(version) } },
	});

const volume = (seed: MemoryFileSystemSeed = {}) =>
	Layer.merge(Path.layer, MemoryFileSystem.layerWith({ "/repo/schemastore.config.ts": "", ...seed }));

const input = (versionMismatch: SchemaRunInput["versionMismatch"]): SchemaRunInput => ({
	mode: "check",
	force: false,
	versionMismatch,
});

const deps = (config: unknown) => ({
	cwd: "/repo",
	importModule: () => Promise.resolve({ default: config }),
});

describe("VersionCheck.inspect", () => {
	it("this copy carries a real version, or the suites below prove nothing", () => {
		assert.notStrictEqual(SchemastoreVersion.current, "0.0.0");
	});

	it.effect("matching stamps pass", () =>
		Effect.sync(() => {
			assert.isTrue(Option.isNone(VersionCheck.inspect(local())));
		}),
	);

	it("names a foreign hosted stamp, and the tool's own version", () => {
		const mismatch = Option.getOrThrow(VersionCheck.inspect(withForeign("9.9.9")));
		assert.strictEqual(mismatch.tool, SchemastoreVersion.current);
		assert.deepStrictEqual(
			mismatch.found.map((entry) => entry.version),
			["9.9.9"],
		);
		assert.include(mismatch.found[0]?.where ?? "", "app");
	});

	it("names a foreign config stamp", () => {
		const config = Object.defineProperty({ ...local() }, STAMP, { value: "8.8.8" });
		const mismatch = Option.getOrThrow(VersionCheck.inspect(config));
		assert.deepStrictEqual(mismatch.found, [{ where: "config", version: "8.8.8" }]);
	});

	it("reads a foreign value only through its stamp, so one with no methods is safe", () => {
		const bare = foreignHosted("9.9.9");
		assert.isUndefined((bare as unknown as { toJson?: unknown }).toJson);
		assert.isTrue(Option.isSome(VersionCheck.inspect(withForeign("9.9.9"))));
	});

	it("a '0.0.0' stamp on either side skips the comparison", () => {
		assert.isTrue(Option.isNone(VersionCheck.inspect(withForeign("0.0.0"))));
		assert.isTrue(Option.isNone(VersionCheck.inspect(withForeign("9.9.9"), "0.0.0")));
		// The control: the same config against a real tool version does mismatch.
		assert.isTrue(Option.isSome(VersionCheck.inspect(withForeign("9.9.9"), "1.2.3")));
	});

	it("an unstamped value has nothing to compare", () => {
		const config = { ...local() };
		assert.isTrue(Option.isNone(SchemastoreVersion.of(config)));
		assert.isTrue(Option.isNone(VersionCheck.inspect(config)));
	});

	it("the mismatch message names both versions and both remedies", () => {
		const mismatch = Option.getOrThrow(VersionCheck.inspect(withForeign("9.9.9"), "1.2.3"));
		assert.include(mismatch.message, "1.2.3");
		assert.include(mismatch.message, "9.9.9");
		assert.include(mismatch.message, "@effected/schemastore");
		// The carrier holds the tool's own copy, so a config built from it always matches.
		assert.include(mismatch.message, "authoring surface @effected/plugin exports");
		assert.include(mismatch.message, "catalog:effected");
	});
});

describe("SchemaRun under a version mismatch", () => {
	// A frozen version with no file: if the run got past the version check, this
	// config would fail FrozenVersionMissingError, which is what discriminates
	// "before generation" from "somewhere later".
	const frozenConfig = () =>
		defineConfig({
			name: "test",
			outputDir: "schemas",
			schemas: {
				app: {
					schema: Fixture,
					hosted: foreignHosted("9.9.9", { name: "app", baseUrl: BASE, versions: ["1.0", "1.1"] }),
				},
			},
		});

	it.effect("a foreign hosted stamp under 'fail' is VersionMismatchError before generation", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const error = yield* Effect.flip(SchemaRun.run(input("fail"), deps(frozenConfig())));
			assert.strictEqual(error._tag, "VersionMismatchError");
			if (error._tag === "VersionMismatchError") {
				assert.strictEqual(error.tool, SchemastoreVersion.current);
				assert.deepStrictEqual(
					error.found.map((entry) => entry.version),
					["9.9.9"],
				);
				assert.include(error.message, "9.9.9");
			}
			assert.isFalse(yield* fs.exists("/repo/schemas"));
		}).pipe(Effect.provide(volume())),
	);

	it.effect("the control: the same config under 'warn' reaches the frozen check", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(SchemaRun.run(input("warn"), deps(frozenConfig())));
			assert.strictEqual(error._tag, "FrozenVersionMissingError");
		}).pipe(Effect.provide(volume())),
	);

	it.effect("under 'warn', Started carries the mismatch before a later failure loses it", () =>
		Effect.gen(function* () {
			const events: Array<SchemaProgress> = [];
			const error = yield* Effect.flip(
				SchemaRun.run(input("warn"), {
					...deps(frozenConfig()),
					onProgress: (event) =>
						Effect.sync(() => {
							events.push(event);
						}),
				}),
			);
			assert.strictEqual(error._tag, "FrozenVersionMissingError");
			assert.lengthOf(events, 1);
			const [started] = events;
			assert.strictEqual(started?._tag, "Started");
			assert.strictEqual(started?._tag === "Started" ? started.versionMismatch?.found[0]?.version : undefined, "9.9.9");
		}).pipe(Effect.provide(volume())),
	);

	it.effect("the same under 'warn' runs and the result carries versionMismatch", () =>
		Effect.gen(function* () {
			const result = yield* SchemaRun.run(input("warn"), deps(withForeign("9.9.9")));
			assert.strictEqual(result.versionMismatch?.found[0]?.version, "9.9.9");
			assert.strictEqual(result.report.schemas.length, 1);
		}).pipe(Effect.provide(volume())),
	);

	it.effect("matching stamps carry no versionMismatch", () =>
		Effect.gen(function* () {
			const result = yield* SchemaRun.run(input("fail"), deps(local()));
			assert.isFalse("versionMismatch" in result);
		}).pipe(Effect.provide(volume())),
	);
});
