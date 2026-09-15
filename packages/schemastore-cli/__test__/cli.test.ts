import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { OnDrift, SchemastoreConfig } from "@effected/schemastore";
import { CatalogEntry, SchemaValidator, StoreDocument, ValidationFinding, defineConfig } from "@effected/schemastore";
import { ConfigProvider, Effect, FileSystem, Layer, Path, Result, Runtime, Schema, Stdio, Terminal } from "effect";
import { TestConsole } from "effect/testing";
import type { Command } from "effect/unstable/cli";
import { CliError } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";
import { ConfigLoadError, ConfigNotFoundError } from "../src/ConfigLoader.js";
import { ConflictingFlagsError, DriftError, GateError, StaleError } from "../src/cli/execute.js";
import type { ProgramDeps } from "../src/cli/program.js";
import { loggerLayer, program } from "../src/cli/program.js";
import { FrozenVersionIdMismatchError, FrozenVersionMissingError } from "../src/Runner.js";

// ── Environment ───────────────────────────────────────────────────────────
//
// `Command.Environment` from the `Command.ts` doc example, with memfs in
// place of `FileSystem.layerNoop`. Provided ONCE around each test's whole
// program so the assertions read the same volume the command wrote.
const environment = (seed: MemoryFileSystemSeed = {}) =>
	Layer.mergeAll(
		MemoryFileSystem.layerWith(seed),
		Path.layer,
		Stdio.layerTest({}),
		Layer.succeed(
			Terminal.Terminal,
			Terminal.make({
				columns: Effect.succeed(80),
				rows: Effect.succeed(24),
				readInput: Effect.die("unused"),
				readLine: Effect.die("unused"),
				display: () => Effect.void,
			}),
		),
		Layer.succeed(
			ChildProcessSpawner.ChildProcessSpawner,
			ChildProcessSpawner.make(() => Effect.die("unused")),
		),
	);

const stdout = Effect.map(TestConsole.logLines, (lines) => lines.map(String));
const stderr = Effect.map(TestConsole.errorLines, (lines) => lines.map(String));

// ── Fixtures ──────────────────────────────────────────────────────────────

const Config = Schema.Struct({ name: Schema.String });
// One more required member: a successor generated from `Config` is a CONTRACT change.
const Wider = Schema.Struct({ name: Schema.String, extra: Schema.String });

const emitted = (schema: Schema.Constraint, $id: string): string =>
	Result.getOrThrow(Result.getOrThrow(StoreDocument.fromSchemaResult(schema, { $id })).serializeResult());

const BASIC_ID = "https://example.com/schemas/basic-1.0.json";
const BASIC_PATH = "/repo/schemas/basic-1.0.json";
const CATALOG_PATH = "/repo/schemas/catalog.json";
const CONFIG_PATH = "/repo/schemastore.config.ts";

const basicConfig = (options: { readonly onDrift?: OnDrift; readonly versions?: ReadonlyArray<string> } = {}) =>
	defineConfig({
		outputDir: "/repo/schemas",
		baseUrl: "https://example.com/schemas",
		...(options.onDrift !== undefined ? { onDrift: options.onDrift } : {}),
		schemas: {
			basic: {
				schema: Config,
				layout: "flat",
				// Published: the drift policy holds it to its version.
				published: true,
				versions: options.versions ?? ["1.0"],
				catalog: { description: "basic fixture", fileMatch: ["basic.json"] },
			},
		},
	});

const deps = (config: SchemastoreConfig, overrides: Partial<ProgramDeps> = {}): ProgramDeps => ({
	cwd: "/repo",
	importModule: () => Promise.resolve({ default: config }),
	version: "0.0.0",
	...overrides,
});

// The published document on disk was generated from the wider contract, so
// regenerating from `Config` is a contract change at a published version.
const driftedSeed: MemoryFileSystemSeed = { [CONFIG_PATH]: "", [BASIC_PATH]: emitted(Wider, BASIC_ID) };

const rejectEverything = SchemaValidator.layerTest({
	validate: () => Effect.succeed([ValidationFinding.make({ path: "/type", message: "rejected", keyword: "type" })]),
});

// The env is a `ConfigProvider`, swapped here so nothing reads the process:
// empty by default, which is the "GITHUB_STEP_SUMMARY unset" case.
const run = <A, E>(
	effect: Effect.Effect<A, E, Command.Environment>,
	seed: MemoryFileSystemSeed = {},
	env: Record<string, string> = {},
) =>
	effect.pipe(
		Effect.provide(environment(seed)),
		Effect.provide(loggerLayer),
		Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
	);

const exitCodeOf = (error: unknown): number => Runtime.getErrorExitCode(error);

// `check` fails on a stale tree by design; tests about SOME OTHER property
// of a stale check (its stdout shape, the step summary) tolerate exactly
// that error and nothing else.
const tolerateStale = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.catchIf(
			(error) => error instanceof StaleError,
			() => Effect.void,
		),
	);

// The fresh-volume seed plus the exact documents a `build` writes, so a
// `check` over it is clean.
const catalogEntryOf = (config: SchemastoreConfig): CatalogEntry => {
	const entry = config.schemas[0]?.catalog;
	assert.isDefined(entry, "the basic config always declares a catalog entry");
	return entry;
};

const builtSeed: MemoryFileSystemSeed = {
	[CONFIG_PATH]: "",
	[BASIC_PATH]: emitted(Config, BASIC_ID),
	[CATALOG_PATH]: `${JSON.stringify([Schema.encodeSync(CatalogEntry)(catalogEntryOf(basicConfig()))])}\n`,
};

describe("schemastore CLI", () => {
	it.effect("check on a fresh volume reports what build would write and fails stale at exit 1", () =>
		run(
			Effect.gen(function* () {
				const error = yield* Effect.flip(program(["check"], deps(basicConfig())));
				assert.instanceOf(error, StaleError);
				assert.strictEqual(exitCodeOf(error), 1);
				assert.strictEqual(error.count, 2, "one schema plus one catalog entry");
				assert.include(error.message, "2 document(s) are stale");
				const out = yield* stdout;
				assert.include(out, `would write (created) ${BASIC_PATH} [policy semantic]`);
				assert.include(out, `would write catalog ${CATALOG_PATH} (1 entries)`);
				assert.include(
					out,
					"1 schema(s): 0 written, 0 unchanged, 0 drift, 0 gate failed — drift per schema (config), on-drift error",
				);
				const fs = yield* FileSystem.FileSystem;
				assert.isFalse(yield* fs.exists(BASIC_PATH), "check never writes");
			}),
			{ [CONFIG_PATH]: "" },
		),
	);

	it.effect("check over the exact generated documents exits 0", () =>
		run(
			Effect.gen(function* () {
				yield* program(["check"], deps(basicConfig()));
				const out = yield* stdout;
				assert.include(out, `unchanged ${BASIC_PATH} [policy semantic]`);
				assert.include(out, `unchanged catalog ${CATALOG_PATH} (1 entries)`);
			}),
			builtSeed,
		),
	);

	it.effect("check with only a stale catalog entry fails stale at exit 1", () =>
		run(
			Effect.gen(function* () {
				const error = yield* Effect.flip(program(["check"], deps(basicConfig())));
				assert.instanceOf(error, StaleError);
				assert.strictEqual(exitCodeOf(error), 1);
				assert.strictEqual(error.count, 1);
				const out = yield* stdout;
				assert.include(out, `unchanged ${BASIC_PATH} [policy semantic]`);
				assert.include(out, `would write catalog ${CATALOG_PATH} (1 entries)`);
			}),
			{ ...builtSeed, [CATALOG_PATH]: '{"name":"basic","description":"old"}\n' },
		),
	);

	it.effect("build over the exact generated documents changes nothing and exits 0", () =>
		run(
			Effect.gen(function* () {
				yield* program(["build"], deps(basicConfig()));
				const out = yield* stdout;
				assert.include(out, `unchanged ${BASIC_PATH} [policy semantic]`);
				assert.include(out, `unchanged catalog ${CATALOG_PATH} (1 entries)`);
			}),
			builtSeed,
		),
	);

	it.effect("build with an explicit config path writes the schema and the catalog entry", () =>
		run(
			Effect.gen(function* () {
				// A relative `outputDir` resolves against the CONFIG's directory, not
				// `cwd` — the point of this test.
				const config = defineConfig({
					outputDir: "schemas",
					baseUrl: "https://example.com/schemas",
					schemas: {
						basic: {
							schema: Config,
							layout: "flat",
							published: true,
							versions: ["1.0"],
							catalog: { description: "basic fixture", fileMatch: ["basic.json"] },
						},
					},
				});
				yield* program(["build", "lib/schemastore.config.ts"], deps(config));
				const fs = yield* FileSystem.FileSystem;
				assert.isTrue(yield* fs.exists("/repo/lib/schemas/basic-1.0.json"));
				assert.isTrue(yield* fs.exists("/repo/lib/schemas/catalog.json"));
				const out = yield* stdout;
				assert.include(out, "written (created) /repo/lib/schemas/basic-1.0.json [policy semantic]");
			}),
			{ "/repo/lib/schemastore.config.ts": "" },
		),
	);

	it.effect("build with no config anywhere fails with ConfigNotFoundError at exit 2", () =>
		run(
			Effect.gen(function* () {
				const error = yield* Effect.flip(program(["build"], deps(basicConfig())));
				assert.instanceOf(error, ConfigNotFoundError);
				assert.strictEqual(exitCodeOf(error), 2);
			}),
			{ "/repo/.keep": "" },
		),
	);

	it.effect("a config module that throws fails with ConfigLoadError at exit 2, first stack line in the message", () =>
		run(
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					program(
						["build"],
						deps(basicConfig(), { importModule: () => Promise.reject(new Error("boom\n    at somewhere")) }),
					),
				);
				assert.instanceOf(error, ConfigLoadError);
				assert.strictEqual(exitCodeOf(error), 2);
				assert.include(error.message, "boom");
				assert.notInclude(error.message, "at somewhere");
			}),
			{ [CONFIG_PATH]: "" },
		),
	);

	it.effect("build refuses published contract drift under onDrift error: exit 1, file unchanged", () =>
		run(
			Effect.gen(function* () {
				const error = yield* Effect.flip(program(["build"], deps(basicConfig())));
				assert.instanceOf(error, DriftError);
				assert.strictEqual(exitCodeOf(error), 1);
				assert.strictEqual(error.count, 1);
				assert.deepStrictEqual(error.drifted, [
					{ $id: BASIC_ID, change: "contract", version: "1.0", nextVersion: "1.1" },
				]);
				assert.include(error.message, "1 published schema(s) drifted");
				assert.include(error.message, BASIC_ID);
				assert.include(error.message, "suggest 1.1");
				const fs = yield* FileSystem.FileSystem;
				assert.strictEqual(yield* fs.readFileString(BASIC_PATH), emitted(Wider, BASIC_ID));
				const out = yield* stdout;
				assert.isTrue(
					out.some((line) => line.startsWith("DRIFT contract at published 1.0 → suggest 1.1")),
					out.join("\n"),
				);
			}),
			driftedSeed,
		),
	);

	it.effect("--on-drift=warn writes the drifted schema, exits 0 and warns on stderr", () =>
		run(
			Effect.gen(function* () {
				yield* program(["build", "--on-drift=warn"], deps(basicConfig()));
				const fs = yield* FileSystem.FileSystem;
				assert.strictEqual(yield* fs.readFileString(BASIC_PATH), emitted(Config, BASIC_ID));
				const out = yield* stdout;
				assert.include(out, `written (contract) ${BASIC_PATH} [policy semantic]`);
				assert.include(
					out,
					"1 schema(s): 1 written, 0 unchanged, 1 drift, 0 gate failed — drift per schema (config), on-drift warn",
				);
				const err = yield* stderr;
				assert.isTrue(
					err.some((line) => line.includes("warning: DRIFT contract at published 1.0 written under --on-drift=warn")),
					err.join("\n"),
				);
			}),
			driftedSeed,
		),
	);

	it.effect("check refuses published contract drift like build and holds the catalog rather than would-write", () =>
		run(
			Effect.gen(function* () {
				const error = yield* Effect.flip(program(["check"], deps(basicConfig())));
				assert.instanceOf(error, DriftError);
				assert.strictEqual(exitCodeOf(error), 1);
				const fs = yield* FileSystem.FileSystem;
				assert.strictEqual(yield* fs.readFileString(BASIC_PATH), emitted(Wider, BASIC_ID));
				assert.isFalse(yield* fs.exists(CATALOG_PATH), "check never writes");
				const out = yield* stdout;
				assert.include(out, `held catalog ${CATALOG_PATH} (1 entries)`);
				assert.notInclude(out, `would write catalog ${CATALOG_PATH} (1 entries)`);
			}),
			driftedSeed,
		),
	);

	it.effect("check --on-drift=warn writes nothing, says what a build would write, and still fails stale", () =>
		run(
			Effect.gen(function* () {
				const error = yield* Effect.flip(program(["check", "--on-drift=warn"], deps(basicConfig())));
				assert.instanceOf(error, StaleError);
				const fs = yield* FileSystem.FileSystem;
				assert.strictEqual(yield* fs.readFileString(BASIC_PATH), emitted(Wider, BASIC_ID), "check never writes");
				const out = yield* stdout;
				assert.include(out, `would write catalog ${CATALOG_PATH} (1 entries)`);
				const err = yield* stderr;
				assert.isTrue(
					err.some((line) =>
						line.includes("warning: DRIFT contract at published 1.0 would write under --on-drift=warn"),
					),
					err.join("\n"),
				);
			}),
			driftedSeed,
		),
	);

	it.effect("--force rewrites the published document and warns about it", () =>
		run(
			Effect.gen(function* () {
				yield* program(["build", "--force"], deps(basicConfig()));
				const fs = yield* FileSystem.FileSystem;
				assert.strictEqual(yield* fs.readFileString(BASIC_PATH), emitted(Config, BASIC_ID));
				const out = yield* stdout;
				assert.include(
					out,
					"1 schema(s): 1 written, 0 unchanged, 0 drift, 0 gate failed — drift allow (flag), on-drift error",
				);
				const err = yield* stderr;
				assert.isTrue(
					err.some((line) => line.includes("--force")),
					err.join("\n"),
				);
			}),
			driftedSeed,
		),
	);

	it.effect("--force with --drift=strict is a usage error (exit 64) and writes nothing", () =>
		run(
			Effect.gen(function* () {
				const error = yield* Effect.flip(program(["build", "--force", "--drift=strict"], deps(basicConfig())));
				assert.instanceOf(error, ConflictingFlagsError);
				assert.strictEqual(exitCodeOf(error), 64);
				assert.include(error.message, "--force conflicts with --drift=strict");
				const fs = yield* FileSystem.FileSystem;
				assert.strictEqual(yield* fs.readFileString(BASIC_PATH), emitted(Wider, BASIC_ID), "nothing written");
			}),
			driftedSeed,
		),
	);

	it.effect("--force with --drift=allow is accepted (redundant, not conflicting)", () =>
		run(
			Effect.gen(function* () {
				yield* program(["build", "--force", "--drift=allow"], deps(basicConfig()));
				const fs = yield* FileSystem.FileSystem;
				assert.strictEqual(yield* fs.readFileString(BASIC_PATH), emitted(Config, BASIC_ID));
			}),
			driftedSeed,
		),
	);

	it.effect("a gate failure fails with GateError at exit 1 even under --on-drift=warn, writing nothing", () =>
		run(
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					program(["build", "--on-drift=warn"], deps(basicConfig(), { validator: rejectEverything })),
				);
				assert.instanceOf(error, GateError);
				assert.strictEqual(exitCodeOf(error), 1);
				const fs = yield* FileSystem.FileSystem;
				assert.isFalse(yield* fs.exists(BASIC_PATH));
				assert.isFalse(yield* fs.exists(CATALOG_PATH));
				const out = yield* stdout;
				assert.isTrue(
					out.some((line) => line.startsWith(`GATE FAILED ${BASIC_PATH}`)),
					out.join("\n"),
				);
			}),
			{ [CONFIG_PATH]: "" },
		),
	);

	it.effect("--format=json puts one parseable document on stdout and the human lines on stderr", () =>
		run(
			Effect.gen(function* () {
				yield* tolerateStale(program(["check", "--format=json"], deps(basicConfig())));
				const out = yield* stdout;
				assert.strictEqual(out.length, 1, out.join("\n"));
				const doc = JSON.parse(out[0] as string) as { mode: string; schemas: ReadonlyArray<{ outcome: string }> };
				assert.strictEqual(doc.mode, "check");
				assert.strictEqual(doc.schemas[0]?.outcome, "would-write");
				const err = yield* stderr;
				assert.include(err, `would write (created) ${BASIC_PATH} [policy semantic]`);
			}),
			{ [CONFIG_PATH]: "" },
		),
	);

	it.effect("appends the markdown summary when GITHUB_STEP_SUMMARY is set", () =>
		run(
			Effect.gen(function* () {
				yield* tolerateStale(program(["check"], deps(basicConfig())));
				const fs = yield* FileSystem.FileSystem;
				assert.include(yield* fs.readFileString("/summary.md"), "### schemastore check");
			}),
			{ [CONFIG_PATH]: "" },
			{ GITHUB_STEP_SUMMARY: "/summary.md" },
		),
	);

	it.effect("writes no summary when GITHUB_STEP_SUMMARY is unset", () =>
		run(
			Effect.gen(function* () {
				yield* tolerateStale(program(["check"], deps(basicConfig())));
				const fs = yield* FileSystem.FileSystem;
				assert.isFalse(yield* fs.exists("/summary.md"));
			}),
			{ [CONFIG_PATH]: "" },
		),
	);

	it.effect("--format=json keeps stdout to one document even with a warning in play", () =>
		run(
			Effect.gen(function* () {
				yield* tolerateStale(program(["check", "--format=json", "--force"], deps(basicConfig())));
				const out = yield* stdout;
				assert.strictEqual(out.length, 1, out.join("\n"));
				const doc = JSON.parse(out[0] as string) as { drift: { policy?: string } };
				assert.strictEqual(doc.drift.policy, "allow");
				const err = yield* stderr;
				assert.isTrue(
					err.some((line) => line.includes("--force") && line.includes("would be rewritten")),
					err.join("\n"),
				);
			}),
			driftedSeed,
		),
	);

	it.effect("check --force with --drift=strict is a usage error (exit 64) and writes nothing", () =>
		run(
			Effect.gen(function* () {
				const error = yield* Effect.flip(program(["check", "--force", "--drift=strict"], deps(basicConfig())));
				assert.instanceOf(error, ConflictingFlagsError);
				assert.strictEqual(exitCodeOf(error), 64);
				assert.include(error.message, "--force conflicts with --drift=strict");
				const fs = yield* FileSystem.FileSystem;
				assert.strictEqual(yield* fs.readFileString(BASIC_PATH), emitted(Wider, BASIC_ID), "nothing written");
			}),
			driftedSeed,
		),
	);

	it.effect("the config's own onDrift is honoured when no flag overrides it", () =>
		run(
			Effect.gen(function* () {
				yield* program(["build"], deps(basicConfig({ onDrift: "warn" })));
				const out = yield* stdout;
				assert.include(
					out,
					"1 schema(s): 1 written, 0 unchanged, 1 drift, 0 gate failed — drift per schema (config), on-drift warn",
				);
			}),
			driftedSeed,
		),
	);

	it.effect("a missing frozen version fails with FrozenVersionMissingError at exit 1", () =>
		run(
			Effect.gen(function* () {
				// `versions: ["0.9", "1.0"]` picks "1.0" as current (newest); "0.9"
				// becomes a frozen predecessor at the flat layout's own file name —
				// which the volume below does not carry.
				const error = yield* Effect.flip(program(["build"], deps(basicConfig({ versions: ["0.9", "1.0"] }))));
				assert.instanceOf(error, FrozenVersionMissingError);
				assert.strictEqual(exitCodeOf(error), 1);
				assert.strictEqual(error.missing[0]?.name, "basic");
				assert.strictEqual(error.missing[0]?.version, "0.9");
				assert.strictEqual(error.missing[0]?.path, "/repo/schemas/basic-0.9.json");
				assert.include(error.message, "/repo/schemas/basic-0.9.json");
				const fs = yield* FileSystem.FileSystem;
				assert.isFalse(yield* fs.exists(BASIC_PATH), "nothing is written before the frozen check clears");
			}),
			{ [CONFIG_PATH]: "" },
		),
	);

	it.effect("a frozen file whose $id disagrees with its URL fails with FrozenVersionIdMismatchError at exit 1", () =>
		run(
			Effect.gen(function* () {
				const error = yield* Effect.flip(program(["build"], deps(basicConfig({ versions: ["0.9", "1.0"] }))));
				assert.instanceOf(error, FrozenVersionIdMismatchError);
				assert.strictEqual(exitCodeOf(error), 1);
				assert.include(error.message, "/repo/schemas/basic-0.9.json");
				assert.include(error.message, "https://old.example.com/basic-0.9.json");
				const fs = yield* FileSystem.FileSystem;
				assert.isFalse(yield* fs.exists(BASIC_PATH), "nothing is written before the frozen check clears");
			}),
			{ [CONFIG_PATH]: "", "/repo/schemas/basic-0.9.json": emitted(Config, "https://old.example.com/basic-0.9.json") },
		),
	);

	it.effect("an orphaned catalog file is stale under check and reported but kept under build", () =>
		run(
			Effect.gen(function* () {
				const uncataloged = defineConfig({
					outputDir: "/repo/schemas",
					baseUrl: "https://example.com/schemas",
					schemas: { basic: { schema: Config, layout: "flat", published: true, versions: ["1.0"] } },
				});
				const error = yield* Effect.flip(program(["check"], deps(uncataloged)));
				assert.instanceOf(error, StaleError);
				assert.strictEqual(error.count, 1, "the orphan alone");
				assert.include(yield* stdout, `orphaned catalog ${CATALOG_PATH} (no schema declares a catalog)`);
				yield* program(["build"], deps(uncataloged));
				const fs = yield* FileSystem.FileSystem;
				assert.isTrue(yield* fs.exists(CATALOG_PATH), "build reports the orphan but never deletes it");
			}),
			builtSeed,
		),
	);

	describe("usage", () => {
		it.effect("--bogus is a usage error at exit 64", () =>
			run(
				Effect.gen(function* () {
					const error = yield* Effect.flip(program(["--bogus"], deps(basicConfig())));
					assert.instanceOf(error, CliError.ShowHelp);
					assert.isAbove(error.errors.length, 0);
					assert.strictEqual(exitCodeOf(error), 64);
				}),
			),
		);

		it.effect("no arguments shows help at exit 0", () =>
			run(
				Effect.gen(function* () {
					const error = yield* Effect.flip(program([], deps(basicConfig())));
					assert.instanceOf(error, CliError.ShowHelp);
					assert.strictEqual(error.errors.length, 0);
					assert.strictEqual(exitCodeOf(error), 0);
					const out = yield* stdout;
					assert.isTrue(
						out.some((line) => line.includes("build") && line.includes("check")),
						out.join("\n"),
					);
				}),
			),
		);

		it.effect("--drift=loose is a usage error at exit 64", () =>
			run(
				Effect.gen(function* () {
					const error = yield* Effect.flip(program(["build", "--drift=loose"], deps(basicConfig())));
					assert.instanceOf(error, CliError.ShowHelp);
					assert.strictEqual(exitCodeOf(error), 64);
				}),
				{ [CONFIG_PATH]: "" },
			),
		);
	});
});
