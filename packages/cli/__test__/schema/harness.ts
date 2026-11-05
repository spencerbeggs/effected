// The command as `bin.ts` runs it, under `CliRuntime.main`, over an in-memory `Command.Environment`: argv through
// `Stdio.layerTest`, one pinned memfs volume to read back, and an environment that never reads the host's.
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { SchemastoreConfig } from "@effected/schemastore";
import { StoreDocument, defineConfig } from "@effected/schemastore";
import type { FileSystem } from "effect";
import { Cause, ConfigProvider, Effect, Exit, Layer, Path, Result, Runtime, Schema, Stdio, Terminal } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { TestConsole } from "effect/testing";
import type { SchemaCommandDeps } from "../../src/commands/schema/execute.js";
import { run } from "../../src/main.js";

export const Config = Schema.Struct({ name: Schema.String });
// One more required member: a successor generated from `Config` is a CONTRACT change.
export const Wider = Schema.Struct({ name: Schema.String, extra: Schema.String });

export const emitted = (schema: Schema.Constraint, $id: string): string =>
	Result.getOrThrow(Result.getOrThrow(StoreDocument.fromSchemaResult(schema, { $id })).serializeResult());

export const BASIC_ID = "https://example.com/schemas/basic-1.0.json";
export const BASIC_PATH = "/repo/schemas/basic-1.0.json";
export const CATALOG_PATH = "/repo/schemas/catalog.json";
export const SLICE_PATH = "/repo/schemas/catalogs/test.json";
export const CONFIG_PATH = "/repo/schemastore.config.ts";

export const basicConfig = (
	options: {
		readonly onDrift?: SchemastoreConfig["onDrift"];
		readonly versions?: ReadonlyArray<string>;
		readonly outputDir?: string;
	} = {},
) =>
	defineConfig({
		name: "test",
		outputDir: options.outputDir ?? "/repo/schemas",
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

export const depsFor = (config: unknown, overrides: Partial<SchemaCommandDeps> = {}): SchemaCommandDeps => ({
	cwd: "/repo",
	importModule: () => Promise.resolve({ default: config }),
	...overrides,
});

/** Which standard streams are terminals. All false by default: a pipe. */
export interface Ttys {
	readonly stdin?: boolean;
	readonly stdout?: boolean;
	readonly stderr?: boolean;
}

/** `Command.Environment` for one run. `terminal` replaces the inert `Terminal`. */
export const environment = (
	args: ReadonlyArray<string>,
	files: Layer.Layer<FileSystem.FileSystem>,
	ttys: Ttys = {},
	terminal?: Layer.Layer<Terminal.Terminal>,
) =>
	Layer.mergeAll(
		files,
		Path.layer,
		Stdio.layerTest({
			args: Effect.succeed(args),
			stdinIsTerminal: Effect.succeed(ttys.stdin ?? false),
			stdoutIsTerminal: Effect.succeed(ttys.stdout ?? false),
			stderrIsTerminal: Effect.succeed(ttys.stderr ?? false),
		}),
		terminal ??
			Layer.succeed(
				Terminal.Terminal,
				Terminal.make({
					columns: Effect.succeed(80),
					rows: Effect.succeed(24),
					size: Effect.die("unused"),
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

export interface CliOptions {
	readonly seed?: MemoryFileSystemSeed;
	readonly deps: SchemaCommandDeps;
	readonly env?: Record<string, string>;
	readonly ttys?: Ttys;
	readonly terminal?: Layer.Layer<Terminal.Terminal>;
}

/**
 * Run argv once. `TestConsole` accumulates across a test, so each result holds this run's lines alone: `out` and `err`
 * are one line per array entry, a `Doc.print` split at its embedded breaks.
 */
export const runCli = (args: ReadonlyArray<string>, options: CliOptions) =>
	Effect.gen(function* () {
		const handle = yield* MemoryFileSystem.makeHandle(options.seed ?? {});
		const outBefore = (yield* TestConsole.logLines).length;
		const errBefore = (yield* TestConsole.errorLines).length;
		const exit = yield* Effect.exit(
			run({}, options.deps, environment(args, handle.layer, options.ttys, options.terminal)).pipe(
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: options.env ?? {} }))),
			),
		);
		const code = Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : 0;
		const lines = (entries: ReadonlyArray<unknown>) => entries.map(String).join("\n").split("\n");
		const outText = (yield* TestConsole.logLines).slice(outBefore).map(String);
		const errText = (yield* TestConsole.errorLines).slice(errBefore).map(String);
		return {
			code,
			/** Each `Console.log` call as written. */
			stdoutCalls: outText,
			out: outText.length === 0 ? [] : lines(outText),
			err: errText.length === 0 ? [] : lines(errText),
			volume: handle.volume,
		};
	});

/** `\x1b[`, the opening of every ANSI sequence. */
export const ANSI = "\u001b[";
