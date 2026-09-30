import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Audience, CurrentRuntimeEnv, TerminalEnv } from "@effected/env";
import { Cause, ConfigProvider, Console, Effect, Exit, Layer, Runtime, Stdio, Terminal } from "effect";
import { Command } from "effect/cli";
import { CliEnv, CliInteractive, CliRuntime, CliTheme } from "../src/index.js";

const capturing = () => {
	const out: string[] = [];
	const err: string[] = [];
	const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { double, out, err };
};

/** `Stdio` and `Terminal` doubles: the requirements `CliEnv.layer` leaves to the platform. */
const platform = (io: {
	readonly stdin: boolean;
	readonly stdout: boolean;
	readonly columns?: Effect.Effect<number>;
}) =>
	Layer.mergeAll(
		Stdio.layerTest({ stdinIsTerminal: Effect.succeed(io.stdin), stdoutIsTerminal: Effect.succeed(io.stdout) }),
		Layer.succeed(
			Terminal.Terminal,
			Terminal.make({
				columns: io.columns ?? Effect.succeed(80),
				rows: Effect.succeed(24),
				readInput: Effect.die("unused"),
				readLine: Effect.die("unused"),
				display: () => Effect.void,
			}),
		),
	);

const TTY = platform({ stdin: true, stdout: true });
const PIPED = platform({ stdin: false, stdout: false });

const withEnv = (env: Record<string, string>) => ConfigProvider.fromUnknown(env);

describe("CliEnv.layer", () => {
	it.effect("builds every service, and the audience honours the env var", () =>
		Effect.gen(function* () {
			const runtime = yield* CurrentRuntimeEnv;
			const terminal = yield* TerminalEnv;
			const audience = yield* Audience;
			const theme = yield* CliTheme;
			const interactive = yield* CliInteractive;
			assert.isDefined(runtime);
			assert.strictEqual(terminal.stdinIsTerminal, true);
			assert.deepStrictEqual(audience, { kind: "agent", source: "override" });
			assert.strictEqual(theme.color, "none");
			// An agent audience is never interactive, even on a terminal.
			assert.strictEqual(interactive, false);
		}).pipe(
			Effect.provide(CliEnv.layer({ audienceEnvVar: "OKFIT_AUDIENCE" })),
			Effect.provide(TTY),
			Effect.provideService(ConfigProvider.ConfigProvider, withEnv({ OKFIT_AUDIENCE: "agent" })),
		),
	);

	it.effect("a human on a terminal is interactive, and the theme follows the terminal's colour", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* CliInteractive, true);
			assert.strictEqual((yield* Audience).kind, "human");
			assert.strictEqual((yield* CliTheme).color, "256");
		}).pipe(
			Effect.provide(CliEnv.layer()),
			Effect.provide(TTY),
			Effect.provideService(ConfigProvider.ConfigProvider, withEnv({ TERM: "xterm-256color" })),
		),
	);

	it.effect("piped stdin or stdout is not interactive", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* CliInteractive, false);
		}).pipe(
			Effect.provide(CliEnv.layer()),
			Effect.provide(PIPED),
			Effect.provideService(ConfigProvider.ConfigProvider, withEnv({})),
		),
	);
});

describe("CliRuntime.main with the env option", () => {
	const observe = (program: Effect.Effect<void, never, CliTheme | Audience | TerminalEnv>) =>
		Effect.gen(function* () {
			const { double, out, err } = capturing();
			const exit = yield* CliRuntime.main(program, { platform: TTY, env: {} }).pipe(
				Effect.exit,
				Effect.provideService(ConfigProvider.ConfigProvider, withEnv({})),
				Effect.provideService(Console.Console, double),
			);
			return { out, err, exit };
		});

	it.effect("a program needing the env services typechecks and runs with no requirement left over", () =>
		Effect.gen(function* () {
			const seen: Array<string> = [];
			const program = Effect.gen(function* () {
				seen.push((yield* Audience).kind, String(yield* CliInteractive), (yield* CliTheme).color);
				yield* TerminalEnv;
			});
			// `observe` returns an effect with R = never: a leaked requirement would not compile here.
			const { exit } = yield* observe(program);
			assert.isTrue(Exit.isSuccess(exit));
			assert.deepStrictEqual(seen, ["human", "true", "none"]);
		}),
	);

	// Forgetting the wiring silently yields a non-interactive run, so this pins that main really sets it.
	it.effect("under a human on a stdin and stdout terminal the program observes CliInteractive === true", () =>
		Effect.gen(function* () {
			let interactive: boolean | undefined;
			yield* observe(
				Effect.gen(function* () {
					interactive = yield* CliInteractive;
				}),
			);
			assert.strictEqual(interactive, true);
		}),
	);

	it.effect("without the env option nothing is provided and CliInteractive keeps its non-interactive default", () =>
		Effect.gen(function* () {
			let interactive: boolean | undefined;
			const { double } = capturing();
			yield* CliRuntime.main(
				Effect.gen(function* () {
					interactive = yield* CliInteractive;
				}),
				{ platform: TTY },
			).pipe(Effect.exit, Effect.provideService(Console.Console, double));
			assert.strictEqual(interactive, false);
		}),
	);

	it.effect("a failure building the env layer is one line and the exitCode option, not a stack", () =>
		Effect.gen(function* () {
			const { double, out, err } = capturing();
			const broken = platform({ stdin: true, stdout: true, columns: Effect.die(new Error("tty broke")) });
			const exit = yield* CliRuntime.main(Effect.void, { platform: broken, env: {}, exitCode: 3 }).pipe(
				Effect.exit,
				Effect.provideService(ConfigProvider.ConfigProvider, withEnv({})),
				Effect.provideService(Console.Console, double),
			);
			assert.deepStrictEqual(err, ["Error: tty broke"]);
			assert.deepStrictEqual(out, []);
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) assert.strictEqual(Runtime.getErrorExitCode(Cause.squash(exit.cause)), 3);
		}),
	);

	it.effect("a Config provider whose reads fail does not fail the layer: the env falls back to a quiet terminal", () =>
		Effect.gen(function* () {
			const { double, err } = capturing();
			let seen: string | undefined;
			const failing = ConfigProvider.make(() => Effect.fail(new ConfigProvider.SourceError({ message: "no env" })));
			const exit = yield* CliRuntime.main(
				Effect.gen(function* () {
					seen = (yield* CliTheme).color;
				}),
				{ platform: TTY, env: {}, exitCode: 3 },
			).pipe(
				Effect.exit,
				Effect.provideService(ConfigProvider.ConfigProvider, failing),
				Effect.provideService(Console.Console, double),
			);
			// Every env read degrades to "unset" by design, so there is nothing to fail: no line, no exit code.
			assert.isTrue(Exit.isSuccess(exit));
			assert.deepStrictEqual(err, []);
			assert.strictEqual(seen, "none");
		}),
	);

	it.effect(
		"env.log makes CliLog the logger set: the sink records a debug record, and a failure is still reported",
		() =>
			Effect.gen(function* () {
				const { double, err } = capturing();
				const exit = yield* CliRuntime.main(
					Effect.gen(function* () {
						yield* Effect.logDebug("inside");
						return yield* Effect.fail(new Error("boom"));
					}),
					{ platform: TTY, env: { log: { envVar: "TOOL_LOG" } } },
				).pipe(
					Effect.exit,
					Effect.provideService(ConfigProvider.ConfigProvider, withEnv({ TOOL_LOG: "debug" })),
					Effect.provideService(Console.Console, double),
				);
				assert.isTrue(Exit.isFailure(exit));
				assert.include(err, "Error: boom");
				const records = err.filter((line) => line.startsWith("{") || /^\d\d:\d\d:\d\d\.\d{3} /.test(line));
				assert.isTrue(
					records.some((line) => line.includes("inside")),
					err.join("\n"),
				);
			}),
	);

	it.effect("without env.log the default CliLogger stays, so a debug record writes nothing", () =>
		Effect.gen(function* () {
			const { double, err } = capturing();
			yield* CliRuntime.main(Effect.logDebug("inside"), { platform: TTY, env: {} }).pipe(
				Effect.exit,
				Effect.provideService(ConfigProvider.ConfigProvider, withEnv({ TOOL_LOG: "debug" })),
				Effect.provideService(Console.Console, double),
			);
			assert.deepStrictEqual(err, []);
		}),
	);

	it.effect("a failure building the env layer with env.log set is still one line and exit 3 (fallback logger)", () =>
		Effect.gen(function* () {
			const { double, out, err } = capturing();
			const broken = platform({ stdin: true, stdout: true, columns: Effect.die(new Error("tty broke")) });
			const exit = yield* CliRuntime.main(Effect.void, {
				platform: broken,
				env: { log: { envVar: "TOOL_LOG" } },
				exitCode: 3,
			}).pipe(
				Effect.exit,
				Effect.provideService(ConfigProvider.ConfigProvider, withEnv({})),
				Effect.provideService(Console.Console, double),
			);
			assert.deepStrictEqual(err, ["Error: tty broke"]);
			assert.deepStrictEqual(out, []);
			if (Exit.isFailure(exit)) assert.strictEqual(Runtime.getErrorExitCode(Cause.squash(exit.cause)), 3);
			else assert.fail("expected a failure");
		}),
	);

	it.effect("help text follows the same colour decision as the env: FORCE_COLOR colours it over a pipe", () =>
		Effect.gen(function* () {
			const app = Command.make("tool").pipe(Command.withSubcommands([Command.make("run", {}, () => Effect.void)]));
			const helpUnder = (env: Record<string, string>) =>
				Effect.gen(function* () {
					const { double, out } = capturing();
					yield* CliRuntime.main(Command.runWith(app, { version: "1.0.0" })(["--help"]), {
						platform: Layer.mergeAll(NodeServices.layer, PIPED),
						env: {},
					}).pipe(
						Effect.exit,
						Effect.provideService(ConfigProvider.ConfigProvider, withEnv(env)),
						Effect.provideService(Console.Console, double),
					);
					return out.join("\n");
				});
			assert.include(yield* helpUnder({ FORCE_COLOR: "1" }), "\x1b[");
			assert.notInclude(yield* helpUnder({}), "\x1b[");
		}),
	);
});
