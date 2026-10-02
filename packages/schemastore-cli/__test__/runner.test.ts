import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemFaults, MemoryFileSystemSeed } from "@effected/memfs";
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
import { Effect, FileSystem, Layer, Path, PlatformError, Result, Schema } from "effect";
import { AjvValidator } from "../src/AjvValidator.js";
import type { CatalogReport, MergedCatalogReport, RunOptions, RunReport } from "../src/Runner.js";
import { CatalogDirError, FrozenVersionIdMismatchError, FrozenVersionMissingError, Runner } from "../src/Runner.js";

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

// The same stack over a volume whose listed methods are fault-injected.
const faultyLayers = (seed: MemoryFileSystemSeed, faults: MemoryFileSystemFaults) =>
	Layer.mergeAll(SchemaFile.layer, AjvValidator.layer).pipe(
		Layer.provideMerge(Layer.mergeAll(MemoryFileSystem.layerWith(seed, { faults: faults }), Path.layer)),
	);

const platformFailure = (tag: "NotFound" | "PermissionDenied", method: string, path: string) =>
	PlatformError.systemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: path });

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
// The config's own catalog slice, and the merged catalog every config
// sharing `catalogDir` maintains beside it. With one config the two hold
// the same entries.
const SLICE_PATH = "/repo/schemas/catalogs/test.json";
const MERGED_PATH = "/repo/schemas/catalog.json";
const CATALOG_PATHS = [SLICE_PATH, MERGED_PATH] as const;

// Both catalog files seeded with one text.
const catalogSeed = (text: string): MemoryFileSystemSeed => ({ [SLICE_PATH]: text, [MERGED_PATH]: text });

// The one-config catalog report: the slice and the merged file agree on
// entry count and outcome, and the merge reads only this config's slice.
const assertCatalog = (report: RunReport, outcome: "written" | "unchanged" | "would-write" | "held", entries = 1) =>
	assert.deepStrictEqual(report.catalog, {
		slice: { path: SLICE_PATH, entries, outcome },
		merged: { path: MERGED_PATH, entries, outcome, slices: [SLICE_PATH], conflicts: [], invalid: [] },
	});

const twoSchemas = (
	options: { readonly schema?: Schema.Constraint; readonly published?: boolean; readonly drift?: DriftTolerance } = {},
) =>
	defineConfig({
		name: "test",
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
			assertCatalog(report, "would-write");
			assert.isFalse(report.drifted);
			assert.isFalse(report.gateFailed);
			assert.isFalse(report.wrote);
			assert.isFalse(yield* fs.exists(PINNED_PATH));
			assert.isFalse(yield* fs.exists(PLAIN_PATH));
			assert.isFalse((yield* fs.exists(SLICE_PATH)) || (yield* fs.exists(MERGED_PATH)));
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
			assertCatalog(report, "written");
			assert.isTrue(report.wrote);
			assert.isFalse(report.drifted);
			assert.isFalse(report.gateFailed);
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), emitted(Config, PINNED_ID));
			assert.strictEqual(yield* fs.readFileString(PLAIN_PATH), emitted(Config, PLAIN_ID));
			const parsed = JSON.parse(yield* fs.readFileString(MERGED_PATH)) as ReadonlyArray<unknown>;
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
				return yield* readAll([PINNED_PATH, PLAIN_PATH, ...CATALOG_PATHS]);
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
				assertCatalog(report, "unchanged");
				assert.isFalse(report.wrote);
				assert.isFalse(report.drifted);
				assert.deepStrictEqual(yield* readAll([PINNED_PATH, PLAIN_PATH, ...CATALOG_PATHS]), first);
				assert.isTrue((yield* fs.exists(SLICE_PATH)) && (yield* fs.exists(MERGED_PATH)));
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
			assertCatalog(report, "held");
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), predecessor, "the predecessor is left alone");
			assert.isFalse(
				(yield* fs.exists(SLICE_PATH)) || (yield* fs.exists(MERGED_PATH)),
				"the catalog is held with the schemas",
			);
		}).pipe(Effect.provide(layers({ ...frozenSeed, [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	it.effect("a prerelease published contract change carries no nextVersion", () => {
		const PRE_ID = `${BASE}/2.0.0-beta.1/pre-2.0.0-beta.1.json`;
		const PRE_PATH = "/repo/schemas/2.0.0-beta.1/pre-2.0.0-beta.1.json";
		const predecessor = emitted(Wider, PRE_ID);
		const config = defineConfig({
			name: "test",
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
			assertCatalog(report, "written");
			assert.strictEqual(yield* fs.readFileString(PINNED_PATH), emitted(Config, PINNED_ID), "rewritten in place");
			assert.isTrue((yield* fs.exists(SLICE_PATH)) && (yield* fs.exists(MERGED_PATH)));
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
			assertCatalog(report, "held");
			assert.isTrue(report.gateFailed);
			assert.isFalse(report.drifted);
			assert.isFalse(report.wrote);
			assert.isFalse(yield* fs.exists(PINNED_PATH));
			assert.isFalse(yield* fs.exists(PLAIN_PATH));
			assert.isFalse((yield* fs.exists(SLICE_PATH)) || (yield* fs.exists(MERGED_PATH)));
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
			assertCatalog(report, "held");
			assert.isTrue(report.gateFailed);
			assert.isFalse(report.wrote);
			assert.isFalse(yield* fs.exists(PLAIN_PATH), "check never writes");
			assert.isFalse((yield* fs.exists(SLICE_PATH)) || (yield* fs.exists(MERGED_PATH)), "check never writes");
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
			assertCatalog(report, "held");
			assert.isTrue(report.drifted);
			assert.isFalse(report.wrote);
			assert.isFalse(yield* fs.exists(PLAIN_PATH), "check never writes");
			assert.isFalse((yield* fs.exists(SLICE_PATH)) || (yield* fs.exists(MERGED_PATH)), "check never writes");
		}).pipe(Effect.provide(layers({ ...frozenSeed, [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	// The contrast: under `onDrift: "warn"` a build is not refused, so
	// `check` reports `would-write` for the clean sibling and the catalog.
	it.effect("in check mode one drifting schema under onDrift warn leaves the clean one would-write", () =>
		Effect.gen(function* () {
			const report = yield* Runner.run(twoSchemas(), options("check", { onDrift: "warn" }));
			assert.strictEqual(byId(report, PINNED_ID).outcome, "drift");
			assert.strictEqual(byId(report, PLAIN_ID).outcome, "would-write");
			assertCatalog(report, "would-write");
			assert.isFalse(report.wrote);
		}).pipe(Effect.provide(layers({ ...frozenSeed, [PINNED_PATH]: emitted(Wider, PINNED_ID) }))),
	);

	it.effect("a catalog file that does not parse is repaired by a build", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas(), options("build"));
			assertCatalog(report, "written");
			const parsed = JSON.parse(yield* fs.readFileString(MERGED_PATH)) as ReadonlyArray<unknown>;
			const entry = Schema.decodeUnknownSync(CatalogEntry)(parsed[0]);
			assert.strictEqual(entry.name, "pinned");
		}).pipe(Effect.provide(layers({ ...frozenSeed, ...catalogSeed("{ not json") }))),
	);

	it.effect("a stale but parseable catalog entry would-write under check and is left alone", () => {
		const stale = `${JSON.stringify([{ name: "pinned", description: "old", fileMatch: [], url: "https://old" }])}\n`;
		return Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const report = yield* Runner.run(twoSchemas(), options("check"));
			assertCatalog(report, "would-write");
			assert.isFalse(report.wrote);
			for (const file of CATALOG_PATHS) {
				assert.strictEqual(yield* fs.readFileString(file), stale);
			}
		}).pipe(Effect.provide(layers({ ...frozenSeed, ...catalogSeed(stale) })));
	});

	it.effect("a catalog file with reordered keys and different indentation is unchanged by content", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const reformatted = reorderedCatalogText();
			const report = yield* Runner.run(twoSchemas(), options("build"));
			assertCatalog(report, "unchanged");
			for (const file of CATALOG_PATHS) {
				assert.strictEqual(yield* fs.readFileString(file), reformatted, "the reformatted text is left alone");
			}
		}).pipe(Effect.provide(layers({ ...frozenSeed, ...catalogSeed(reorderedCatalogText()) }))),
	);

	it.effect("a catalog file that another tool reformatted is unchanged by content", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const reformatted = compactCatalogText();
			const report = yield* Runner.run(twoSchemas(), options("build"));
			assertCatalog(report, "unchanged");
			for (const file of CATALOG_PATHS) {
				assert.strictEqual(yield* fs.readFileString(file), reformatted, "the compact text is left alone");
			}
		}).pipe(Effect.provide(layers({ ...frozenSeed, ...catalogSeed(compactCatalogText()) }))),
	);

	it.effect("fails typed before any write when a frozen version is missing on disk", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Runner.run(twoSchemas(), options("build")));
			assert.instanceOf(error, FrozenVersionMissingError);
			assert.deepStrictEqual(error.missing, [{ name: "pinned", version: "4.0.0", path: FROZEN_PATH }]);
			const fs = yield* FileSystem.FileSystem;
			assert.isFalse(yield* fs.exists(PINNED_PATH));
			assert.isFalse((yield* fs.exists(SLICE_PATH)) || (yield* fs.exists(MERGED_PATH)));
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
			assert.isFalse((yield* fs.exists(SLICE_PATH)) || (yield* fs.exists(MERGED_PATH)));
		}).pipe(
			Effect.provide(
				layers({ [FROZEN_PATH]: emitted(Config, "https://old.example.com/schemas/4.0.0/pinned-4.0.0.json") }),
			),
		),
	);

	it.effect("a frozen file with no $id, or one that does not parse, is a mismatch with its own reason", () =>
		Effect.gen(function* () {
			const config = defineConfig({
				name: "test",
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
				name: "test",
				outputDir: "/repo/schemas",
				baseUrl: BASE,
				schemas: { plain: { schema: Config } },
			});
			// While the orphaned slice is on disk it is still merged, as every
			// config sharing the directory sees it: the merged catalog keeps
			// advertising its entries, unchanged, until the slice is deleted.
			const whileSliceRemains: CatalogReport = {
				slice: { path: SLICE_PATH, entries: 0, outcome: "orphaned" },
				merged: {
					path: MERGED_PATH,
					entries: 1,
					outcome: "unchanged",
					slices: [SLICE_PATH],
					conflicts: [],
					invalid: [],
				},
			};
			assert.deepStrictEqual((yield* Runner.run(config, options("check"))).catalog, whileSliceRemains);
			assert.deepStrictEqual((yield* Runner.run(config, options("build"))).catalog, whileSliceRemains);
			for (const file of CATALOG_PATHS) {
				assert.strictEqual(
					yield* fs.readFileString(file),
					compactCatalogText(),
					"the orphan is left for the user to delete",
				);
			}
			// Once the slice is deleted by hand, no slice remains: the merged
			// catalog is the orphan, reported and still never deleted.
			yield* fs.remove(SLICE_PATH);
			const afterDelete: CatalogReport = {
				merged: { path: MERGED_PATH, entries: 0, outcome: "orphaned", slices: [], conflicts: [], invalid: [] },
			};
			assert.deepStrictEqual((yield* Runner.run(config, options("check"))).catalog, afterDelete);
			assert.deepStrictEqual((yield* Runner.run(config, options("build"))).catalog, afterDelete);
			assert.isTrue(yield* fs.exists(MERGED_PATH));
		}).pipe(Effect.provide(layers({ ...catalogSeed(compactCatalogText()) }))),
	);

	it.effect("no catalog block and no catalog file reports no catalog at all", () =>
		Effect.gen(function* () {
			const config = defineConfig({
				name: "test",
				outputDir: "/repo/schemas",
				baseUrl: BASE,
				schemas: { plain: { schema: Config } },
			});
			const report = yield* Runner.run(config, options("check"));
			assert.isUndefined(report.catalog);
		}).pipe(Effect.provide(layers({}))),
	);

	// #747 — a rename (an `appendVersion` flip or a `layout` change) moves a
	// document's derived path and leaves the previously written file on disk
	// under the old name. Both modes probe the sibling shapes of every label
	// the config knows and report each unclaimed one that exists; neither
	// ever deletes one.
	it.effect(
		"a document at a sibling shape of a derived path is reported orphaned under both modes and never deleted",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const checked = yield* Runner.run(twoSchemas(), options("check"));
				assert.deepStrictEqual(checked.orphaned, [
					// `layout: "flat"` → `"versioned"` left the flat shape behind…
					"/repo/schemas/pinned-5.0.0.json",
					// …and `appendVersion: false` → `true` the bare-name shape, per label.
					"/repo/schemas/5.0.0/pinned.json",
					"/repo/schemas/4.0.0/pinned.json",
				]);
				const built = yield* Runner.run(twoSchemas(), options("build"));
				assert.deepStrictEqual(built.orphaned, checked.orphaned, "build reports the same probe");
				assert.isFalse(built.wrote, "a clean tree with orphans writes nothing");
				for (const orphan of checked.orphaned ?? []) {
					assert.isTrue(yield* fs.exists(orphan), `build never deletes ${orphan}`);
				}
			}).pipe(
				Effect.provide(
					layers({
						...frozenSeed,
						[PINNED_PATH]: emitted(Config, PINNED_ID),
						[PLAIN_PATH]: emitted(Config, PLAIN_ID),
						...catalogSeed(compactCatalogText()),
						"/repo/schemas/pinned-5.0.0.json": "{}\n",
						"/repo/schemas/5.0.0/pinned.json": "{}\n",
						"/repo/schemas/4.0.0/pinned.json": "{}\n",
					}),
				),
			),
	);

	it.effect("claimed outputs — targets, frozen files, the catalog — are never orphaned", () =>
		Effect.gen(function* () {
			const report = yield* Runner.run(twoSchemas(), options("check"));
			assert.isUndefined(report.orphaned);
		}).pipe(
			Effect.provide(
				layers({
					...frozenSeed,
					[PINNED_PATH]: emitted(Config, PINNED_ID),
					[PLAIN_PATH]: emitted(Config, PLAIN_ID),
					...catalogSeed(compactCatalogText()),
				}),
			),
		),
	);

	it.effect("only the sibling shapes of a derived path are probed; a co-resident document is never reported", () =>
		Effect.gen(function* () {
			// `outputDir` may be shared with another config, a deploy folder, or
			// the repository root: a document under a name this config does not
			// derive — another config's output, a label no longer declared, an
			// unrelated file — cannot be told from a legitimate neighbour.
			const report = yield* Runner.run(twoSchemas(), options("check"));
			assert.isUndefined(report.orphaned);
		}).pipe(
			Effect.provide(
				layers({
					...frozenSeed,
					[PINNED_PATH]: emitted(Config, PINNED_ID),
					[PLAIN_PATH]: emitted(Config, PLAIN_ID),
					...catalogSeed(compactCatalogText()),
					"/repo/schemas/other-config.json": "{}\n",
					"/repo/schemas/5.0.0/stray.json": "{}\n",
					"/repo/schemas/6.0.0/pinned-6.0.0.json": "{}\n",
					"/repo/schemas/manifest.json": "{}\n",
					"/repo/elsewhere/unrelated.json": "{}\n",
				}),
			),
		),
	);

	it.effect("a directory wearing a sibling shape's name is not an orphaned document", () =>
		Effect.gen(function* () {
			const report = yield* Runner.run(twoSchemas(), options("check"));
			assert.isUndefined(report.orphaned);
		}).pipe(
			Effect.provide(
				layers({
					...frozenSeed,
					[PINNED_PATH]: emitted(Config, PINNED_ID),
					[PLAIN_PATH]: emitted(Config, PLAIN_ID),
					...catalogSeed(compactCatalogText()),
					"/repo/schemas/pinned.json/inner.txt": "a directory wearing a derived name\n",
				}),
			),
		),
	);

	it.effect("reports every missing frozen version, not just the first", () =>
		Effect.gen(function* () {
			const config = defineConfig({
				name: "test",
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
			assert.isFalse((yield* fs.exists(SLICE_PATH)) || (yield* fs.exists(MERGED_PATH)));
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
			assertCatalog(report, "written");
			const fs = yield* FileSystem.FileSystem;
			const parsed = JSON.parse(yield* fs.readFileString(MERGED_PATH)) as ReadonlyArray<{ name: string; url: string }>;
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
			assert.strictEqual(report.catalog?.slice?.outcome, "written");
			assert.strictEqual(report.catalog?.merged?.outcome, "written");
			assert.isTrue(report.wrote);
		}).pipe(
			Effect.provide(
				layers({
					...frozenSeed,
					[PINNED_PATH]: emitted(Config, PINNED_ID),
					[PLAIN_PATH]: emitted(Config, PLAIN_ID),
					...catalogSeed("[]\n"),
				}),
			),
		),
	);

	it.effect("omits the catalog report when no schema declares one", () =>
		Effect.gen(function* () {
			const config = defineConfig({
				name: "test",
				outputDir: "/repo/schemas",
				baseUrl: BASE,
				schemas: { plain: { schema: Config } },
			});
			const report = yield* Runner.run(config, options("build"));
			assert.isUndefined(report.catalog);
			const fs = yield* FileSystem.FileSystem;
			assert.isFalse((yield* fs.exists(SLICE_PATH)) || (yield* fs.exists(MERGED_PATH)));
		}).pipe(Effect.provide(layers({}))),
	);
});

// #754 — configs sharing an `outputDir` share `catalogDir`: each owns its
// slice, and the merged catalog is the union every one of them converges on.
describe("Runner.run catalog slices", () => {
	const DIR = "/repo/schemas/catalogs";
	const MERGED = "/repo/schemas/catalog.json";
	const sliceOf = (name: string) => `${DIR}/${name}.json`;

	// A config named `name` declaring one cataloged, unversioned schema per key.
	const cataloged = (name: string, keys: ReadonlyArray<string>) =>
		defineConfig({
			name,
			outputDir: "/repo/schemas",
			baseUrl: BASE,
			schemas: Object.fromEntries(
				keys.map((key) => [
					key,
					{ schema: Config, catalog: { description: `${key} config`, fileMatch: [`${key}.json`] } },
				]),
			),
		});

	const urlsIn = Effect.fn(function* (file: string) {
		const fs = yield* FileSystem.FileSystem;
		const parsed = JSON.parse(yield* fs.readFileString(file)) as ReadonlyArray<{ url: string }>;
		return parsed.map((entry) => entry.url);
	});

	it.effect("two configs sharing outputDir both check green after both build", () =>
		Effect.gen(function* () {
			const a = cataloged("a", ["zeta", "alpha"]);
			const b = cataloged("b", ["mid"]);
			const builtA = yield* Runner.run(a, options("build"));
			assert.strictEqual(builtA.catalog?.merged?.outcome, "written");
			const builtB = yield* Runner.run(b, options("build"));
			assert.strictEqual(builtB.catalog?.slice?.outcome, "written");
			assert.strictEqual(builtB.catalog?.merged?.outcome, "written", "B's build adds its slice to the merge");
			// Building A again is a no-op: the merge it computes is the one B wrote.
			const rebuiltA = yield* Runner.run(a, options("build"));
			assert.isFalse(rebuiltA.wrote);
			for (const config of [a, b]) {
				const checked = yield* Runner.run(config, options("check"));
				assert.strictEqual(checked.catalog?.slice?.outcome, "unchanged", config.name);
				assert.deepStrictEqual(checked.catalog?.merged, {
					path: MERGED,
					entries: 3,
					outcome: "unchanged",
					slices: [sliceOf("a"), sliceOf("b")],
					conflicts: [],
					invalid: [],
				});
			}
			assert.deepStrictEqual(yield* urlsIn(sliceOf("a")), [`${BASE}/zeta.json`, `${BASE}/alpha.json`]);
			assert.deepStrictEqual(yield* urlsIn(sliceOf("b")), [`${BASE}/mid.json`]);
			assert.deepStrictEqual(
				yield* urlsIn(MERGED),
				[`${BASE}/alpha.json`, `${BASE}/mid.json`, `${BASE}/zeta.json`],
				"the merged catalog is sorted by url",
			);
		}).pipe(Effect.provide(layers({}))),
	);

	it.effect("the merged catalog is identical whichever config builds last", () =>
		Effect.gen(function* () {
			const texts = [];
			for (const order of [
				["a", "b"],
				["b", "a"],
			] as const) {
				const merged = yield* Effect.gen(function* () {
					for (const name of order) {
						yield* Runner.run(cataloged(name, name === "a" ? ["zeta", "alpha"] : ["mid"]), options("build"));
					}
					const fs = yield* FileSystem.FileSystem;
					return yield* fs.readFileString(MERGED);
				}).pipe(Effect.provide(layers({})));
				texts.push(merged);
			}
			assert.strictEqual(texts[0], texts[1]);
		}),
	);

	it.effect("a removed schema's entry drops out of the slice and the merged catalog", () =>
		Effect.gen(function* () {
			yield* Runner.run(cataloged("a", ["alpha", "beta"]), options("build"));
			yield* Runner.run(cataloged("b", ["mid"]), options("build"));
			const report = yield* Runner.run(cataloged("a", ["alpha"]), options("build"));
			assert.deepStrictEqual(report.catalog?.slice, { path: sliceOf("a"), entries: 1, outcome: "written" });
			assert.strictEqual(report.catalog?.merged?.outcome, "written");
			assert.strictEqual(report.catalog?.merged?.entries, 2);
			assert.deepStrictEqual(yield* urlsIn(sliceOf("a")), [`${BASE}/alpha.json`]);
			assert.deepStrictEqual(yield* urlsIn(MERGED), [`${BASE}/alpha.json`, `${BASE}/mid.json`]);
		}).pipe(Effect.provide(layers({}))),
	);

	it.effect("check merges the running config's fresh entries, not its stale slice on disk", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* Runner.run(cataloged("b", ["mid"]), options("build"));
			yield* Runner.run(cataloged("a", ["alpha"]), options("build"));
			const merged = yield* fs.readFileString(MERGED);
			// A's slice goes stale on disk (a hand edit, a bad merge); the merged
			// file still holds exactly what a build of A would produce.
			const stale = `${JSON.stringify([{ name: "alpha", description: "old", fileMatch: [], url: `${BASE}/old.json` }])}\n`;
			yield* fs.writeFileString(sliceOf("a"), stale);
			const report = yield* Runner.run(cataloged("a", ["alpha"]), options("check"));
			assert.strictEqual(report.catalog?.slice?.outcome, "would-write");
			assert.strictEqual(report.catalog?.merged?.outcome, "unchanged", "the stale slice is not what is merged");
			assert.strictEqual(yield* fs.readFileString(MERGED), merged);
			assert.strictEqual(yield* fs.readFileString(sliceOf("a")), stale, "check never writes");
		}).pipe(Effect.provide(layers({}))),
	);

	it.effect("a url two slices advertise blocks the merged write and names both slices", () =>
		Effect.gen(function* () {
			yield* Runner.run(cataloged("a", ["shared", "alpha"]), options("build"));
			const mergedBefore = yield* urlsIn(MERGED);
			const report = yield* Runner.run(cataloged("b", ["shared"]), options("build"));
			assert.strictEqual(report.catalog?.slice?.outcome, "written", "B's own slice is still written");
			assert.deepStrictEqual(report.catalog?.merged, {
				path: MERGED,
				entries: 2,
				outcome: "blocked",
				slices: [sliceOf("a"), sliceOf("b")],
				conflicts: [{ kind: "url", url: `${BASE}/shared.json`, slices: [sliceOf("a"), sliceOf("b")] }],
				invalid: [],
			});
			assert.deepStrictEqual(yield* urlsIn(MERGED), mergedBefore, "a blocked merge writes nothing");
			const checked = yield* Runner.run(cataloged("a", ["shared", "alpha"]), options("check"));
			assert.strictEqual(checked.catalog?.merged?.outcome, "blocked", "every config sees the conflict");
		}).pipe(Effect.provide(layers({}))),
	);

	// A config named `name` declaring one cataloged schema keyed `key` whose
	// catalog entry is displayed as `display`.
	const displayed = (name: string, key: string, display: string) =>
		defineConfig({
			name,
			outputDir: "/repo/schemas",
			baseUrl: BASE,
			schemas: {
				[key]: { schema: Config, catalog: { name: display, description: `${key} config`, fileMatch: [`${key}.json`] } },
			},
		});

	const namesIn = Effect.fn(function* (file: string) {
		const fs = yield* FileSystem.FileSystem;
		const parsed = JSON.parse(yield* fs.readFileString(file)) as ReadonlyArray<{ name: string; url: string }>;
		return parsed.map((entry) => [entry.name, entry.url]);
	});

	it.effect("a catalog display name reaches the slice and the merged catalog while the URL keeps the key", () =>
		Effect.gen(function* () {
			const report = yield* Runner.run(displayed("a", "config", "tool.config.toml"), options("build"));
			assert.strictEqual(report.catalog?.merged?.outcome, "written");
			assert.deepStrictEqual(yield* namesIn(sliceOf("a")), [["tool.config.toml", `${BASE}/config.json`]]);
			assert.deepStrictEqual(yield* namesIn(MERGED), [["tool.config.toml", `${BASE}/config.json`]]);
		}).pipe(Effect.provide(layers({}))),
	);

	it.effect("a name two slices advertise blocks the merged write as a name conflict", () =>
		Effect.gen(function* () {
			yield* Runner.run(displayed("a", "config", "tool.toml"), options("build"));
			const mergedBefore = yield* namesIn(MERGED);
			for (const mode of ["build", "check"] as const) {
				const report = yield* Runner.run(displayed("b", "credentials", "tool.toml"), options(mode));
				assert.deepStrictEqual(
					report.catalog?.merged,
					{
						path: MERGED,
						entries: 2,
						outcome: "blocked",
						slices: [sliceOf("a"), sliceOf("b")],
						conflicts: [{ kind: "name", name: "tool.toml", slices: [sliceOf("a"), sliceOf("b")] }],
						invalid: [],
					},
					mode,
				);
			}
			assert.deepStrictEqual(yield* namesIn(MERGED), mergedBefore, "a blocked merge writes nothing");
		}).pipe(Effect.provide(layers({}))),
	);

	it.effect("url conflicts sort before name conflicts, and a url collision is never also a name collision", () =>
		Effect.gen(function* () {
			const report = yield* Runner.run(displayed("b", "credentials", "tool.toml"), options("check"));
			assert.deepStrictEqual(report.catalog?.merged?.conflicts, [
				{ kind: "url", url: `${BASE}/credentials.json`, slices: [sliceOf("a"), sliceOf("b")] },
				{ kind: "name", name: "tool.toml", slices: [sliceOf("a"), sliceOf("z")] },
			]);
		}).pipe(
			Effect.provide(
				layers({
					// `a` repeats b's whole entry (url and name): one url conflict only,
					// since the entry that loses the url is not advertised.
					[sliceOf("a")]:
						`${JSON.stringify([{ name: "tool.toml", description: "d", fileMatch: [], url: `${BASE}/credentials.json` }])}\n`,
					[sliceOf("z")]:
						`${JSON.stringify([{ name: "tool.toml", description: "d", fileMatch: [], url: `${BASE}/z.json` }])}\n`,
				}),
			),
		),
	);

	it.effect("a hand-written slice advertising one name twice is reported, listing that slice twice", () =>
		Effect.gen(function* () {
			const report = yield* Runner.run(cataloged("a", ["alpha"]), options("check"));
			assert.strictEqual(report.catalog?.merged?.outcome, "blocked");
			assert.deepStrictEqual(report.catalog?.merged?.conflicts, [
				{ kind: "name", name: "dup", slices: [sliceOf("foreign"), sliceOf("foreign")] },
			]);
		}).pipe(
			Effect.provide(
				layers({
					[sliceOf("foreign")]: `${JSON.stringify([
						{ name: "dup", description: "d", fileMatch: [], url: `${BASE}/one.json` },
						{ name: "dup", description: "d", fileMatch: [], url: `${BASE}/two.json` },
					])}\n`,
				}),
			),
		),
	);

	it.effect("a slice that is not a catalog entry array is reported invalid, never silently dropped", () =>
		Effect.gen(function* () {
			const report = yield* Runner.run(cataloged("a", ["alpha"]), options("build"));
			assert.strictEqual(report.catalog?.merged?.outcome, "blocked");
			assert.deepStrictEqual(report.catalog?.merged?.invalid, [
				{ path: sliceOf("broken"), reason: "not JSON" },
				{ path: sliceOf("notarray"), reason: "Expected array" },
				{ path: sliceOf("wrong"), reason: 'Expected string at [0]["name"]' },
			]);
			assert.deepStrictEqual(report.catalog?.merged?.slices, [sliceOf("a")]);
			const fs = yield* FileSystem.FileSystem;
			assert.isFalse(yield* fs.exists(MERGED));
		}).pipe(
			Effect.provide(
				layers({
					[sliceOf("broken")]: "{ not json",
					[sliceOf("notarray")]: `${JSON.stringify({ name: "x" })}\n`,
					[sliceOf("wrong")]:
						`${JSON.stringify([{ name: 1, description: "d", fileMatch: [], url: `${BASE}/w.json` }])}\n`,
				}),
			),
		),
	);

	it.effect("only *.json files directly in catalogDir are slices", () =>
		Effect.gen(function* () {
			const report = yield* Runner.run(cataloged("a", ["alpha"]), options("build"));
			assert.strictEqual(report.catalog?.merged?.outcome, "written");
			assert.deepStrictEqual(report.catalog?.merged?.slices, [sliceOf("a")]);
		}).pipe(
			Effect.provide(
				layers({
					[`${DIR}/README.md`]: "# slices\n",
					[`${DIR}/nested.json/inner.json`]: "[]\n",
				}),
			),
		),
	);

	it.effect("an orphaned slice is merged as it sits on disk, like every other config sees it", () =>
		Effect.gen(function* () {
			yield* Runner.run(cataloged("a", ["alpha"]), options("build"));
			yield* Runner.run(cataloged("b", ["mid"]), options("build"));
			const uncataloged = defineConfig({
				name: "a",
				outputDir: "/repo/schemas",
				baseUrl: BASE,
				schemas: { alpha: { schema: Config } },
			});
			const report = yield* Runner.run(uncataloged, options("check"));
			assert.deepStrictEqual(report.catalog?.slice, { path: sliceOf("a"), entries: 0, outcome: "orphaned" });
			// The orphan is merged as it sits on disk — exactly as B sees it —
			// so the merged catalog is unchanged and keeps advertising it until
			// the slice is deleted by hand.
			assert.strictEqual(report.catalog?.merged?.outcome, "unchanged");
			assert.deepStrictEqual(report.catalog?.merged?.slices, [sliceOf("a"), sliceOf("b")]);
			assert.strictEqual(report.catalog?.merged?.entries, 2);
		}).pipe(Effect.provide(layers({}))),
	);

	// Round-6 dogfood: while a config's slice is orphaned, the merge must stay
	// a pure function of disk plus NON-EMPTY fresh entries, or the owner and
	// every other config disagree on the merged file and ping-pong it.
	it.effect("an orphaned slice does not make the merged catalog flip-flop between configs", () =>
		Effect.gen(function* () {
			const b = cataloged("b", ["mid"]);
			const uncatalogedA = defineConfig({
				name: "a",
				outputDir: "/repo/schemas",
				baseUrl: BASE,
				schemas: { alpha: { schema: Config } },
			});
			yield* Runner.run(cataloged("a", ["alpha"]), options("build"));
			yield* Runner.run(b, options("build"));
			const fs = yield* FileSystem.FileSystem;
			const merged = yield* fs.readFileString(MERGED);
			// A drops its catalog; its slice stays on disk, orphaned.
			const steps = [
				["check", b],
				["build", b],
				["check", uncatalogedA],
				["build", uncatalogedA],
				["check", b],
			] as const;
			for (const [mode, config] of steps) {
				const report = yield* Runner.run(config, options(mode));
				const label = `${mode} ${config.name}`;
				assert.strictEqual(report.catalog?.merged?.outcome, "unchanged", label);
				assert.strictEqual(report.catalog?.merged?.entries, 2, label);
				assert.deepStrictEqual(report.catalog?.merged?.slices, [sliceOf("a"), sliceOf("b")], label);
				assert.isFalse(report.wrote, label);
				if (config === uncatalogedA) {
					assert.deepStrictEqual(report.catalog?.slice, { path: sliceOf("a"), entries: 0, outcome: "orphaned" }, label);
				}
			}
			assert.strictEqual(yield* fs.readFileString(MERGED), merged, "nobody rewrote the merged catalog");
			// Both configs' views of the merged catalog, side by side: identical.
			const fromA = yield* Runner.run(uncatalogedA, options("check"));
			const fromB = yield* Runner.run(b, options("check"));
			assert.deepStrictEqual(fromA.catalog?.merged, fromB.catalog?.merged);
		}).pipe(Effect.provide(layers({}))),
	);

	it.effect("both configs compute an identical merged catalog while one slice is orphaned", () =>
		Effect.gen(function* () {
			const uncatalogedA = defineConfig({
				name: "a",
				outputDir: "/repo/schemas",
				baseUrl: BASE,
				schemas: { alpha: { schema: Config } },
			});
			const b = cataloged("b", ["mid"]);
			yield* Runner.run(b, options("build"));
			const fromA = yield* Runner.run(uncatalogedA, options("check"));
			const fromB = yield* Runner.run(b, options("check"));
			assert.deepStrictEqual(fromA.catalog?.merged, fromB.catalog?.merged);
			assert.strictEqual(fromA.catalog?.merged?.entries, 2, "the orphan's entry stays advertised until it is deleted");
			assert.strictEqual(fromA.catalog?.merged?.outcome, "unchanged");
		}).pipe(
			Effect.provide(
				layers({
					[sliceOf("a")]:
						`${JSON.stringify([{ name: "alpha", description: "alpha config", fileMatch: ["alpha.json"], url: `${BASE}/alpha.json` }])}\n`,
				}),
			),
		),
	);

	const entryText = (key: string) =>
		`${JSON.stringify([{ name: key, description: `${key} config`, fileMatch: [`${key}.json`], url: `${BASE}/${key}.json` }])}\n`;

	it.effect("a slice that vanishes between listing and reading is skipped", () =>
		Effect.gen(function* () {
			const report = yield* Runner.run(cataloged("a", ["alpha"]), options("check"));
			assert.deepStrictEqual(report.catalog?.merged?.slices, [sliceOf("a")]);
			assert.deepStrictEqual(report.catalog?.merged?.invalid, []);
			assert.strictEqual(report.catalog?.merged?.outcome, "would-write");
		}).pipe(
			Effect.provide(
				faultyLayers(
					{ [sliceOf("gone")]: entryText("gone"), [sliceOf("gone2")]: entryText("gone2") },
					{
						stat: (path) =>
							path === sliceOf("gone") ? Effect.fail(platformFailure("NotFound", "stat", path)) : undefined,
						readFileString: (path) =>
							path === sliceOf("gone2") ? Effect.fail(platformFailure("NotFound", "readFileString", path)) : undefined,
					},
				),
			),
		),
	);

	it.effect("a slice that cannot be read is invalid and blocks the merge, never an untyped abort", () =>
		Effect.gen(function* () {
			const report = yield* Runner.run(cataloged("a", ["alpha"]), options("build"));
			assert.strictEqual(report.catalog?.merged?.outcome, "blocked");
			assert.deepStrictEqual(report.catalog?.merged?.invalid, [
				{ path: sliceOf("dangling"), reason: "unreadable: a dangling symlink" },
				{ path: sliceOf("locked"), reason: "unreadable: PermissionDenied" },
				{ path: sliceOf("unstattable"), reason: "unreadable: PermissionDenied" },
			]);
			assert.strictEqual(report.catalog?.slice?.outcome, "written", "the config's own slice is still written");
		}).pipe(
			Effect.provide(
				faultyLayers(
					{
						[sliceOf("dangling")]: MemoryFileSystem.symlink("/nowhere/catalog.json"),
						[sliceOf("locked")]: entryText("locked"),
						[sliceOf("unstattable")]: entryText("unstattable"),
					},
					{
						readFileString: (path) =>
							path === sliceOf("locked")
								? Effect.fail(platformFailure("PermissionDenied", "readFileString", path))
								: undefined,
						stat: (path) =>
							path === sliceOf("unstattable")
								? Effect.fail(platformFailure("PermissionDenied", "stat", path))
								: undefined,
					},
				),
			),
		),
	);

	// A case-insensitive, case-preserving volume: `Docs.json` resolves to a
	// stored `docs.json`, while the listing still names the stored file.
	const caseInsensitiveLayers = (seed: MemoryFileSystemSeed) =>
		Layer.mergeAll(SchemaFile.layer, AjvValidator.layer).pipe(
			Layer.provideMerge(Layer.mergeAll(MemoryFileSystem.layerWith(seed, { caseSensitive: false }), Path.layer)),
		);

	it.effect("on a case-insensitive volume a case-only rename leftover is the config's own slice", () =>
		Effect.gen(function* () {
			// The volume resolves `Docs.json` to the stored `docs.json`: one file,
			// so it must never conflict with the entries replacing it.
			for (let round = 0; round < 2; round++) {
				const report = yield* Runner.run(cataloged("Docs", ["alpha"]), options("build"));
				assert.strictEqual(report.catalog?.merged?.outcome, round === 0 ? "written" : "unchanged", `round ${round}`);
				assert.deepStrictEqual(report.catalog?.merged?.conflicts, []);
				assert.deepStrictEqual(report.catalog?.merged?.slices, [sliceOf("Docs")]);
				// The case-folded claim is visible, never silent: two configs whose
				// names differ only in case share one file on such a volume.
				assert.deepStrictEqual(report.catalog?.slice, {
					path: sliceOf("Docs"),
					entries: 1,
					outcome: "unchanged",
					caseFoldedMatch: sliceOf("docs"),
				});
			}
			const checked = yield* Runner.run(cataloged("Docs", ["alpha"]), options("check"));
			assert.isFalse(checked.wrote);
			assert.strictEqual(checked.catalog?.merged?.outcome, "unchanged");
		}).pipe(Effect.provide(caseInsensitiveLayers({ [sliceOf("docs")]: entryText("alpha") }))),
	);

	it.effect("on a case-sensitive volume a case-only rename leftover blocks the first build like any rename", () =>
		Effect.gen(function* () {
			// The name alone decides nothing: memfs is case-sensitive, so
			// `docs.json` is another file — a leftover advertising the same URL.
			for (let round = 0; round < 2; round++) {
				const report = yield* Runner.run(cataloged("Docs", ["alpha"]), options("build"));
				assert.strictEqual(report.catalog?.merged?.outcome, "blocked", `round ${round}`);
				assert.deepStrictEqual(report.catalog?.merged?.conflicts, [
					{ kind: "url", url: `${BASE}/alpha.json`, slices: [sliceOf("Docs"), sliceOf("docs")] },
				]);
				assert.deepStrictEqual(report.catalog?.merged?.slices, [sliceOf("Docs"), sliceOf("docs")]);
				assert.isUndefined(report.catalog?.slice?.caseFoldedMatch, `round ${round}`);
			}
		}).pipe(Effect.provide(layers({ [sliceOf("docs")]: entryText("alpha") }))),
	);

	it.effect("on a case-sensitive volume Docs never claims the docs config's slice", () =>
		Effect.gen(function* () {
			// `docs` has built; `Docs` builds for the first time and must merge
			// `docs.json` as another config's slice, never hide it as its own.
			yield* Runner.run(cataloged("docs", ["alpha"]), options("build"));
			const report = yield* Runner.run(cataloged("Docs", ["beta"]), options("build"));
			assert.isUndefined(report.catalog?.slice?.caseFoldedMatch);
			assert.deepStrictEqual(report.catalog?.merged, {
				path: MERGED,
				entries: 2,
				outcome: "written",
				slices: [sliceOf("Docs"), sliceOf("docs")],
				conflicts: [],
				invalid: [],
			});
			for (const config of [cataloged("docs", ["alpha"]), cataloged("Docs", ["beta"])]) {
				const checked = yield* Runner.run(config, options("check"));
				assert.isFalse(checked.wrote, config.name);
				assert.strictEqual(checked.catalog?.merged?.outcome, "unchanged", config.name);
			}
		}).pipe(Effect.provide(layers({}))),
	);

	it.effect(
		"an exact own-slice match wins over a case-folded one: docs and Docs are two slices on a case-sensitive volume",
		() =>
			Effect.gen(function* () {
				const configs = [cataloged("docs", ["alpha"]), cataloged("Docs", ["beta"]), cataloged("other", ["gamma"])];
				for (const config of configs) {
					yield* Runner.run(config, options("build"));
				}
				const views = [];
				for (const config of configs) {
					const report = yield* Runner.run(config, options("check"));
					assert.isFalse(report.wrote, config.name);
					views.push(report.catalog?.merged);
				}
				const expected: MergedCatalogReport = {
					path: MERGED,
					entries: 3,
					outcome: "unchanged",
					slices: [sliceOf("Docs"), sliceOf("docs"), sliceOf("other")],
					conflicts: [],
					invalid: [],
				};
				for (const view of views) {
					assert.deepStrictEqual(view, expected);
				}
				// An exact match is never reported as a case-folded claim.
				for (const config of configs) {
					const report = yield* Runner.run(config, options("check"));
					assert.isUndefined(report.catalog?.slice?.caseFoldedMatch, config.name);
				}
				// A second round of builds leaves the merged file alone: no ping-pong.
				const fs = yield* FileSystem.FileSystem;
				const merged = yield* fs.readFileString(MERGED);
				for (const config of configs) {
					assert.isFalse((yield* Runner.run(config, options("build"))).wrote, config.name);
				}
				assert.strictEqual(yield* fs.readFileString(MERGED), merged);
			}).pipe(Effect.provide(layers({}))),
	);

	it.effect("a catalogDir that is a file fails typed before anything is written", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Runner.run(cataloged("a", ["alpha"]), options("build")));
			assert.instanceOf(error, CatalogDirError);
			assert.strictEqual(error.path, DIR);
			assert.strictEqual(error.reason, "not a directory");
			assert.strictEqual(
				error.message,
				"catalogDir /repo/schemas/catalogs cannot be listed (not a directory); it must be a directory holding only catalog slices, or not exist yet. Nothing was written.",
			);
			const fs = yield* FileSystem.FileSystem;
			assert.isFalse(yield* fs.exists("/repo/schemas/alpha.json"), "nothing is written");
			assert.isFalse(yield* fs.exists(MERGED));
		}).pipe(Effect.provide(layers({ [DIR]: "not a directory\n" }))),
	);

	it.effect("a catalogDir that cannot be listed fails typed, never an untyped abort", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Runner.run(cataloged("a", ["alpha"]), options("check")));
			assert.instanceOf(error, CatalogDirError);
			assert.strictEqual(error.path, DIR);
			assert.strictEqual(error.reason, "permission denied");
		}).pipe(
			Effect.provide(
				faultyLayers(
					{ [sliceOf("b")]: entryText("b") },
					{
						readDirectory: (path) =>
							path === DIR ? Effect.fail(platformFailure("PermissionDenied", "readDirectory", path)) : undefined,
					},
				),
			),
		),
	);

	it.effect("a slice carrying a key a catalog entry does not declare is invalid, never silently stripped", () =>
		Effect.gen(function* () {
			const report = yield* Runner.run(cataloged("a", ["alpha"]), options("check"));
			assert.strictEqual(report.catalog?.merged?.outcome, "blocked");
			// A well-formed array whose entry has unknown keys names each key.
			assert.deepStrictEqual(report.catalog?.merged?.invalid, [
				{
					path: sliceOf("extra"),
					reason: 'Expected no excess property at [0]["unexpected"]; Expected no excess property at [0]["more"]',
				},
			]);
		}).pipe(
			Effect.provide(
				layers({
					[sliceOf("extra")]:
						`${JSON.stringify([{ name: "x", description: "d", fileMatch: [], url: `${BASE}/x.json`, unexpected: true, more: 1 }])}\n`,
				}),
			),
		),
	);

	it.effect("the slice and merged catalog are claimed, never orphaned documents", () =>
		Effect.gen(function* () {
			// A schema keyed `catalog` in a versioned layout derives the sibling
			// shape `<outputDir>/catalog.json`: the merged catalog is claimed.
			const config = defineConfig({
				name: "a",
				outputDir: "/repo/schemas",
				baseUrl: BASE,
				schemas: {
					catalog: { schema: Config, versions: ["1.0"], catalog: { description: "d", fileMatch: ["c.json"] } },
				},
			});
			yield* Runner.run(config, options("build"));
			const report = yield* Runner.run(config, options("check"));
			assert.isUndefined(report.orphaned);
			assert.strictEqual(report.catalog?.merged?.outcome, "unchanged");
		}).pipe(Effect.provide(layers({}))),
	);
});
