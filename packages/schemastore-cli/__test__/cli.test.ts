import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { SchemastoreConfig } from "@effected/schemastore";
import {
	SchemaTarget,
	SchemaValidator,
	SchemaVersioning,
	StoreDocument,
	ValidationFinding,
	defineConfig,
} from "@effected/schemastore";
import { Effect, FileSystem, Layer, Path, Result, Runtime, Schema, Stdio, Terminal } from "effect";
import { TestConsole } from "effect/testing";
import type { Command } from "effect/unstable/cli";
import { CliError } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";
import { ConfigLoadError, ConfigNotFoundError } from "../src/ConfigLoader.js";
import { DriftError, GateError } from "../src/cli/execute.js";
import type { ProgramDeps } from "../src/cli/program.js";
import { loggerLayer, program } from "../src/cli/program.js";

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
const CATALOG_PATH = "/repo/schemas/catalog-entry.json";
const CONFIG_PATH = "/repo/schemastore.config.ts";

const basicConfig = (options: { readonly drift?: Partial<SchemastoreConfig["drift"]> } = {}) =>
	defineConfig({
		schemas: [
			SchemaTarget.make({
				schema: Config,
				$id: BASIC_ID,
				name: "basic",
				version: Result.getOrThrow(SchemaVersioning.parseResult("1.0")),
				path: "schemas/basic-1.0.json",
				// Published: the drift policy holds it to its version.
				published: true,
			}),
		],
		catalog: [
			{
				name: "basic",
				description: "basic fixture",
				fileMatch: ["basic.json"],
				baseUrl: "https://example.com/schemas",
				path: "schemas/catalog-entry.json",
			},
		],
		...(options.drift !== undefined ? { drift: options.drift } : {}),
	});

const deps = (config: SchemastoreConfig, overrides: Partial<ProgramDeps> = {}): ProgramDeps => ({
	cwd: "/repo",
	env: {},
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

const run = <A, E>(effect: Effect.Effect<A, E, Command.Environment>, seed: MemoryFileSystemSeed = {}) =>
	effect.pipe(Effect.provide(environment(seed)), Effect.provide(loggerLayer));

const exitCodeOf = (error: unknown): number => Runtime.getErrorExitCode(error);

describe("schemastore CLI", () => {
	it.effect("check discovers the config from cwd and reports what build would write", () =>
		run(
			Effect.gen(function* () {
				yield* program(["check"], deps(basicConfig()));
				const out = yield* stdout;
				assert.include(out, `would write (created) ${BASIC_PATH}`);
				assert.include(out, `would write catalog ${CATALOG_PATH}`);
				assert.include(
					out,
					"1 schema(s): 0 written, 0 unchanged, 0 drift, 0 gate failed — drift policy semantic/error (config)",
				);
				const fs = yield* FileSystem.FileSystem;
				assert.isFalse(yield* fs.exists(BASIC_PATH), "check never writes");
			}),
			{ [CONFIG_PATH]: "" },
		),
	);

	it.effect("build with an explicit config path writes the schema and the catalog entry", () =>
		run(
			Effect.gen(function* () {
				yield* program(["build", "lib/schemastore.config.ts"], deps(basicConfig()));
				const fs = yield* FileSystem.FileSystem;
				assert.isTrue(yield* fs.exists("/repo/lib/schemas/basic-1.0.json"));
				assert.isTrue(yield* fs.exists("/repo/lib/schemas/catalog-entry.json"));
				const out = yield* stdout;
				assert.include(out, "written (created) /repo/lib/schemas/basic-1.0.json");
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
				assert.include(error.message, "1 published schema(s) drifted");
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
				assert.include(out, `written (contract) ${BASIC_PATH}`);
				assert.include(
					out,
					"1 schema(s): 1 written, 0 unchanged, 1 drift, 0 gate failed — drift policy semantic/warn (flag)",
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

	it.effect("--force rewrites the published document and warns about it", () =>
		run(
			Effect.gen(function* () {
				yield* program(["build", "--force"], deps(basicConfig()));
				const fs = yield* FileSystem.FileSystem;
				assert.strictEqual(yield* fs.readFileString(BASIC_PATH), emitted(Config, BASIC_ID));
				const out = yield* stdout;
				assert.include(
					out,
					"1 schema(s): 1 written, 0 unchanged, 0 drift, 0 gate failed — drift policy allow/error (flag)",
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
				yield* program(["check", "--format=json"], deps(basicConfig()));
				const out = yield* stdout;
				assert.strictEqual(out.length, 1, out.join("\n"));
				const doc = JSON.parse(out[0] as string) as { mode: string; schemas: ReadonlyArray<{ outcome: string }> };
				assert.strictEqual(doc.mode, "check");
				assert.strictEqual(doc.schemas[0]?.outcome, "would-write");
				const err = yield* stderr;
				assert.include(err, `would write (created) ${BASIC_PATH}`);
			}),
			{ [CONFIG_PATH]: "" },
		),
	);

	it.effect("appends the markdown summary when GITHUB_STEP_SUMMARY is set", () =>
		run(
			Effect.gen(function* () {
				yield* program(["check"], deps(basicConfig(), { env: { GITHUB_STEP_SUMMARY: "/summary.md" } }));
				const fs = yield* FileSystem.FileSystem;
				assert.include(yield* fs.readFileString("/summary.md"), "### schemastore check");
			}),
			{ [CONFIG_PATH]: "" },
		),
	);

	it.effect("the config's own drift block is honoured when no flag overrides it", () =>
		run(
			Effect.gen(function* () {
				yield* program(["build"], deps(basicConfig({ drift: { onDrift: "warn" } })));
				const out = yield* stdout;
				assert.include(
					out,
					"1 schema(s): 1 written, 0 unchanged, 1 drift, 0 gate failed — drift policy semantic/warn (config)",
				);
			}),
			driftedSeed,
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
