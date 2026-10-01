import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Console, Effect, Layer, Stdio, Terminal } from "effect";
import { Command } from "effect/cli";
import { CliRuntime } from "../src/index.js";

const capturing = () => {
	const out: string[] = [];
	const err: string[] = [];
	const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { double, out, err };
};

/** `Stdio` and `Terminal` doubles, as a platform provides them. */
const io = Layer.mergeAll(
	Stdio.layerTest({ stdinIsTerminal: Effect.succeed(false), stdoutIsTerminal: Effect.succeed(false) }),
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
);

describe("CliRuntime.main: the platform is built under the logger", () => {
	it.effect("a log line the platform emits while it builds goes to stderr, never stdout, under env.log", () =>
		Effect.gen(function* () {
			const { double, out, err } = capturing();
			const chatty = Layer.mergeAll(io, Layer.effectDiscard(Effect.logInfo("platform built")));
			yield* CliRuntime.main(Effect.void, { platform: chatty, env: { log: {} } }).pipe(
				Effect.provideService(Console.Console, double),
			);
			assert.deepStrictEqual(out, []);
			assert.isTrue(
				err.some((line) => line.includes("platform built")),
				JSON.stringify(err),
			);
		}),
	);

	it.effect("control: without env.log the same line also goes to stderr", () =>
		Effect.gen(function* () {
			const { double, out, err } = capturing();
			const chatty = Layer.effectDiscard(Effect.logInfo("platform built"));
			yield* CliRuntime.main(Effect.void, { platform: chatty }).pipe(Effect.provideService(Console.Console, double));
			assert.deepStrictEqual(out, []);
			assert.isTrue(
				err.some((line) => line.includes("platform built")),
				JSON.stringify(err),
			);
		}),
	);
});

describe("CliRuntime.main: env.formatter", () => {
	const root = Command.make("tool");
	const run = (formatter?: { readonly formatVersion: (name: string, version: string) => string }) =>
		Effect.gen(function* () {
			const { double, out } = capturing();
			yield* CliRuntime.main(Command.runWith(root, { version: "1.2.3" })(["--version"]), {
				platform: io,
				env: formatter === undefined ? {} : { formatter },
			}).pipe(Effect.provide(NodeServices.layer), Effect.provideService(Console.Console, double));
			return out.join("\n");
		});

	it.effect("a custom formatVersion survives the formatter main installs", () =>
		Effect.gen(function* () {
			const text = yield* run({ formatVersion: (name, version) => `${name} ${version} via carrier 9.9.9` });
			assert.include(text, "tool 1.2.3 via carrier 9.9.9");
		}),
	);

	it.effect("control: without it the default formatter's version line is used", () =>
		Effect.gen(function* () {
			const text = yield* run();
			assert.include(text, "1.2.3");
			assert.notInclude(text, "carrier");
		}),
	);
});

describe("CliRuntime.main: the log level applies while the platform builds (F3)", () => {
	const debugging = Layer.mergeAll(io, Layer.effectDiscard(Effect.logDebug("migration ran")));

	it.effect("format json: a Debug record the platform logs while it builds is one NDJSON line on stderr", () =>
		Effect.gen(function* () {
			const { double, out, err } = capturing();
			yield* CliRuntime.main(Effect.void, {
				platform: debugging,
				env: { log: { level: "Debug", format: "json" } },
			}).pipe(Effect.provideService(Console.Console, double));
			assert.deepStrictEqual(out, []);
			const records = err.filter((line) => line.includes("migration ran"));
			assert.lengthOf(records, 1, JSON.stringify(err));
			const record = JSON.parse(records[0] as string) as { readonly level: string; readonly message: unknown };
			assert.strictEqual(record.level, "DEBUG");
			assert.strictEqual(record.message, "migration ran");
		}),
	);

	it.effect("another format: the build-time plain logger is floored at the same level, read from envVar", () =>
		Effect.gen(function* () {
			const { double, err } = capturing();
			yield* CliRuntime.main(Effect.void, {
				platform: debugging,
				env: { log: { envVar: "REPORTER_LOG_LEVEL", format: "pretty" } },
			}).pipe(
				Effect.provideService(Console.Console, double),
				Effect.provideService(
					ConfigProvider.ConfigProvider,
					ConfigProvider.fromUnknown({ REPORTER_LOG_LEVEL: "debug" }),
				),
			);
			assert.isTrue(
				err.some((line) => line.includes("migration ran")),
				JSON.stringify(err),
			);
		}),
	);

	it.effect("control: with diagnostics off, the platform's Debug record is not shown", () =>
		Effect.gen(function* () {
			const { double, err } = capturing();
			yield* CliRuntime.main(Effect.void, { platform: debugging, env: { log: { format: "json" } } }).pipe(
				Effect.provideService(Console.Console, double),
			);
			assert.isFalse(err.some((line) => line.includes("migration ran")));
		}),
	);
});
