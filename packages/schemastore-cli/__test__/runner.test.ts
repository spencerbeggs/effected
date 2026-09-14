import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { SchemaVersion } from "@effected/schemastore";
import {
	CatalogEntry,
	SchemaFile,
	SchemaTarget,
	SchemaValidator,
	SchemaVersioning,
	StoreDocument,
	ValidationFinding,
	defineConfig,
} from "@effected/schemastore";
import { Effect, FileSystem, Layer, Path, Result, Schema } from "effect";
import type { RunOptions, RunReport } from "../src/Runner.js";
import { Runner } from "../src/Runner.js";

// ── Layers ────────────────────────────────────────────────────────────────
//
// `SchemaFile` is built over the memfs + Path base, and that same base is
// merged INTO the output (`provideMerge`, not `provide`) because the Runner
// reads `FileSystem` / `Path` directly for the catalog file and the tests
// read the volume back afterwards. Every `Effect.provide` of a memfs layer
// builds a fresh volume, so each test resolves the file system inside the
// one program it provides.
const layers = (seed: MemoryFileSystemSeed = {}, validator: Layer.Layer<SchemaValidator> = SchemaValidator.layer) =>
	Layer.mergeAll(SchemaFile.layer, validator).pipe(
		Layer.provideMerge(Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer)),
	);

// ── Fixtures ──────────────────────────────────────────────────────────────

const version = (label: string): SchemaVersion => Result.getOrThrow(SchemaVersioning.parseResult(label));

const emitted = (schema: Schema.Constraint, $id: string): string =>
	Result.getOrThrow(Result.getOrThrow(StoreDocument.fromSchemaResult(schema, { $id })).serializeResult());

const Config = Schema.Struct({ name: Schema.String });
// The predecessor's `required` carries an extra member, so a successor
// generated from `Config` reads as a CONTRACT change.
const Wider = Schema.Struct({ name: Schema.String, extra: Schema.String });
// Same contract, different prose: an ANNOTATIONS change.
const Described = Config.annotate({ description: "Before\nhttps://example.com/docs" });
const Redescribed = Config.annotate({ description: "After\nhttps://example.com/docs" });

const PINNED_ID = "https://example.com/schemas/pinned-5.0.0.json";
const PINNED_PATH = "/repo/schemas/5.0.0/pinned-5.0.0.json";
const PLAIN_ID = "https://example.com/schemas/plain.json";
const PLAIN_PATH = "/repo/schemas/plain.json";
const CATALOG_PATH = "/repo/catalog/pinned.json";

const pinned = (options: { readonly schema?: Schema.Constraint; readonly published?: boolean } = {}) =>
	SchemaTarget.make({
		schema: options.schema ?? Config,
		$id: PINNED_ID,
		name: "pinned",
		path: PINNED_PATH,
		version: version("5.0.0"),
		published: options.published ?? true,
	});

const plain = SchemaTarget.make({ schema: Config, $id: PLAIN_ID, path: PLAIN_PATH });

const catalog = [
	{
		name: "pinned",
		description: "Pinned configuration",
		fileMatch: ["pinned.json"],
		baseUrl: "https://example.com/schemas",
		path: CATALOG_PATH,
	},
];

const drift = (overrides: Partial<RunOptions["drift"]> = {}): RunOptions["drift"] => ({
	policy: "semantic",
	onDrift: "error",
	source: "config",
	...overrides,
});

const options = (mode: RunOptions["mode"], driftOptions: RunOptions["drift"] = drift()): RunOptions => ({
	mode,
	configPath: "/repo/schemastore.config.ts",
	drift: driftOptions,
});

const twoSchemas = defineConfig({ schemas: [pinned(), plain], catalog });

// The catalog entry `defineConfig` assembled, as another tool would have
// written it: compact, one line, key order preserved.
const compactCatalogText = (): string => {
	const [first] = twoSchemas.catalog;
	assert.isDefined(first);
	return `${JSON.stringify(Schema.encodeSync(CatalogEntry)(first.entry))}\n`;
};

const byId = (report: RunReport, $id: string) => {
	const found = report.schemas.find((schema) => schema.$id === $id);
	assert.isDefined(found, `no report for ${$id}`);
	return found;
};

const readAll = Effect.fn(function* (paths: ReadonlyArray<string>) {
	const fs = yield* FileSystem.FileSystem;
	const texts: Record<string, string> = {};
	for (const path of paths) {
		texts[path] = yield* fs.readFileString(path);
	}
	return texts;
});

describe("Runner.run", () => {
	it.effect("check on a fresh volume reports would-write for everything and touches nothing", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas, options("check"));
			assert.strictEqual(report.mode, "check");
			assert.strictEqual(report.configPath, "/repo/schemastore.config.ts");
			assert.deepStrictEqual(report.drift, drift());
			assert.strictEqual(report.schemas.length, 2);
			for (const schema of report.schemas) {
				assert.strictEqual(schema.change, "created");
				assert.strictEqual(schema.verdict, "write");
				assert.strictEqual(schema.outcome, "would-write");
			}
			assert.strictEqual(byId(report, PINNED_ID).name, "pinned");
			assert.strictEqual(byId(report, PINNED_ID).published, true);
			assert.strictEqual(byId(report, PLAIN_ID).published, false);
			assert.isUndefined(byId(report, PINNED_ID).nextVersion, "a created document needs no bump");
			assert.deepStrictEqual(
				report.catalog.map((entry) => entry.outcome),
				["would-write"],
			);
			assert.isFalse(report.drifted);
			assert.isFalse(report.gateFailed);
			assert.isFalse(report.wrote);
			assert.isFalse(yield* fs.exists(PINNED_PATH));
			assert.isFalse(yield* fs.exists(PLAIN_PATH));
			assert.isFalse(yield* fs.exists(CATALOG_PATH));
		}).pipe(Effect.provide(layers())),
	);

	it.effect("build on a fresh volume writes every schema and the catalog entry", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas, options("build"));
			assert.strictEqual(report.mode, "build");
			for (const schema of report.schemas) {
				assert.strictEqual(schema.change, "created");
				assert.strictEqual(schema.outcome, "written");
			}
			assert.deepStrictEqual(report.catalog, [{ name: "pinned", path: CATALOG_PATH, outcome: "written" }]);
			assert.isTrue(report.wrote);
			assert.isFalse(report.drifted);
			assert.isFalse(report.gateFailed);
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), emitted(Config, PINNED_ID));
			assert.strictEqual(yield* fs.readFileString(PLAIN_PATH), emitted(Config, PLAIN_ID));
			const entry = Schema.decodeUnknownSync(CatalogEntry)(JSON.parse(yield* fs.readFileString(CATALOG_PATH)));
			assert.strictEqual(entry.name, "pinned");
			assert.strictEqual(entry.url, "https://example.com/schemas/pinned-5.0.0.json");
			assert.deepStrictEqual(entry.versions, { "5.0.0": "https://example.com/schemas/pinned-5.0.0.json" });
		}).pipe(Effect.provide(layers())),
	);

	it.effect("build again over the first run's output changes nothing", () =>
		Effect.gen(function* () {
			// First run, on its own fresh volume: capture what it wrote.
			const first = yield* Effect.gen(function* () {
				yield* Runner.run(twoSchemas, options("build"));
				return yield* readAll([PINNED_PATH, PLAIN_PATH, CATALOG_PATH]);
			}).pipe(Effect.provide(layers()));

			// Second run, seeded with the first run's texts.
			yield* Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const report = yield* Runner.run(twoSchemas, options("build"));
				for (const schema of report.schemas) {
					assert.strictEqual(schema.change, "none");
					assert.strictEqual(schema.verdict, "write");
					assert.strictEqual(schema.outcome, "unchanged");
				}
				assert.deepStrictEqual(report.catalog, [{ name: "pinned", path: CATALOG_PATH, outcome: "unchanged" }]);
				assert.isFalse(report.wrote);
				assert.isFalse(report.drifted);
				assert.deepStrictEqual(yield* readAll([PINNED_PATH, PLAIN_PATH, CATALOG_PATH]), first);
				assert.isTrue(yield* fs.exists(CATALOG_PATH));
			}).pipe(Effect.provide(layers(first)));
		}),
	);

	it.effect("published + semantic + contract predecessor + onDrift error: drift, nextVersion, nothing written", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const predecessor = emitted(Wider, PINNED_ID);
			const report = yield* Runner.run(defineConfig({ schemas: [pinned()], catalog }), options("build"));
			const schema = byId(report, PINNED_ID);
			assert.strictEqual(schema.change, "contract");
			assert.strictEqual(schema.verdict, "drift");
			assert.strictEqual(schema.outcome, "drift");
			assert.strictEqual(schema.version, version("5.0.0"));
			assert.strictEqual(schema.nextVersion, version("5.1.0"), "a contract change bumps the minor");
			assert.isTrue(report.drifted);
			assert.isFalse(report.gateFailed);
			assert.isFalse(report.wrote);
			assert.deepStrictEqual(report.catalog, [{ name: "pinned", path: CATALOG_PATH, outcome: "held" }]);
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), predecessor, "the predecessor is left alone");
			assert.isFalse(yield* fs.exists(CATALOG_PATH), "the catalog is held with the schemas");
		}).pipe(Effect.provide(layers({ [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	it.effect("published + semantic + contract predecessor + onDrift warn: written, verdict stays drift", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(
				defineConfig({ schemas: [pinned()], catalog }),
				options("build", drift({ onDrift: "warn" })),
			);
			const schema = byId(report, PINNED_ID);
			assert.strictEqual(schema.change, "contract");
			assert.strictEqual(schema.verdict, "drift");
			assert.strictEqual(schema.outcome, "written");
			assert.strictEqual(schema.nextVersion, version("5.1.0"));
			assert.isTrue(report.drifted);
			assert.isTrue(report.wrote);
			assert.deepStrictEqual(report.catalog, [{ name: "pinned", path: CATALOG_PATH, outcome: "written" }]);
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), emitted(Config, PINNED_ID), "rewritten in place");
			assert.isTrue(yield* fs.exists(CATALOG_PATH));
		}).pipe(Effect.provide(layers({ [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	it.effect("published + policy allow (--force) + contract predecessor: write, not drift", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(
				defineConfig({ schemas: [pinned()], catalog }),
				options("build", drift({ policy: "allow", source: "flag" })),
			);
			const schema = byId(report, PINNED_ID);
			assert.strictEqual(schema.change, "contract");
			assert.strictEqual(schema.verdict, "write");
			assert.strictEqual(schema.outcome, "written");
			assert.strictEqual(schema.nextVersion, version("5.1.0"), "the bump is still reported for the reader");
			assert.strictEqual(report.drift.source, "flag");
			assert.isFalse(report.drifted);
			assert.isTrue(report.wrote);
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), emitted(Config, PINNED_ID));
		}).pipe(Effect.provide(layers({ [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	it.effect("unpublished + strict + contract predecessor: never drift, rewritten in place", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(
				defineConfig({ schemas: [pinned({ published: false })], catalog }),
				options("build", drift({ policy: "strict" })),
			);
			const schema = byId(report, PINNED_ID);
			assert.strictEqual(schema.published, false);
			assert.strictEqual(schema.change, "contract");
			assert.strictEqual(schema.verdict, "write");
			assert.strictEqual(schema.outcome, "written");
			assert.isFalse(report.drifted);
			assert.isTrue(report.wrote);
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), emitted(Config, PINNED_ID));
		}).pipe(Effect.provide(layers({ [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	it.effect("published + strict + annotations-only predecessor: drift", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const predecessor = emitted(Described, PINNED_ID);
			const report = yield* Runner.run(
				defineConfig({ schemas: [pinned({ schema: Redescribed })], catalog }),
				options("build", drift({ policy: "strict" })),
			);
			const schema = byId(report, PINNED_ID);
			assert.strictEqual(schema.change, "annotations");
			assert.strictEqual(schema.verdict, "drift");
			assert.strictEqual(schema.outcome, "drift");
			assert.isUndefined(schema.nextVersion, "an annotations change needs no bump");
			assert.isTrue(report.drifted);
			assert.isFalse(report.wrote);
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), predecessor);
		}).pipe(Effect.provide(layers({ [PINNED_PATH]: emitted(Described, PINNED_ID) }))),
	);

	// Gate failures are not drift and have no warn-and-write mode: even under
	// `onDrift: "warn"` nothing is written, and the clean schema in the same
	// run is held rather than written.
	it.effect("a gate failure holds every write, even under onDrift warn", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas, options("build", drift({ onDrift: "warn" })));
			const failing = byId(report, PINNED_ID);
			assert.strictEqual(failing.outcome, "gate-failed");
			assert.strictEqual(failing.findings.length, 1);
			assert.strictEqual(failing.findings[0]?.source, "validator");
			assert.strictEqual(failing.findings[0]?.check, "type");
			const clean = byId(report, PLAIN_ID);
			assert.strictEqual(clean.outcome, "held");
			assert.strictEqual(clean.verdict, "write");
			assert.deepStrictEqual(report.catalog, [{ name: "pinned", path: CATALOG_PATH, outcome: "held" }]);
			assert.isTrue(report.gateFailed);
			assert.isFalse(report.drifted);
			assert.isFalse(report.wrote);
			assert.isFalse(yield* fs.exists(PINNED_PATH));
			assert.isFalse(yield* fs.exists(PLAIN_PATH));
			assert.isFalse(yield* fs.exists(CATALOG_PATH));
		}).pipe(
			Effect.provide(
				layers(
					{},
					SchemaValidator.layerTest({
						validate: (document) =>
							Effect.succeed(
								document.$id === PINNED_ID
									? [ValidationFinding.make({ path: "/type", message: "rejected", keyword: "type" })]
									: [],
							),
					}),
				),
			),
		),
	);

	// `check` reports what `build` would do: a build holds the clean sibling
	// of a gate failure, so `check` reports `held` for it too — never
	// `would-write`, which a build would not honour.
	it.effect("in check mode a gate failure reports gate-failed and holds the clean schema and the catalog", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas, options("check"));
			assert.strictEqual(byId(report, PINNED_ID).outcome, "gate-failed");
			assert.strictEqual(byId(report, PLAIN_ID).outcome, "held", "check holds what build would hold");
			assert.deepStrictEqual(report.catalog, [{ name: "pinned", path: CATALOG_PATH, outcome: "held" }]);
			assert.isTrue(report.gateFailed);
			assert.isFalse(report.wrote);
			assert.isFalse(yield* fs.exists(PLAIN_PATH), "check never writes");
			assert.isFalse(yield* fs.exists(CATALOG_PATH), "check never writes");
		}).pipe(
			Effect.provide(
				layers(
					{},
					SchemaValidator.layerTest({
						validate: (document) =>
							Effect.succeed(document.$id === PINNED_ID ? [ValidationFinding.make({ path: "", message: "boom" })] : []),
					}),
				),
			),
		),
	);

	it.effect("one drifting schema under onDrift error holds the clean one too", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas, options("build"));
			const drifting = byId(report, PINNED_ID);
			assert.strictEqual(drifting.outcome, "drift");
			assert.strictEqual(drifting.verdict, "drift");
			const clean = byId(report, PLAIN_ID);
			assert.strictEqual(clean.change, "created");
			assert.strictEqual(clean.verdict, "write");
			assert.strictEqual(clean.outcome, "held");
			assert.isTrue(report.drifted);
			assert.isFalse(report.gateFailed);
			assert.isFalse(report.wrote);
			assert.isFalse(yield* fs.exists(PLAIN_PATH), "the clean schema is held, not written");
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), emitted(Wider, PINNED_ID));
		}).pipe(Effect.provide(layers({ [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	it.effect("in check mode one drifting schema under onDrift error holds the clean one and the catalog", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas, options("check"));
			assert.strictEqual(byId(report, PINNED_ID).outcome, "drift");
			const clean = byId(report, PLAIN_ID);
			assert.strictEqual(clean.verdict, "write");
			assert.strictEqual(clean.outcome, "held", "check holds what build would hold");
			assert.deepStrictEqual(report.catalog, [{ name: "pinned", path: CATALOG_PATH, outcome: "held" }]);
			assert.isTrue(report.drifted);
			assert.isFalse(report.wrote);
			assert.isFalse(yield* fs.exists(PLAIN_PATH), "check never writes");
			assert.isFalse(yield* fs.exists(CATALOG_PATH), "check never writes");
		}).pipe(Effect.provide(layers({ [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	// The contrast: under `onDrift: "warn"` a build is not refused, so
	// `check` reports `would-write` for the clean sibling and the catalog.
	it.effect("in check mode one drifting schema under onDrift warn leaves the clean one would-write", () =>
		Effect.gen(function* () {
			const report = yield* Runner.run(twoSchemas, options("check", drift({ onDrift: "warn" })));
			assert.strictEqual(byId(report, PINNED_ID).outcome, "drift");
			assert.strictEqual(byId(report, PLAIN_ID).outcome, "would-write");
			assert.deepStrictEqual(report.catalog, [{ name: "pinned", path: CATALOG_PATH, outcome: "would-write" }]);
			assert.isFalse(report.wrote);
		}).pipe(Effect.provide(layers({ [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	it.effect("a catalog file that does not parse is repaired by a build", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas, options("build"));
			assert.deepStrictEqual(report.catalog, [{ name: "pinned", path: CATALOG_PATH, outcome: "written" }]);
			const entry = Schema.decodeUnknownSync(CatalogEntry)(JSON.parse(yield* fs.readFileString(CATALOG_PATH)));
			assert.strictEqual(entry.name, "pinned");
		}).pipe(Effect.provide(layers({ [CATALOG_PATH]: "{ not json" }))),
	);

	it.effect("a stale but parseable catalog entry would-write under check and is left alone", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const stale = `${JSON.stringify({ name: "pinned", description: "old", fileMatch: [], url: "https://old" })}\n`;
			const report = yield* Runner.run(twoSchemas, options("check"));
			assert.deepStrictEqual(report.catalog, [{ name: "pinned", path: CATALOG_PATH, outcome: "would-write" }]);
			assert.isFalse(report.wrote);
			assert.strictEqual(yield* fs.readFileString(CATALOG_PATH), stale);
		}).pipe(
			Effect.provide(
				layers({
					[CATALOG_PATH]: `${JSON.stringify({ name: "pinned", description: "old", fileMatch: [], url: "https://old" })}\n`,
				}),
			),
		),
	);

	it.effect("a catalog file that another tool reformatted is unchanged by content", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const reformatted = compactCatalogText();
			const report = yield* Runner.run(twoSchemas, options("build"));
			assert.deepStrictEqual(report.catalog, [{ name: "pinned", path: CATALOG_PATH, outcome: "unchanged" }]);
			assert.strictEqual(yield* fs.readFileString(CATALOG_PATH), reformatted, "the compact text is left alone");
		}).pipe(Effect.provide(layers({ [CATALOG_PATH]: compactCatalogText() }))),
	);
});
