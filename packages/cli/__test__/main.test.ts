// The command as `bin.ts` runs it, over an in-memory `Command.Environment`: argv through `Stdio.layerTest`, then what
// reaches stdout and stderr and the exit code the runtime would use.
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Cause, ConfigProvider, Effect, Exit, Layer, Path, Runtime, Stdio, Terminal } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { TestConsole } from "effect/testing";
import { run } from "../src/main.js";
import { CLI_VERSION } from "../src/version.js";

const environment = (args: ReadonlyArray<string>) =>
	Layer.mergeAll(
		MemoryFileSystem.layerWith({}),
		Path.layer,
		Stdio.layerTest({ args: Effect.succeed(args) }),
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

const runMain = (args: ReadonlyArray<string>, options: Parameters<typeof run>[0] = {}) =>
	Effect.gen(function* () {
		const exit = yield* Effect.exit(
			run(options, environment(args)).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))),
		);
		const code = Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : 0;
		const out = (yield* TestConsole.logLines).map(String).join("\n");
		const err = (yield* TestConsole.errorLines).map(String).join("\n");
		return { code, out, err };
	});

describe("effected", () => {
	it.effect("--version prints the tool and its version", () =>
		Effect.gen(function* () {
			const { code, out } = yield* runMain(["--version"]);
			assert.strictEqual(code, 0);
			assert.strictEqual(out.trim(), `effected ${CLI_VERSION}`);
		}),
	);

	it.effect("--version names the carrier it was installed through", () =>
		Effect.gen(function* () {
			const { code, out } = yield* runMain(["--version"], {
				distribution: { name: "@effected/plugin", version: "9.9.9" },
			});
			assert.strictEqual(code, 0);
			assert.strictEqual(out.trim(), `effected ${CLI_VERSION} via @effected/plugin 9.9.9`);
		}),
	);

	it.effect("--help exits 0 and names the tool", () =>
		Effect.gen(function* () {
			const { code, out } = yield* runMain(["--help"]);
			assert.strictEqual(code, 0);
			assert.include(out, "effected");
		}),
	);

	it.effect("an unknown flag is a usage error: exit 64, help beside the errors on stderr", () =>
		Effect.gen(function* () {
			const { code, out, err } = yield* runMain(["--no-such-flag"]);
			assert.strictEqual(code, 64);
			assert.strictEqual(out, "");
			assert.include(err, "no-such-flag");
		}),
	);
});
