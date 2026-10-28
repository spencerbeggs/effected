import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Console, Effect, Exit, Layer, Runtime } from "effect";
import { CliOutput, Command, Flag } from "effect/cli";
import { CliRuntime } from "../src/index.js";

const sub = Command.make("sub", { count: Flag.Int("count").pipe(Flag.withDefault(1)) }, ({ count }) =>
	Console.log(JSON.stringify({ count })),
);
const app = Command.make("app").pipe(Command.withSubcommands([sub]));
const HELP_MARK = "USAGE";

/** A console double recording each stream, and every call in one shared sequence so order ACROSS streams is visible. */
const capturing = () => {
	const out: string[] = [];
	const err: string[] = [];
	const seq: Array<readonly ["out" | "err", string]> = [];
	const record = (stream: "out" | "err", line: string) => {
		(stream === "out" ? out : err).push(line);
		seq.push([stream, line]);
	};
	const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => record("out", args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => record("err", args.map(String).join(" ")),
		warn: (...args: ReadonlyArray<unknown>) => record("err", `warn:${args.map(String).join(" ")}`),
	});
	return { double, out, err, seq };
};

const codeOf = (exit: Exit.Exit<unknown, unknown>): number =>
	Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : 0;

const run = (
	args: ReadonlyArray<string>,
	helpOnUsageError?: "stdout" | "stderr",
	platform: Layer.Layer<NodeServices.NodeServices> = NodeServices.layer,
) =>
	Effect.gen(function* () {
		const { double, out, err } = capturing();
		const exit = yield* CliRuntime.main(Command.runWith(app, { version: "1.0.0" })(args), {
			platform,
			...(helpOnUsageError === undefined ? {} : { helpOnUsageError }),
		}).pipe(Effect.exit, Effect.provideService(Console.Console, double));
		return { out, err, code: codeOf(exit) };
	});

const helpIn = (lines: ReadonlyArray<string>): boolean => lines.some((line) => line.includes(HELP_MARK));

describe("CliRuntime.main helpOnUsageError", () => {
	describe('"stderr"', () => {
		for (const [label, args] of [
			["--help", ["--help"]],
			["sub --help", ["sub", "--help"]],
			["a bare group invocation", []],
		] as const) {
			it.effect(`${label}: help stays on stdout, stderr empty, exit 0`, () =>
				Effect.gen(function* () {
					const { out, err, code } = yield* run(args, "stderr");
					assert.isTrue(helpIn(out), out.join("\n"));
					assert.deepStrictEqual(err, []);
					assert.strictEqual(code, 0);
				}),
			);
		}

		for (const [label, args] of [
			["an unknown flag", ["sub", "--nope"]],
			["a bad value", ["sub", "--count", "abc"]],
			["an unknown subcommand", ["bogus"]],
		] as const) {
			it.effect(`${label}: help and errors both on stderr, help first, stdout empty, exit 64`, () =>
				Effect.gen(function* () {
					const { out, err, code } = yield* run(args, "stderr");
					assert.deepStrictEqual(out, []);
					assert.isTrue(helpIn(err));
					assert.isFalse(helpIn(err.slice(1)), "help comes first, the errors after it");
					assert.isAbove(err.length, 1);
					assert.strictEqual(code, 64);
				}),
			);
		}

		it.effect("a normal run writes its own stdout untouched", () =>
			Effect.gen(function* () {
				const { out, err, code } = yield* run(["sub", "--count", "3"], "stderr");
				assert.deepStrictEqual(out, ['{"count":3}']);
				assert.deepStrictEqual(err, []);
				assert.strictEqual(code, 0);
			}),
		);

		it.effect("sees a Formatter provided through platform", () =>
			Effect.gen(function* () {
				const marked = Layer.succeed(CliOutput.Formatter, {
					...CliOutput.defaultFormatter({ colors: false }),
					formatHelpDoc: () => "CUSTOM HELP",
				});
				const { out, err } = yield* run(["sub", "--nope"], "stderr", Layer.merge(NodeServices.layer, marked));
				assert.deepStrictEqual(out, []);
				assert.strictEqual(err[0], "CUSTOM HELP");
			}),
		);
	});

	describe('"stdout" (the default): core behaviour, the control', () => {
		for (const [label, args] of [
			["--help", ["--help"]],
			["sub --help", ["sub", "--help"]],
			["a bare group invocation", []],
			["an unknown flag", ["sub", "--nope"]],
			["a bad value", ["sub", "--count", "abc"]],
			["an unknown subcommand", ["bogus"]],
		] as const) {
			it.effect(`${label}: help on stdout`, () =>
				Effect.gen(function* () {
					const { out, err } = yield* run(args);
					assert.isTrue(helpIn(out));
					assert.isFalse(helpIn(err));
				}),
			);
		}

		it.effect("explicit stdout matches the default", () =>
			Effect.gen(function* () {
				const { out } = yield* run(["sub", "--nope"], "stdout");
				assert.isTrue(helpIn(out));
			}),
		);
	});

	it.effect("under renderErrors: false, help stays on stdout (documented caveat)", () =>
		Effect.gen(function* () {
			const { double, out, err } = capturing();
			yield* CliRuntime.main(Command.runWith(app, { version: "1.0.0", renderErrors: false })(["sub", "--nope"]), {
				platform: NodeServices.layer,
				helpOnUsageError: "stderr",
			}).pipe(Effect.exit, Effect.provideService(Console.Console, double));
			assert.isTrue(helpIn(out));
			assert.isFalse(helpIn(err));
		}),
	);

	it.effect("a Formatter provided inside the program renders the rerouted help", () =>
		Effect.gen(function* () {
			const { double, out, err } = capturing();
			const program = Command.runWith(app, { version: "1.0.0" })(["sub", "--nope"]).pipe(
				Effect.provide(
					CliOutput.layer({ ...CliOutput.defaultFormatter({ colors: false }), formatHelpDoc: () => "INNER HELP" }),
				),
			);
			yield* CliRuntime.main(program, { platform: NodeServices.layer, helpOnUsageError: "stderr" }).pipe(
				Effect.exit,
				Effect.provideService(Console.Console, double),
			);
			assert.deepStrictEqual(out, []);
			assert.strictEqual(err[0], "INNER HELP");
		}),
	);

	it.effect("a Console provided inside the program receives the help and errors on its own error", () =>
		Effect.gen(function* () {
			const outer = capturing();
			const inner = capturing();
			const program = Command.runWith(app, { version: "1.0.0" })(["sub", "--nope"]).pipe(
				Effect.provideService(Console.Console, inner.double),
			);
			yield* CliRuntime.main(program, { platform: NodeServices.layer, helpOnUsageError: "stderr" }).pipe(
				Effect.exit,
				Effect.provideService(Console.Console, outer.double),
			);
			assert.deepStrictEqual(inner.out, []);
			assert.isTrue(helpIn(inner.err));
			assert.isFalse(helpIn(outer.out));
		}),
	);

	it.effect("a Presenter provided inside the program replaces the routing (documented caveat)", () =>
		Effect.gen(function* () {
			const { double, out, err } = capturing();
			const program = Command.runWith(app, { version: "1.0.0" })(["sub", "--nope"]).pipe(
				Effect.provide(CliOutput.layerPresenter(CliOutput.defaultPresenter)),
			);
			yield* CliRuntime.main(program, { platform: NodeServices.layer, helpOnUsageError: "stderr" }).pipe(
				Effect.exit,
				Effect.provideService(Console.Console, double),
			);
			assert.isTrue(helpIn(out));
			assert.isFalse(helpIn(err));
		}),
	);

	it.effect("--version stays on stdout under stderr", () =>
		Effect.gen(function* () {
			const { out, err, code } = yield* run(["--version"], "stderr");
			assert.isTrue(
				out.some((line) => line.includes("1.0.0")),
				out.join("\n"),
			);
			assert.deepStrictEqual(err, []);
			assert.strictEqual(code, 0);
		}),
	);
});
