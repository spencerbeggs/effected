// The command as `bin.ts` runs it: under `CliRuntime.main`, with the kit's standard failure report. `cli.test.ts`
// drives `program` and its exit-code markers; this drives `run`, what `main` hands `NodeRuntime.runMain`, over the same
// in-memory `Command.Environment`, and reads what reaches stdout and stderr and the exit code the runtime would use.
import { assert, describe, it } from "@effect/vitest";
import { CliFailure, Render } from "@effected/cli";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { SchemastoreConfig } from "@effected/schemastore";
import { SchemaValidator, SchemaValidatorError, StoreDocument, defineConfig } from "@effected/schemastore";
import {
	Cause,
	ConfigProvider,
	Context,
	Effect,
	Exit,
	Layer,
	Path,
	Result,
	Runtime,
	Schema,
	Stdio,
	Terminal,
} from "effect";
import { ChildProcessSpawner } from "effect/process";
import { TestConsole } from "effect/testing";
import type { ProgramDeps } from "../src/cli/program.js";
import { loggerLayer, program } from "../src/cli/program.js";
import { mainOptions, run } from "../src/main.js";

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

const CONFIG_PATH = "/repo/schemastore.config.ts";

const config: SchemastoreConfig = defineConfig({
	name: "test",
	outputDir: "/repo/schemas",
	baseUrl: "https://example.com/schemas",
	schemas: {
		basic: {
			schema: Schema.Struct({ name: Schema.String }),
			layout: "flat",
			published: true,
			versions: ["1.0"],
		},
	},
});

const deps = (overrides: Partial<ProgramDeps> = {}): ProgramDeps => ({
	cwd: "/repo",
	importModule: () => Promise.resolve({ default: config }),
	version: "0.0.0",
	...overrides,
});

/** Run argv as `main` does, over the in-memory environment and an empty process environment. */
const runMain = (argv: ReadonlyArray<string>, seed: MemoryFileSystemSeed, overrides: Partial<ProgramDeps> = {}) =>
	Effect.gen(function* () {
		const exit = yield* Effect.exit(
			run(argv, deps(overrides), environment(seed)).pipe(
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
			),
		);
		const code = Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : 0;
		const out = (yield* TestConsole.logLines).map(String);
		const err = (yield* TestConsole.errorLines).map(String);
		return { code, out, err };
	});

describe("schemastore under CliRuntime.main", () => {
	it.effect("a missing config: exit 2, the kit's report on stderr, nothing on stdout", () =>
		Effect.gen(function* () {
			const { code, out, err } = yield* runMain(["build"], { "/repo/.keep": "" });
			assert.strictEqual(code, 2);
			assert.deepStrictEqual(out, []);
			const report = err.find((line) => line.startsWith("✗ "));
			assert.isDefined(report, `the failure is a status line: ${err.join(" | ")}`);
			assert.include(report, "schemastore.config", "it still says what was not found");
		}),
	);

	it.effect("published drift: exit 1, the human lines on stdout as before, the drift report on stderr", () =>
		Effect.gen(function* () {
			const wider = Schema.Struct({ name: Schema.String, extra: Schema.String });
			const text = Result.getOrThrow(
				Result.getOrThrow(
					StoreDocument.fromSchemaResult(wider, { $id: "https://example.com/schemas/basic-1.0.json" }),
				).serializeResult(),
			);
			const { code, out, err } = yield* runMain(["build"], {
				[CONFIG_PATH]: "",
				"/repo/schemas/basic-1.0.json": text,
			});
			assert.strictEqual(code, 1);
			assert.isTrue(
				out.some((line) => line.startsWith("DRIFT contract at published 1.0 → suggest 1.1")),
				out.join("\n"),
			);
			const report = err.join("\n");
			// The kit's standard report: a status line naming the error, its message's lines, and the command's own span.
			assert.match(report, /^✗ DriftError: 1 published schema\(s\) drifted; nothing was written\.$/m, report);
			assert.include(report, "https://example.com/schemas/basic-1.0.json: contract at published 1.0 → suggest 1.1");
			assert.match(report, /^in: schemastore\.execute$/m);
		}),
	);

	it.effect("drift with a held schema: stdout byte-identical to the program's own, the held line included", () =>
		Effect.gen(function* () {
			const wider = Schema.Struct({ name: Schema.String, extra: Schema.String });
			const two: SchemastoreConfig = defineConfig({
				name: "test",
				outputDir: "/repo/schemas",
				baseUrl: "https://example.com/schemas",
				schemas: {
					basic: { schema: Schema.Struct({ name: Schema.String }), layout: "flat", published: true, versions: ["1.0"] },
					other: { schema: Schema.Struct({ id: Schema.Number }), layout: "flat", published: true, versions: ["1.0"] },
				},
			});
			const text = Result.getOrThrow(
				Result.getOrThrow(
					StoreDocument.fromSchemaResult(wider, { $id: "https://example.com/schemas/basic-1.0.json" }),
				).serializeResult(),
			);
			const seed = { [CONFIG_PATH]: "", "/repo/schemas/basic-1.0.json": text };
			const viaMain = yield* runMain(["build"], seed, { importModule: () => Promise.resolve({ default: two }) });
			assert.strictEqual(viaMain.code, 1);
			// The same run through `program` alone, as `cli.test.ts` drives it: the stdout the old bin printed.
			const before = (yield* TestConsole.logLines).length;
			yield* Effect.exit(
				program(["build"], deps({ importModule: () => Promise.resolve({ default: two }) })).pipe(
					Effect.provide(environment(seed)),
					Effect.provide(loggerLayer),
					Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
				),
			);
			const viaProgram = (yield* TestConsole.logLines).slice(before).map(String);
			assert.isTrue(
				viaMain.out.some((line) => line.startsWith("held (drift elsewhere) /repo/schemas/other-1.0.json")),
				viaMain.out.join("\n"),
			);
			assert.deepStrictEqual(viaMain.out, viaProgram, "main changes nothing on stdout");
		}),
	);

	it.effect("help requested beside a parse error still exits 0: build --bogus --help", () =>
		Effect.gen(function* () {
			const { code, err } = yield* runMain(["build", "--bogus", "--help"], {});
			assert.strictEqual(code, 0);
			assert.isFalse(err.some((line) => line.startsWith("✗ ")));
		}),
	);

	it.effect("--wizard is the kit's gated flag: not interactive, it is a usage error at exit 64", () =>
		Effect.gen(function* () {
			const { code } = yield* runMain(["build", "--wizard"], { [CONFIG_PATH]: "" });
			assert.strictEqual(code, 64, "CliEnv's CliPrompt.gateWizard drops --wizard from a run nobody can answer");
			const help = yield* runMain(["--help"], {});
			assert.notInclude(help.out.join("\n"), "--wizard", "and leaves it out of non-interactive help");
		}),
	);

	it.effect("--on-drift=warn and --force: exit 0 and no failure report", () =>
		Effect.gen(function* () {
			for (const flag of ["--on-drift=warn", "--force"]) {
				const { code, err } = yield* runMain(["build", flag], { [CONFIG_PATH]: "" });
				assert.strictEqual(code, 0, flag);
				assert.isFalse(
					err.some((line) => line.startsWith("✗ ")),
					`${flag}: nothing failed: ${err.join(" | ")}`,
				);
			}
		}),
	);

	it.effect("--force with an explicit --drift=error is still a usage error at exit 64", () =>
		Effect.gen(function* () {
			const { code } = yield* runMain(["build", "--force", "--drift=error"], { [CONFIG_PATH]: "" });
			assert.strictEqual(code, 64);
		}),
	);

	it.effect("--help: exit 0, help on stdout, no failure report", () =>
		Effect.gen(function* () {
			const { code, out, err } = yield* runMain(["--help"], {});
			assert.strictEqual(code, 0);
			assert.isTrue(out.join("\n").includes("schemastore"), out.join("\n"));
			assert.isFalse(err.some((line) => line.startsWith("✗ ")));
		}),
	);

	it.effect(
		"a typed error with no code of its own (an engine mechanism failure) exits 3, the infrastructure tier",
		() =>
			Effect.gen(function* () {
				const broken = SchemaValidator.layerTest({
					validate: () => Effect.fail(new SchemaValidatorError({ cause: new Error("engine exploded") })),
				});
				const { code, err } = yield* runMain(["build"], { [CONFIG_PATH]: "" }, { validator: broken });
				assert.strictEqual(code, 3);
				assert.isTrue(
					err.some((line) => line.startsWith("✗ ")),
					`the kit's report, not a bare message: ${err.join(" | ")}`,
				);
			}),
	);
});

interface Frame {
	readonly name: string;
	readonly stack: () => string | undefined;
	readonly parent: Frame | undefined;
}

describe("the span trail of an installed schemastore", () => {
	it("main names its own module as the program's", () => {
		assert.strictEqual(mainOptions.env.appModule, new URL("../src/main.ts", import.meta.url).href);
		assert.strictEqual(mainOptions.exitCode, 3, "the documented infrastructure tier");
	});

	it("installed under node_modules/@effected, its own ConfigLoader spans survive the default app rule; the kit's go", () => {
		// What `import.meta.url` reads once installed: the built module in the package's own directory.
		const GLOBAL = "/usr/local/lib/node_modules";
		const appModule = `file://${GLOBAL}/@effected/schemastore-cli/dist/main.js`;
		const at = (file: string) => () => `at file://${file}`;
		const loaderDef: Frame = {
			name: "ConfigLoader.load (definition)",
			stack: at(`${GLOBAL}/@effected/schemastore-cli/dist/ConfigLoader.js:30:9`),
			parent: undefined,
		};
		const loader: Frame = { name: "ConfigLoader.load", stack: loaderDef.stack, parent: loaderDef };
		const kitDef: Frame = {
			name: "SchemaPipeline.run (definition)",
			stack: at(`${GLOBAL}/@effected/schemastore/dist/SchemaPipeline.js:12:3`),
			parent: loader,
		};
		const kit: Frame = { name: "SchemaPipeline.run", stack: kitDef.stack, parent: kitDef };
		const cause = Cause.fail(new Error("Config validation failed")).pipe(
			Cause.annotate(Context.make(Cause.StackTrace, kit)),
		);
		const trail = (options: Parameters<typeof CliFailure.toDoc>[1]) =>
			Render.plain(CliFailure.toDoc(cause, options), Render.contextOf({ audience: "agent" }))
				.split("\n")
				.filter((line) => line.startsWith("in: "))
				.join("\n");
		assert.strictEqual(trail({ appModule }), "in: ConfigLoader.load");
		assert.strictEqual(trail({}), "", "control: without appModule the companion's spans go with the kit's");
		assert.strictEqual(trail({ appModule, spans: "all" }), "in: ConfigLoader.load > SchemaPipeline.run");
	});
});
