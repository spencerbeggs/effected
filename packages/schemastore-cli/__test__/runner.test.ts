import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { DriftTolerance } from "@effected/schemastore";
import {
	CatalogEntry,
	SchemaFile,
	SchemaValidator,
	SchemaVersioning,
	StoreDocument,
	ValidationFinding,
	defineConfig,
} from "@effected/schemastore";
import { Effect, FileSystem, Layer, Path, Result, Schema } from "effect";
import { AjvValidator } from "../src/AjvValidator.js";
import type { RunOptions, RunReport } from "../src/Runner.js";
import { FrozenVersionIdMismatchError, FrozenVersionMissingError, Runner } from "../src/Runner.js";

// ── Layers ────────────────────────────────────────────────────────────────
//
// `SchemaFile` is built over the memfs + Path base, and that same base is
// merged INTO the output (`provideMerge`, not `provide`) because the Runner
// reads `FileSystem` / `Path` directly for the catalog file and the tests
// read the volume back afterwards. Every `Effect.provide` of a memfs layer
// builds a fresh volume, so each test resolves the file system inside the
// one program it provides.
const layers = (seed: MemoryFileSystemSeed = {}, validator: Layer.Layer<SchemaValidator> = AjvValidator.layer) =>
	Layer.mergeAll(SchemaFile.layer, validator).pipe(
		Layer.provideMerge(Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer)),
	);

// ── Fixtures ──────────────────────────────────────────────────────────────

const version = (label: string) => Result.getOrThrow(SchemaVersioning.parseResult(label));

const emitted = (schema: Schema.Constraint, $id: string): string =>
	Result.getOrThrow(Result.getOrThrow(StoreDocument.fromSchemaResult(schema, { $id })).serializeResult());

const Config = Schema.Struct({ name: Schema.String });
// The predecessor's `required` carries an extra member, so a successor
// generated from `Config` reads as a CONTRACT change.
const Wider = Schema.Struct({ name: Schema.String, extra: Schema.String });
// Same contract, different prose: an ANNOTATIONS change.
const Described = Config.annotate({ description: "Before\nhttps://example.com/docs" });
const Redescribed = Config.annotate({ description: "After\nhttps://example.com/docs" });

const BASE = "https://example.com/schemas";
const PINNED_ID = `${BASE}/5.0.0/pinned-5.0.0.json`;
const PINNED_PATH = "/repo/schemas/5.0.0/pinned-5.0.0.json";
const FROZEN_PATH = "/repo/schemas/4.0.0/pinned-4.0.0.json";
const PLAIN_ID = `${BASE}/plain.json`;
const PLAIN_PATH = "/repo/schemas/plain.json";
const CATALOG_PATH = "/repo/schemas/catalog.json";

const twoSchemas = (
	options: { readonly schema?: Schema.Constraint; readonly published?: boolean; readonly drift?: DriftTolerance } = {},
) =>
	defineConfig({
		outputDir: "/repo/schemas",
		baseUrl: BASE,
		schemas: {
			pinned: {
				schema: options.schema ?? Config,
				versions: ["4.0.0", "5.0.0"],
				published: options.published ?? true,
				catalog: { description: "Pinned configuration", fileMatch: ["pinned.json"] },
				...(options.drift !== undefined ? { drift: options.drift } : {}),
			},
			plain: { schema: Config },
		},
	});

const options = (mode: RunOptions["mode"], overrides: Partial<RunOptions> = {}): RunOptions => ({
	mode,
	configPath: "/repo/schemastore.config.ts",
	onDrift: "error",
	...overrides,
});

// Every seed carries the frozen 4.0.0 file: the runner refuses to advertise a 404.
const frozenSeed: MemoryFileSystemSeed = { [FROZEN_PATH]: emitted(Config, `${BASE}/4.0.0/pinned-4.0.0.json`) };

// The catalog entry `defineConfig` assembled, as another tool would have
// written it: compact, one line, key order preserved.
const compactCatalogText = (): string => {
	const catalog = twoSchemas().schemas[0]?.catalog;
	assert.isDefined(catalog);
	return `${JSON.stringify([Schema.encodeSync(CatalogEntry)(catalog)])}\n`;
};

// Same content, keys reversed and pretty-printed with a two-space indent —
// a shape only a structural (`CanonicalJson.equals`) compare tolerates; a
// byte or insertion-order-sensitive compare would not.
const reorderedCatalogText = (): string => {
	const catalog = twoSchemas().schemas[0]?.catalog;
	assert.isDefined(catalog);
	const encoded = Schema.encodeSync(CatalogEntry)(catalog) as Record<string, unknown>;
	const reordered = Object.fromEntries(Object.entries(encoded).reverse());
	return `${JSON.stringify([reordered], null, 2)}\n`;
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
			const report = yield* Runner.run(twoSchemas(), options("check"));
			assert.strictEqual(report.mode, "check");
			assert.strictEqual(report.configPath, "/repo/schemastore.config.ts");
			assert.strictEqual(report.onDrift, "error");
			assert.isUndefined(report.policy);
			assert.strictEqual(report.schemas.length, 2);
			for (const schema of report.schemas) {
				assert.strictEqual(schema.change, "created");
				assert.strictEqual(schema.verdict, "write");
				assert.strictEqual(schema.outcome, "would-write");
				assert.strictEqual(schema.policy, "semantic");
			}
			assert.strictEqual(byId(report, PINNED_ID).name, "pinned");
			assert.strictEqual(byId(report, PINNED_ID).published, true);
			assert.strictEqual(byId(report, PLAIN_ID).published, false);
			assert.isUndefined(byId(report, PINNED_ID).nextVersion, "a created document needs no bump");
			assert.deepStrictEqual(byId(report, PINNED_ID).frozen, [version("4.0.0")]);
			assert.deepStrictEqual(byId(report, PLAIN_ID).frozen, []);
			assert.deepStrictEqual(report.catalog, { path: CATALOG_PATH, entries: 1, outcome: "would-write" });
			assert.isFalse(report.drifted);
			assert.isFalse(report.gateFailed);
			assert.isFalse(report.wrote);
			assert.isFalse(yield* fs.exists(PINNED_PATH));
			assert.isFalse(yield* fs.exists(PLAIN_PATH));
			assert.isFalse(yield* fs.exists(CATALOG_PATH));
		}).pipe(Effect.provide(layers(frozenSeed))),
	);

	it.effect("build on a fresh volume writes every schema and the catalog entry", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas(), options("build"));
			assert.strictEqual(report.mode, "build");
			for (const schema of report.schemas) {
				assert.strictEqual(schema.change, "created");
				assert.strictEqual(schema.outcome, "written");
			}
			assert.deepStrictEqual(report.catalog, { path: CATALOG_PATH, entries: 1, outcome: "written" });
			assert.isTrue(report.wrote);
			assert.isFalse(report.drifted);
			assert.isFalse(report.gateFailed);
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), emitted(Config, PINNED_ID));
			assert.strictEqual(yield* fs.readFileString(PLAIN_PATH), emitted(Config, PLAIN_ID));
			const parsed = JSON.parse(yield* fs.readFileString(CATALOG_PATH)) as ReadonlyArray<unknown>;
			assert.strictEqual(parsed.length, 1);
			const entry = Schema.decodeUnknownSync(CatalogEntry)(parsed[0]);
			assert.strictEqual(entry.name, "pinned");
			assert.strictEqual(entry.url, PINNED_ID);
			assert.deepStrictEqual(entry.versions, {
				"4.0.0": `${BASE}/4.0.0/pinned-4.0.0.json`,
				"5.0.0": PINNED_ID,
			});
		}).pipe(Effect.provide(layers(frozenSeed))),
	);

	it.effect("build again over the first run's output changes nothing", () =>
		Effect.gen(function* () {
			// First run, on its own fresh volume: capture what it wrote.
			const first = yield* Effect.gen(function* () {
				yield* Runner.run(twoSchemas(), options("build"));
				return yield* readAll([PINNED_PATH, PLAIN_PATH, CATALOG_PATH]);
			}).pipe(Effect.provide(layers(frozenSeed)));

			// Second run, seeded with the first run's texts plus the frozen file.
			yield* Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const report = yield* Runner.run(twoSchemas(), options("build"));
				for (const schema of report.schemas) {
					assert.strictEqual(schema.change, "none");
					assert.strictEqual(schema.verdict, "write");
					assert.strictEqual(schema.outcome, "unchanged");
				}
				assert.deepStrictEqual(report.catalog, { path: CATALOG_PATH, entries: 1, outcome: "unchanged" });
				assert.isFalse(report.wrote);
				assert.isFalse(report.drifted);
				assert.deepStrictEqual(yield* readAll([PINNED_PATH, PLAIN_PATH, CATALOG_PATH]), first);
				assert.isTrue(yield* fs.exists(CATALOG_PATH));
			}).pipe(Effect.provide(layers({ ...frozenSeed, ...first })));
		}),
	);

	it.effect("published + semantic + contract predecessor + onDrift error: drift, nextVersion, nothing written", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const predecessor = emitted(Wider, PINNED_ID);
			const report = yield* Runner.run(twoSchemas(), options("build"));
			const schema = byId(report, PINNED_ID);
			assert.strictEqual(schema.change, "contract");
			assert.strictEqual(schema.verdict, "drift");
			assert.strictEqual(schema.outcome, "drift");
			assert.strictEqual(schema.version, version("5.0.0"));
			assert.strictEqual(schema.nextVersion, version("5.1.0"), "a contract change bumps the minor");
			assert.isTrue(report.drifted);
			assert.isFalse(report.gateFailed);
			assert.isFalse(report.wrote);
			assert.deepStrictEqual(report.catalog, { path: CATALOG_PATH, entries: 1, outcome: "held" });
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), predecessor, "the predecessor is left alone");
			assert.isFalse(yield* fs.exists(CATALOG_PATH), "the catalog is held with the schemas");
		}).pipe(Effect.provide(layers({ ...frozenSeed, [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	it.effect("a prerelease published contract change carries no nextVersion", () => {
		const PRE_ID = `${BASE}/2.0.0-beta.1/pre-2.0.0-beta.1.json`;
		const PRE_PATH = "/repo/schemas/2.0.0-beta.1/pre-2.0.0-beta.1.json";
		const predecessor = emitted(Wider, PRE_ID);
		const config = defineConfig({
			outputDir: "/repo/schemas",
			baseUrl: BASE,
			schemas: { pre: { schema: Config, versions: ["2.0.0-beta.1"], published: true } },
		});
		return Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(config, options("build"));
			const schema = byId(report, PRE_ID);
			assert.strictEqual(schema.change, "contract");
			assert.strictEqual(schema.verdict, "drift");
			assert.isUndefined(schema.nextVersion, "a prerelease declares its own instability; nothing to suggest");
			assert.strictEqual(yield* fs.readFileString(PRE_PATH), predecessor, "the predecessor is left alone");
		}).pipe(Effect.provide(layers({ [PRE_PATH]: predecessor })));
	});

	it.effect("published + semantic + contract predecessor + onDrift warn: written, verdict stays drift", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas(), options("build", { onDrift: "warn" }));
			const schema = byId(report, PINNED_ID);
			assert.strictEqual(schema.change, "contract");
			assert.strictEqual(schema.verdict, "drift");
			assert.strictEqual(schema.outcome, "written");
			assert.strictEqual(schema.nextVersion, version("5.1.0"));
			assert.isTrue(report.drifted);
			assert.isTrue(report.wrote);
			assert.deepStrictEqual(report.catalog, { path: CATALOG_PATH, entries: 1, outcome: "written" });
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), emitted(Config, PINNED_ID), "rewritten in place");
			assert.isTrue(yield* fs.exists(CATALOG_PATH));
		}).pipe(Effect.provide(layers({ ...frozenSeed, [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	it.effect("published + policy allow (--force) + contract predecessor: write, not drift", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas(), options("build", { policy: "allow" }));
			const schema = byId(report, PINNED_ID);
			assert.strictEqual(schema.change, "contract");
			assert.strictEqual(schema.verdict, "write");
			assert.strictEqual(schema.policy, "allow");
			assert.strictEqual(schema.outcome, "written");
			assert.strictEqual(schema.nextVersion, version("5.1.0"), "the bump is still reported for the reader");
			assert.strictEqual(report.policy, "allow");
			assert.isFalse(report.drifted);
			assert.isTrue(report.wrote);
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), emitted(Config, PINNED_ID));
		}).pipe(Effect.provide(layers({ ...frozenSeed, [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	it.effect("unpublished + strict + contract predecessor: never drift, rewritten in place", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas({ published: false, drift: "strict" }), options("build"));
			const schema = byId(report, PINNED_ID);
			assert.strictEqual(schema.published, false);
			assert.strictEqual(schema.change, "contract");
			assert.strictEqual(schema.verdict, "write");
			assert.strictEqual(schema.policy, "strict");
			assert.strictEqual(schema.outcome, "written");
			assert.isFalse(report.drifted);
			assert.isTrue(report.wrote);
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), emitted(Config, PINNED_ID));
		}).pipe(Effect.provide(layers({ ...frozenSeed, [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	it.effect("published + strict + annotations-only predecessor: drift", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const predecessor = emitted(Described, PINNED_ID);
			const report = yield* Runner.run(twoSchemas({ schema: Redescribed, drift: "strict" }), options("build"));
			const schema = byId(report, PINNED_ID);
			assert.strictEqual(schema.change, "annotations");
			assert.strictEqual(schema.verdict, "drift");
			assert.strictEqual(schema.outcome, "drift");
			assert.isUndefined(schema.nextVersion, "an annotations change needs no bump");
			assert.isTrue(report.drifted);
			assert.isFalse(report.wrote);
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), predecessor);
		}).pipe(Effect.provide(layers({ ...frozenSeed, [PINNED_PATH]: emitted(Described, PINNED_ID) }))),
	);

	// Gate failures are not drift and have no warn-and-write mode: even under
	// `onDrift: "warn"` nothing is written, and the clean schema in the same
	// run is held rather than written.
	it.effect("a gate failure holds every write, even under onDrift warn", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas(), options("build", { onDrift: "warn" }));
			const failing = byId(report, PINNED_ID);
			assert.strictEqual(failing.outcome, "gate-failed");
			assert.strictEqual(failing.findings.length, 1);
			assert.strictEqual(failing.findings[0]?.source, "validator");
			assert.strictEqual(failing.findings[0]?.check, "type");
			const clean = byId(report, PLAIN_ID);
			assert.strictEqual(clean.outcome, "held");
			assert.strictEqual(clean.verdict, "write");
			assert.deepStrictEqual(report.catalog, { path: CATALOG_PATH, entries: 1, outcome: "held" });
			assert.isTrue(report.gateFailed);
			assert.isFalse(report.drifted);
			assert.isFalse(report.wrote);
			assert.isFalse(yield* fs.exists(PINNED_PATH));
			assert.isFalse(yield* fs.exists(PLAIN_PATH));
			assert.isFalse(yield* fs.exists(CATALOG_PATH));
		}).pipe(
			Effect.provide(
				layers(
					frozenSeed,
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
			const report = yield* Runner.run(twoSchemas(), options("check"));
			assert.strictEqual(byId(report, PINNED_ID).outcome, "gate-failed");
			assert.strictEqual(byId(report, PLAIN_ID).outcome, "held", "check holds what build would hold");
			assert.deepStrictEqual(report.catalog, { path: CATALOG_PATH, entries: 1, outcome: "held" });
			assert.isTrue(report.gateFailed);
			assert.isFalse(report.wrote);
			assert.isFalse(yield* fs.exists(PLAIN_PATH), "check never writes");
			assert.isFalse(yield* fs.exists(CATALOG_PATH), "check never writes");
		}).pipe(
			Effect.provide(
				layers(
					frozenSeed,
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
			const report = yield* Runner.run(twoSchemas(), options("build"));
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
		}).pipe(Effect.provide(layers({ ...frozenSeed, [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	it.effect("in check mode one drifting schema under onDrift error holds the clean one and the catalog", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas(), options("check"));
			assert.strictEqual(byId(report, PINNED_ID).outcome, "drift");
			const clean = byId(report, PLAIN_ID);
			assert.strictEqual(clean.verdict, "write");
			assert.strictEqual(clean.outcome, "held", "check holds what build would hold");
			assert.deepStrictEqual(report.catalog, { path: CATALOG_PATH, entries: 1, outcome: "held" });
			assert.isTrue(report.drifted);
			assert.isFalse(report.wrote);
			assert.isFalse(yield* fs.exists(PLAIN_PATH), "check never writes");
			assert.isFalse(yield* fs.exists(CATALOG_PATH), "check never writes");
		}).pipe(Effect.provide(layers({ ...frozenSeed, [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	// The contrast: under `onDrift: "warn"` a build is not refused, so
	// `check` reports `would-write` for the clean sibling and the catalog.
	it.effect("in check mode one drifting schema under onDrift warn leaves the clean one would-write", () =>
		Effect.gen(function* () {
			const report = yield* Runner.run(twoSchemas(), options("check", { onDrift: "warn" }));
			assert.strictEqual(byId(report, PINNED_ID).outcome, "drift");
			assert.strictEqual(byId(report, PLAIN_ID).outcome, "would-write");
			assert.deepStrictEqual(report.catalog, { path: CATALOG_PATH, entries: 1, outcome: "would-write" });
			assert.isFalse(report.wrote);
		}).pipe(Effect.provide(layers({ ...frozenSeed, [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	it.effect("a catalog file that does not parse is repaired by a build", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas(), options("build"));
			assert.deepStrictEqual(report.catalog, { path: CATALOG_PATH, entries: 1, outcome: "written" });
			const parsed = JSON.parse(yield* fs.readFileString(CATALOG_PATH)) as ReadonlyArray<unknown>;
			const entry = Schema.decodeUnknownSync(CatalogEntry)(parsed[0]);
			assert.strictEqual(entry.name, "pinned");
		}).pipe(Effect.provide(layers({ ...frozenSeed, [CATALOG_PATH]: "{ not json" }))),
	);

	it.effect("a stale but parseable catalog entry would-write under check and is left alone", () => {
		const stale = `${JSON.stringify([{ name: "pinned", description: "old", fileMatch: [], url: "https://old" }])}\n`;
		return Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas(), options("check"));
			assert.deepStrictEqual(report.catalog, { path: CATALOG_PATH, entries: 1, outcome: "would-write" });
			assert.isFalse(report.wrote);
			assert.strictEqual(yield* fs.readFileString(CATALOG_PATH), stale);
		}).pipe(Effect.provide(layers({ ...frozenSeed, [CATALOG_PATH]: stale })));
	});

	it.effect("a catalog file with reordered keys and different indentation is unchanged by content", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const reformatted = reorderedCatalogText();
			const report = yield* Runner.run(twoSchemas(), options("build"));
			assert.deepStrictEqual(report.catalog, { path: CATALOG_PATH, entries: 1, outcome: "unchanged" });
			assert.strictEqual(yield* fs.readFileString(CATALOG_PATH), reformatted, "the reformatted text is left alone");
		}).pipe(Effect.provide(layers({ ...frozenSeed, [CATALOG_PATH]: reorderedCatalogText() }))),
	);

	it.effect("a catalog file that another tool reformatted is unchanged by content", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const reformatted = compactCatalogText();
			const report = yield* Runner.run(twoSchemas(), options("build"));
			assert.deepStrictEqual(report.catalog, { path: CATALOG_PATH, entries: 1, outcome: "unchanged" });
			assert.strictEqual(yield* fs.readFileString(CATALOG_PATH), reformatted, "the compact text is left alone");
		}).pipe(Effect.provide(layers({ ...frozenSeed, [CATALOG_PATH]: compactCatalogText() }))),
	);

	it.effect("fails typed before any write when a frozen version is missing on disk", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Runner.run(twoSchemas(), options("build")));
			assert.instanceOf(error, FrozenVersionMissingError);
			assert.deepStrictEqual(error.missing, [{ name: "pinned", version: "4.0.0", path: FROZEN_PATH }]);
			const fs = yield* FileSystem.FileSystem;
			assert.isFalse(yield* fs.exists(PINNED_PATH));
			assert.isFalse(yield* fs.exists(CATALOG_PATH));
		}).pipe(Effect.provide(layers({}))),
	);

	it.effect("fails typed when a frozen path is a directory, not a file", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Runner.run(twoSchemas(), options("build")));
			assert.instanceOf(error, FrozenVersionMissingError);
			assert.deepStrictEqual(error.missing, [{ name: "pinned", version: "4.0.0", path: FROZEN_PATH }]);
		}).pipe(Effect.provide(layers({ [`${FROZEN_PATH}/x`]: "" }))),
	);

	// #742 — a frozen file is the one document the derivation does not own,
	// so it is the one place its `$id` can disagree with the URL the catalog
	// advertises: the pre-flight reads it and refuses on a mismatch.
	it.effect("fails typed before any write when a frozen file's $id differs from its derived URL", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Runner.run(twoSchemas(), options("build")));
			assert.instanceOf(error, FrozenVersionIdMismatchError);
			assert.deepStrictEqual(error.mismatched, [
				{
					name: "pinned",
					version: "4.0.0",
					path: FROZEN_PATH,
					expected: `${BASE}/4.0.0/pinned-4.0.0.json`,
					actual: "https://old.example.com/schemas/4.0.0/pinned-4.0.0.json",
					reason: "mismatch",
				},
			]);
			const fs = yield* FileSystem.FileSystem;
			assert.isFalse(yield* fs.exists(PINNED_PATH));
			assert.isFalse(yield* fs.exists(CATALOG_PATH));
		}).pipe(
			Effect.provide(
				layers({ [FROZEN_PATH]: emitted(Config, "https://old.example.com/schemas/4.0.0/pinned-4.0.0.json") }),
			),
		),
	);

	it.effect("a frozen file with no $id, or one that does not parse, is a mismatch with its own reason", () =>
		Effect.gen(function* () {
			const config = defineConfig({
				outputDir: "/repo/schemas",
				baseUrl: BASE,
				schemas: { pinned: { schema: Config, versions: ["3.0.0", "4.0.0", "5.0.0"], published: true } },
			});
			const error = yield* Effect.flip(Runner.run(config, options("check")));
			assert.instanceOf(error, FrozenVersionIdMismatchError);
			assert.deepStrictEqual(
				error.mismatched.map((entry) => [entry.version, entry.reason, entry.actual]),
				[
					["3.0.0", "unparseable", undefined],
					["4.0.0", "absent", undefined],
				],
			);
		}).pipe(
			Effect.provide(
				layers({
					"/repo/schemas/3.0.0/pinned-3.0.0.json": "{ not json",
					[FROZEN_PATH]: '{\n\t"type": "object"\n}\n',
				}),
			),
		),
	);

	it.effect("a missing frozen file is reported as missing, never as an $id mismatch", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Runner.run(twoSchemas(), options("build")));
			assert.instanceOf(error, FrozenVersionMissingError);
		}).pipe(Effect.provide(layers({}))),
	);

	// #743 — removing the last catalog block must not leave a stale
	// catalog.json invisible to check: it is reported as orphaned, never
	// deleted (the CLI may not have written it).
	it.effect("an orphaned catalog file is reported when no schema declares a catalog", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const config = defineConfig({
				outputDir: "/repo/schemas",
				baseUrl: BASE,
				schemas: { plain: { schema: Config } },
			});
			const checked = yield* Runner.run(config, options("check"));
			assert.deepStrictEqual(checked.catalog, { path: CATALOG_PATH, entries: 0, outcome: "orphaned" });
			const built = yield* Runner.run(config, options("build"));
			assert.deepStrictEqual(built.catalog, { path: CATALOG_PATH, entries: 0, outcome: "orphaned" });
			assert.strictEqual(yield* fs.readFileString(CATALOG_PATH), "[]\n", "the orphan is left for the user to delete");
		}).pipe(Effect.provide(layers({ [CATALOG_PATH]: "[]\n" }))),
	);

	it.effect("no catalog block and no catalog file reports no catalog at all", () =>
		Effect.gen(function* () {
			const config = defineConfig({
				outputDir: "/repo/schemas",
				baseUrl: BASE,
				schemas: { plain: { schema: Config } },
			});
			const report = yield* Runner.run(config, options("check"));
			assert.isUndefined(report.catalog);
		}).pipe(Effect.provide(layers({}))),
	);

	it.effect("reports every missing frozen version, not just the first", () =>
		Effect.gen(function* () {
			const config = defineConfig({
				outputDir: "/repo/schemas",
				baseUrl: BASE,
				schemas: {
					pinned: {
						schema: Config,
						versions: ["3.0.0", "4.0.0", "5.0.0"],
						published: true,
					},
				},
			});
			const error = yield* Effect.flip(Runner.run(config, options("build")));
			assert.instanceOf(error, FrozenVersionMissingError);
			assert.deepStrictEqual(error.missing, [
				{ name: "pinned", version: "3.0.0", path: "/repo/schemas/3.0.0/pinned-3.0.0.json" },
				{ name: "pinned", version: "4.0.0", path: "/repo/schemas/4.0.0/pinned-4.0.0.json" },
			]);
			const fs = yield* FileSystem.FileSystem;
			assert.isFalse(yield* fs.exists(PINNED_PATH));
			assert.isFalse(yield* fs.exists(CATALOG_PATH));
		}).pipe(Effect.provide(layers({}))),
	);

	it.effect("classifies each schema under its own drift tolerance unless a flag forces one", () =>
		Effect.gen(function* () {
			const seed = { ...frozenSeed, [PINNED_PATH]: emitted(Wider, PINNED_ID) };
			const own = yield* Runner.run(twoSchemas({ drift: "allow" }), options("check")).pipe(
				Effect.provide(layers(seed)),
			);
			assert.strictEqual(own.schemas[0]?.verdict, "write");
			assert.strictEqual(own.schemas[0]?.policy, "allow");
			assert.strictEqual(own.schemas[1]?.policy, "semantic");
			const forced = yield* Runner.run(twoSchemas({ drift: "allow" }), options("check", { policy: "strict" })).pipe(
				Effect.provide(layers(seed)),
			);
			assert.strictEqual(forced.schemas[0]?.verdict, "drift");
			assert.strictEqual(forced.schemas[0]?.policy, "strict");
		}),
	);

	it.effect("writes one catalog.json holding every entry, and none when no schema opts in", () =>
		Effect.gen(function* () {
			const report = yield* Runner.run(twoSchemas(), options("build"));
			assert.deepStrictEqual(report.catalog, { path: CATALOG_PATH, entries: 1, outcome: "written" });
			const fs = yield* FileSystem.FileSystem;
			const parsed = JSON.parse(yield* fs.readFileString(CATALOG_PATH)) as ReadonlyArray<{ name: string; url: string }>;
			assert.strictEqual(parsed.length, 1);
			assert.strictEqual(parsed[0]?.url, PINNED_ID);
			assert.deepStrictEqual(report.schemas[0]?.frozen, [version("4.0.0")]);
		}).pipe(Effect.provide(layers(frozenSeed))),
	);

	it.effect("wrote is true for a catalog-only write, with every schema unchanged", () =>
		Effect.gen(function* () {
			const report = yield* Runner.run(twoSchemas(), options("build"));
			for (const schema of report.schemas) {
				assert.strictEqual(schema.outcome, "unchanged");
			}
			assert.strictEqual(report.catalog?.outcome, "written");
			assert.isTrue(report.wrote);
		}).pipe(
			Effect.provide(
				layers({
					...frozenSeed,
					[PINNED_PATH]: emitted(Config, PINNED_ID),
					[PLAIN_PATH]: emitted(Config, PLAIN_ID),
					[CATALOG_PATH]: "[]\n",
				}),
			),
		),
	);

	it.effect("omits the catalog report when no schema declares one", () =>
		Effect.gen(function* () {
			const config = defineConfig({
				outputDir: "/repo/schemas",
				baseUrl: BASE,
				schemas: { plain: { schema: Config } },
			});
			const report = yield* Runner.run(config, options("build"));
			assert.isUndefined(report.catalog);
			const fs = yield* FileSystem.FileSystem;
			assert.isFalse(yield* fs.exists(CATALOG_PATH));
		}).pipe(Effect.provide(layers({}))),
	);
});
