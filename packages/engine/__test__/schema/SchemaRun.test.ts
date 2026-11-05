import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { SchemastoreConfig } from "@effected/schemastore";
import { SchemaValidator, StoreDocument, ValidationFinding, defineConfig } from "@effected/schemastore";
import { ConfigProvider, Deferred, Effect, FileSystem, Layer, Path, Result, Schema } from "effect";
import { Report } from "../../src/schema/Report.js";
import { RunReport } from "../../src/schema/RunReport.js";
import type { SchemaProgress, SchemaRunDeps, SchemaRunInput } from "../../src/schema/SchemaRun.js";
import { SchemaRun } from "../../src/schema/SchemaRun.js";
import { StepSummary } from "../../src/schema/StepSummary.js";

const base = Path.layer;
const volume = (seed: MemoryFileSystemSeed = {}) => Layer.merge(base, MemoryFileSystem.layerWith(seed));

const Fixture = Schema.Struct({ name: Schema.String, port: Schema.Number });
const Changed = Schema.Struct({ name: Schema.String, port: Schema.Number, host: Schema.String });

const BASE = "https://example.com/schemas";
const CONFIG_PATH = "/repo/schemastore.config.ts";
const DOC_PATH = "/repo/schemas/app.json";
const DOC_ID = `${BASE}/app.json`;

const configOf = (schema: Schema.Constraint): SchemastoreConfig =>
	defineConfig({ name: "test", outputDir: "schemas", baseUrl: BASE, schemas: { app: { schema } } });

const emitted = (schema: Schema.Constraint): string =>
	Result.getOrThrow(Result.getOrThrow(StoreDocument.fromSchemaResult(schema, { $id: DOC_ID })).serializeResult());

const input = (overrides: Partial<SchemaRunInput> = {}): SchemaRunInput => ({
	mode: "check",
	force: false,
	versionMismatch: "fail",
	...overrides,
});

const deps = (config: SchemastoreConfig, overrides: Partial<SchemaRunDeps> = {}): SchemaRunDeps => ({
	cwd: "/repo",
	importModule: () => Promise.resolve({ default: config }),
	...overrides,
});

const seedConfig: MemoryFileSystemSeed = { [CONFIG_PATH]: "" };

describe("SchemaRun.run", () => {
	it.effect("a clean check is verdict ok with no diff", () =>
		Effect.gen(function* () {
			const result = yield* SchemaRun.run(input(), deps(configOf(Fixture)));
			assert.strictEqual(result.verdict, "ok");
			assert.strictEqual(result.report.schemas[0]?.change, "none");
			assert.isFalse("diff" in (result.report.schemas[0] ?? {}));
			assert.isFalse("versionMismatch" in result);
		}).pipe(Effect.provide(volume({ ...seedConfig, [DOC_PATH]: emitted(Fixture) }))),
	);

	it.effect("a changed document carries hunks and unified text, and nothing is written", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const before = emitted(Fixture);
			const result = yield* SchemaRun.run(input(), deps(configOf(Changed)));
			assert.strictEqual(result.verdict, "stale");
			const diff = result.report.schemas[0]?.diff;
			assert.isDefined(diff);
			assert.isAbove(diff?.hunks.length ?? 0, 0);
			assert.isTrue(diff?.hunks.some((hunk) => hunk.lines.some((line) => line.kind === "add")));
			assert.include(diff?.unified ?? "", `--- ${DOC_PATH}`);
			assert.include(diff?.unified ?? "", `+++ ${DOC_PATH}`);
			assert.include(diff?.unified ?? "", '+\t\t"host"');
			assert.strictEqual(yield* fs.readFileString(DOC_PATH), before);
			assert.isFalse(result.report.wrote);
		}).pipe(Effect.provide(volume({ ...seedConfig, [DOC_PATH]: emitted(Fixture) }))),
	);

	it.effect("a missing document diffs as all additions", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const result = yield* SchemaRun.run(input(), deps(configOf(Fixture)));
			assert.strictEqual(result.verdict, "stale");
			const schema = result.report.schemas[0];
			assert.strictEqual(schema?.change, "created");
			const hunks = schema?.diff?.hunks ?? [];
			assert.lengthOf(hunks, 1);
			assert.strictEqual(hunks[0]?.oldLines, 0);
			assert.isTrue(hunks[0]?.lines.every((line) => line.kind === "add"));
			assert.include(schema?.diff?.unified ?? "", "--- /dev/null");
			assert.isFalse(yield* fs.exists(DOC_PATH));
		}).pipe(Effect.provide(volume(seedConfig))),
	);

	it.effect("a build writes and reports the diff of what it changed", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const result = yield* SchemaRun.run(input({ mode: "build" }), deps(configOf(Changed)));
			assert.strictEqual(result.verdict, "ok");
			const schema = result.report.schemas[0];
			assert.strictEqual(schema?.outcome, "written");
			assert.include(schema?.diff?.unified ?? "", '+\t\t"host"');
			assert.strictEqual(yield* fs.readFileString(DOC_PATH), emitted(Changed));
			assert.isTrue(result.report.wrote);
		}).pipe(Effect.provide(volume({ ...seedConfig, [DOC_PATH]: emitted(Fixture) }))),
	);

	it.effect("a build over an unchanged document reports no diff", () =>
		Effect.gen(function* () {
			const result = yield* SchemaRun.run(input({ mode: "build" }), deps(configOf(Fixture)));
			assert.strictEqual(result.report.schemas[0]?.outcome, "unchanged");
			assert.isFalse("diff" in (result.report.schemas[0] ?? {}));
		}).pipe(Effect.provide(volume({ ...seedConfig, [DOC_PATH]: emitted(Fixture) }))),
	);

	it.effect("a space-indented on-disk document diffs only the real change", () =>
		Effect.gen(function* () {
			const result = yield* SchemaRun.run(input(), deps(configOf(Changed)));
			const lines = result.report.schemas[0]?.diff?.hunks.flatMap((hunk) => hunk.lines) ?? [];
			const changed = lines.filter((line) => line.kind !== "context");
			const total = emitted(Changed).split("\n").length;
			assert.isAbove(changed.length, 0);
			assert.isBelow(changed.length, total / 2);
			// No line removed only for its indentation: every remove is a real removal.
			const added = new Set(changed.filter((line) => line.kind === "add").map((line) => line.text.trim()));
			for (const line of changed.filter((line) => line.kind === "remove")) {
				assert.isFalse(added.has(line.text.trim()), `only re-indented: ${line.text}`);
			}
		}).pipe(
			Effect.provide(
				volume({ ...seedConfig, [DOC_PATH]: `${JSON.stringify(JSON.parse(emitted(Fixture)), null, 2)}\n` }),
			),
		),
	);

	it.effect("a key-reordered on-disk document is verdict ok", () =>
		Effect.gen(function* () {
			const result = yield* SchemaRun.run(input(), deps(configOf(Fixture)));
			assert.strictEqual(result.verdict, "ok");
			assert.isFalse("diff" in (result.report.schemas[0] ?? {}));
		}).pipe(
			Effect.provide(
				volume({
					...seedConfig,
					[DOC_PATH]: (() => {
						const parsed = JSON.parse(emitted(Fixture)) as Record<string, unknown>;
						const reversed = Object.fromEntries(Object.entries(parsed).reverse());
						assert.notStrictEqual(JSON.stringify(reversed), JSON.stringify(parsed));
						return JSON.stringify(reversed);
					})(),
				}),
			),
		),
	);

	it.effect("a key-reordered document with one real change shows only that change", () =>
		Effect.gen(function* () {
			const hunksOver = (text: string) =>
				SchemaRun.run(input(), deps(configOf(Changed))).pipe(
					Effect.map((result) => result.report.schemas[0]?.diff?.hunks),
					Effect.provide(volume({ ...seedConfig, [DOC_PATH]: text })),
				);
			const reverse = (value: unknown): unknown =>
				Array.isArray(value)
					? value.map(reverse)
					: typeof value === "object" && value !== null
						? Object.fromEntries(
								Object.entries(value)
									.reverse()
									.map(([key, inner]) => [key, reverse(inner)]),
							)
						: value;
			const canonical = emitted(Fixture);
			const reordered = JSON.stringify(reverse(JSON.parse(canonical)));
			assert.notStrictEqual(reordered, JSON.stringify(JSON.parse(canonical)));
			const expected = yield* hunksOver(canonical);
			assert.isAbove(expected?.length ?? 0, 0);
			assert.deepStrictEqual(yield* hunksOver(reordered), expected);
		}),
	);

	it.effect("a key only the file holds stays in the diff, as data even when named __proto__", () =>
		Effect.gen(function* () {
			const onDisk = JSON.stringify(JSON.parse(emitted(Fixture))).replace(/^\{/, '{"__proto__":{"x":1},"old":true,');
			const result = yield* SchemaRun.run(input(), deps(configOf(Fixture))).pipe(
				Effect.provide(volume({ ...seedConfig, [DOC_PATH]: onDisk })),
			);
			const removed = (result.report.schemas[0]?.diff?.hunks ?? [])
				.flatMap((hunk) => hunk.lines)
				.filter((line) => line.kind === "remove")
				.map((line) => line.text.trim());
			assert.include(removed, '"__proto__": {');
			assert.isTrue(removed.some((text) => text.startsWith('"old": true')));
			assert.isUndefined(({} as { x?: unknown }).x);
		}),
	);

	it.effect("--force with --drift=strict fails ConflictingFlagsError before loading", () =>
		Effect.gen(function* () {
			let loaded = false;
			const error = yield* Effect.flip(
				SchemaRun.run(
					input({ force: true, drift: "strict" }),
					deps(configOf(Fixture), {
						importModule: () => {
							loaded = true;
							return Promise.resolve({});
						},
					}),
				),
			);
			assert.strictEqual(error._tag, "ConflictingFlagsError");
			assert.isFalse(loaded);
		}).pipe(Effect.provide(volume(seedConfig))),
	);

	it.effect("--force alone is drift allow over every schema", () =>
		Effect.gen(function* () {
			const result = yield* SchemaRun.run(input({ force: true }), deps(configOf(Fixture)));
			assert.strictEqual(result.report.policy, "allow");
		}).pipe(Effect.provide(volume({ ...seedConfig, [DOC_PATH]: emitted(Fixture) }))),
	);

	it.effect("onProgress sees Started, one SchemaChecked per schema, then one SchemaDone per schema", () =>
		Effect.gen(function* () {
			const events: Array<SchemaProgress> = [];
			const config = defineConfig({
				name: "test",
				outputDir: "schemas",
				baseUrl: BASE,
				schemas: { app: { schema: Fixture }, other: { schema: Changed } },
			});
			yield* SchemaRun.run(
				input(),
				deps(config, {
					onProgress: (event) =>
						Effect.sync(() => {
							events.push(event);
						}),
				}),
			);
			assert.deepStrictEqual(
				events.map((event) => event._tag),
				["Started", "SchemaChecked", "SchemaChecked", "SchemaDone", "SchemaDone"],
			);
			const [started, checked, , first, second] = events;
			assert.deepStrictEqual(started?._tag === "Started" ? started.names : [], ["app", "other"]);
			assert.isFalse(started !== undefined && "versionMismatch" in started);
			assert.deepStrictEqual(checked, {
				_tag: "SchemaChecked",
				name: "app",
				change: "created",
				verdict: "write",
				blocked: false,
			});
			assert.strictEqual(first?._tag === "SchemaDone" ? first.report.name : "", "app");
			assert.strictEqual(second?._tag === "SchemaDone" ? second.report.name : "", "other");
		}).pipe(Effect.provide(volume(seedConfig))),
	);

	it.effect("the first schema's event arrives before the second schema's check starts", () =>
		Effect.gen(function* () {
			const log: Array<string> = [];
			// The second validation waits for the first schema's event, so a run that
			// held its events until after the walk could never finish.
			const firstChecked = yield* Deferred.make<void>();
			let validations = 0;
			const latched = Layer.succeed(SchemaValidator, {
				validate: () =>
					Effect.gen(function* () {
						validations++;
						log.push(`validate ${validations}`);
						if (validations === 2) {
							yield* Deferred.await(firstChecked);
						}
						return [];
					}),
			});
			const config = defineConfig({
				name: "test",
				outputDir: "schemas",
				baseUrl: BASE,
				schemas: { app: { schema: Fixture }, other: { schema: Changed } },
			});
			yield* SchemaRun.run(
				input(),
				deps(config, {
					validator: latched,
					onProgress: (event) =>
						Effect.gen(function* () {
							log.push(event._tag === "SchemaChecked" ? `checked ${event.name}` : event._tag);
							if (event._tag === "SchemaChecked" && event.name === "app") {
								yield* Deferred.succeed(firstChecked, undefined);
							}
						}),
				}),
			);
			assert.deepStrictEqual(log, [
				"Started",
				"validate 1",
				"checked app",
				"validate 2",
				"checked other",
				"SchemaDone",
				"SchemaDone",
			]);
		}).pipe(Effect.provide(volume(seedConfig))),
	);

	it.effect("a document with conflict markers is stale with a raw diff", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const conflicted = `<<<<<<< HEAD\n${emitted(Fixture)}=======\n${emitted(Changed)}>>>>>>> branch\n`;
			yield* fs.writeFileString(DOC_PATH, conflicted);
			const result = yield* SchemaRun.run(input(), deps(configOf(Fixture)));
			assert.strictEqual(result.verdict, "stale");
			const unified = result.report.schemas[0]?.diff?.unified ?? "";
			assert.include(unified, "-<<<<<<< HEAD");
			assert.include(unified, "->>>>>>> branch");
			assert.strictEqual(yield* fs.readFileString(DOC_PATH), conflicted);
		}).pipe(Effect.provide(volume({ ...seedConfig, [DOC_PATH]: "" }))),
	);

	it.effect("a document with a BOM is compared without a false change", () =>
		Effect.gen(function* () {
			const result = yield* SchemaRun.run(input(), deps(configOf(Fixture)));
			assert.strictEqual(result.verdict, "ok");
			assert.strictEqual(result.report.schemas[0]?.change, "none");
			assert.isFalse("diff" in (result.report.schemas[0] ?? {}));
		}).pipe(Effect.provide(volume({ ...seedConfig, [DOC_PATH]: `\uFEFF${emitted(Fixture)}` }))),
	);

	// Core's `readFileString` decodes through `TextDecoder`, which drops a BOM, so
	// the case above never reaches the runner with one. This fault delivers the
	// text a `FileSystem` that keeps the BOM would, and pins the runner's own strip.
	it.effect("a changed document read with its BOM diffs only the real change", () =>
		Effect.gen(function* () {
			const result = yield* SchemaRun.run(input(), deps(configOf(Changed)));
			assert.notStrictEqual(result.report.schemas[0]?.change, "created");
			const removed = result.report.schemas[0]?.diff?.hunks
				.flatMap((hunk) => hunk.lines)
				.filter((line) => line.kind === "remove")
				.map((line) => line.text);
			assert.isFalse(removed?.some((text) => text.includes("\uFEFF")));
			assert.isAbove(removed?.length ?? 0, 0);
			assert.isBelow(removed?.length ?? 0, emitted(Fixture).split("\n").length / 2);
		}).pipe(
			Effect.provide(
				Layer.merge(
					base,
					MemoryFileSystem.layerWith(
						{ ...seedConfig, [DOC_PATH]: emitted(Fixture) },
						{
							faults: {
								readFileString: (path) => (path === DOC_PATH ? Effect.succeed(`\uFEFF${emitted(Fixture)}`) : undefined),
							},
						},
					),
				),
			),
		),
	);

	// A validator that refuses every document, for the verdict-order cases.
	const refusing = Layer.succeed(SchemaValidator, {
		validate: () => Effect.succeed([ValidationFinding.make({ path: "", message: "no" })]),
	});

	it.effect("a gate failure outranks staleness", () =>
		Effect.gen(function* () {
			const result = yield* SchemaRun.run(input(), deps(configOf(Fixture), { validator: refusing }));
			assert.strictEqual(result.report.schemas[0]?.change, "created");
			assert.strictEqual(result.verdict, "gate-failed");
		}).pipe(Effect.provide(volume(seedConfig))),
	);

	it.effect("a gate failure outranks drift, and drift outranks a blocked catalog", () =>
		Effect.gen(function* () {
			const config = defineConfig({
				name: "test",
				outputDir: "schemas",
				baseUrl: BASE,
				schemas: { app: { schema: Changed, published: true } },
			});
			const gated = yield* SchemaRun.run(input(), deps(config, { validator: refusing }));
			assert.isTrue(gated.report.drifted);
			assert.strictEqual(gated.verdict, "gate-failed");
			const drifted = yield* SchemaRun.run(input(), deps(config));
			assert.strictEqual(drifted.report.catalog?.merged?.outcome, "blocked");
			assert.strictEqual(drifted.verdict, "drift");
		}).pipe(
			Effect.provide(volume({ ...seedConfig, [DOC_PATH]: emitted(Fixture), "/repo/schemas/catalogs/bad.json": "{" })),
		),
	);

	it.effect("drift under onDrift error is verdict drift, and warn lets a build through", () =>
		Effect.gen(function* () {
			const config = defineConfig({
				name: "test",
				outputDir: "schemas",
				baseUrl: BASE,
				schemas: { app: { schema: Changed, published: true } },
			});
			const refused = yield* SchemaRun.run(input(), deps(config));
			assert.strictEqual(refused.verdict, "drift");
			const warned = yield* SchemaRun.run(input({ mode: "build", onDrift: "warn" }), deps(config));
			assert.strictEqual(warned.verdict, "ok");
			assert.isTrue(warned.report.drifted);
		}).pipe(Effect.provide(volume({ ...seedConfig, [DOC_PATH]: emitted(Fixture) }))),
	);

	it.effect("a blocked merged catalog is verdict catalog-blocked under both modes", () =>
		Effect.gen(function* () {
			const config = defineConfig({
				name: "test",
				outputDir: "schemas",
				baseUrl: BASE,
				schemas: { app: { schema: Fixture, catalog: { description: "App", fileMatch: ["app.json"] } } },
			});
			const checked = yield* SchemaRun.run(input(), deps(config));
			assert.strictEqual(checked.verdict, "catalog-blocked");
			const built = yield* SchemaRun.run(input({ mode: "build" }), deps(config));
			assert.strictEqual(built.verdict, "catalog-blocked");
		}).pipe(
			Effect.provide(volume({ ...seedConfig, [DOC_PATH]: emitted(Fixture), "/repo/schemas/catalogs/bad.json": "{" })),
		),
	);

	it.effect("an orphaned output is stale under check and ok under build", () =>
		Effect.gen(function* () {
			const config = defineConfig({
				name: "test",
				outputDir: "schemas",
				baseUrl: BASE,
				schemas: { app: { schema: Fixture } },
			});
			const checked = yield* SchemaRun.run(input(), deps(config));
			assert.strictEqual(checked.verdict, "stale");
			const built = yield* SchemaRun.run(input({ mode: "build" }), deps(config));
			assert.strictEqual(built.verdict, "ok");
		}).pipe(
			Effect.provide(volume({ ...seedConfig, [DOC_PATH]: emitted(Fixture), "/repo/schemas/catalogs/test.json": "[]" })),
		),
	);

	it.effect("a run does not touch GITHUB_STEP_SUMMARY, which is the CLI's to append", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const result = yield* SchemaRun.run(input(), deps(configOf(Changed)));
			assert.isFalse(yield* fs.exists("/summary.md"));
			// The control: the sink is live, and the report renders the fenced diff.
			assert.isTrue(yield* StepSummary.append(Report.markdown(result.report)));
			const summary = yield* fs.readFileString("/summary.md");
			assert.include(summary, "### effected schema check");
			assert.include(summary, "```diff");
		}).pipe(
			Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { GITHUB_STEP_SUMMARY: "/summary.md" } }))),
			Effect.provide(volume({ ...seedConfig, [DOC_PATH]: emitted(Fixture) })),
		),
	);

	it.effect("the result encodes and decodes through its own schema", () =>
		Effect.gen(function* () {
			const result = yield* SchemaRun.run(input(), deps(configOf(Changed)));
			const encoded = Schema.encodeSync(RunReport)(result.report);
			const again = Schema.decodeUnknownSync(RunReport)(JSON.parse(JSON.stringify(encoded)));
			assert.deepStrictEqual(Schema.encodeSync(RunReport)(again), encoded);
			assert.deepStrictEqual(JSON.parse(Report.json(again)), JSON.parse(Report.json(result.report)));
		}).pipe(Effect.provide(volume({ ...seedConfig, [DOC_PATH]: emitted(Fixture) }))),
	);
});
