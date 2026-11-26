import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Console, Effect, Exit, Layer, Option, Runtime, Stdio } from "effect";
import { Command, Flag, GlobalFlag } from "effect/cli";
import type { UsageErrorDetails } from "../src/index.js";
import { CliRuntime } from "../src/index.js";

const Format = GlobalFlag.Setting("format")({
	flag: Flag.Literals("format", ["text", "json"]).pipe(Flag.withDefault("text")),
});
const Verbose = GlobalFlag.Setting("verbose")({
	flag: Flag.Boolean("verbose").pipe(Flag.withAlias("d"), Flag.withDefault(false)),
});

/** What a successful run's handler saw: the values core provided for the two settings. */
const seen: Array<{ readonly format: string; readonly verbose: boolean }> = [];

const check = Command.make("check", { count: Flag.Int("count").pipe(Flag.withDefault(1)) }, () =>
	Effect.gen(function* () {
		const format = yield* Format;
		const verbose = yield* Verbose;
		seen.push({ format, verbose });
	}),
).pipe(Command.withGlobalFlags([Format, Verbose]));
const other = Command.make("other", { count: Flag.Int("count").pipe(Flag.withDefault(1)) }, () => Effect.void);
// `--format` is a setting on `check` only: on `other` it is out of scope.
const app = Command.make("app").pipe(Command.withSubcommands([check, other]));

// `--format` is a setting on every path, but `shadow` declares a local `--format` of its own.
const shadow = Command.make(
	"shadow",
	{ format: Flag.String("format").pipe(Flag.optional), count: Flag.Int("count").pipe(Flag.withDefault(1)) },
	() => Effect.void,
);
const shadowed = Command.make("app").pipe(Command.withGlobalFlags([Format]), Command.withSubcommands([shadow]));

const HELP_MARK = "USAGE";

const capturing = () => {
	const out: string[] = [];
	const err: string[] = [];
	const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
		warn: (...args: ReadonlyArray<unknown>) => err.push(`warn:${args.map(String).join(" ")}`),
	});
	return { double, out, err };
};

const codeOf = (exit: Exit.Exit<unknown, unknown>): number =>
	Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : 0;

type Render = (details: UsageErrorDetails) => string | ReadonlyArray<string> | undefined;

interface RunOptions {
	readonly root?: Command.Command.Any;
	readonly render?: Render;
	readonly helpOnUsageError?: "stdout" | "stderr";
}

/** Run `app` the way a bin does: `Command.run` reads argv from `Stdio.args`. */
const run = (argv: ReadonlyArray<string>, options: RunOptions = {}) =>
	Effect.gen(function* () {
		const root = (options.root ?? app) as typeof app;
		const { double, out, err } = capturing();
		const platform = Layer.merge(NodeServices.layer, Stdio.layerTest({ args: Effect.succeed(argv) }));
		const exit = yield* CliRuntime.main(Command.run(root, { version: "1.0.0" }), {
			platform,
			...(options.helpOnUsageError === undefined ? {} : { helpOnUsageError: options.helpOnUsageError }),
			...(options.render === undefined ? {} : { renderUsageError: { command: root, render: options.render } }),
		}).pipe(Effect.exit, Effect.provideService(Console.Console, double));
		return { out, err, code: codeOf(exit) };
	});

/** A render recording what it was told, and printing a document when the format setting is json. */
const recording = () => {
	const calls: Array<{
		readonly errors: ReadonlyArray<string>;
		readonly commandPath: ReadonlyArray<string>;
		readonly format: Option.Option<string>;
		readonly verbose: Option.Option<boolean>;
	}> = [];
	const render: Render = ({ errors, commandPath, setting }) => {
		const format = setting(Format);
		calls.push({ errors: errors.map(String), commandPath, format, verbose: setting(Verbose) });
		return Option.contains(format, "json") ? JSON.stringify({ ok: false, usage: errors.map(String) }) : undefined;
	};
	return { calls, render };
};

const helpIn = (lines: ReadonlyArray<string>): boolean => lines.some((line) => line.includes(HELP_MARK));

describe("CliRuntime.main renderUsageError", () => {
	describe("a document", () => {
		it.effect("stdout carries exactly the document; help and errors go to stderr; exit 64", () =>
			Effect.gen(function* () {
				const { calls, render } = recording();
				const { out, err, code } = yield* run(["check", "--format", "json", "--nope"], { render });
				assert.strictEqual(calls.length, 1);
				assert.deepStrictEqual(out, [JSON.stringify({ ok: false, usage: calls[0]?.errors })]);
				assert.isTrue(helpIn(err), err.join("\n"));
				assert.isTrue(
					err.some((line) => line.includes("--nope")),
					err.join("\n"),
				);
				assert.strictEqual(code, 64);
			}),
		);

		it.effect("stderr is byte-identical to helpOnUsageError: 'stderr' without the hook", () =>
			Effect.gen(function* () {
				const argv = ["check", "--format=json", "--nope"];
				const { render } = recording();
				const withDoc = yield* run(argv, { render });
				const baseline = yield* run(argv, { helpOnUsageError: "stderr" });
				assert.deepStrictEqual(withDoc.err, baseline.err);
				assert.deepStrictEqual(baseline.out, []);
			}),
		);

		it.effect("is told the ShowHelp's errors and command path", () =>
			Effect.gen(function* () {
				const { calls, render } = recording();
				yield* run(["check", "--nope"], { render });
				assert.deepStrictEqual(calls[0]?.commandPath, ["app", "check"]);
				assert.strictEqual(calls[0]?.errors.length, 1);
				assert.include(calls[0]?.errors[0], "--nope");
			}),
		);

		it.effect("a multi-line document prints line by line on stdout", () =>
			Effect.gen(function* () {
				const { out, code } = yield* run(["check", "--nope"], { render: () => ["one", "two"] });
				assert.deepStrictEqual(out, ["one", "two"]);
				assert.strictEqual(code, 64);
			}),
		);

		it.effect("usageExitCode still decides the code", () =>
			Effect.gen(function* () {
				const { platform, double, out } = {
					platform: Layer.merge(NodeServices.layer, Stdio.layerTest({ args: Effect.succeed(["check", "--nope"]) })),
					...capturing(),
				};
				const exit = yield* CliRuntime.main(Command.run(app, { version: "1.0.0" }), {
					platform,
					usageExitCode: 2,
					renderUsageError: { command: app, render: () => "{}" },
				}).pipe(Effect.exit, Effect.provideService(Console.Console, double));
				assert.deepStrictEqual(out, ["{}"]);
				assert.strictEqual(codeOf(exit), 2);
			}),
		);
	});

	describe("setting", () => {
		it.effect("some(value) when given on an in-scope path", () =>
			Effect.gen(function* () {
				const { calls, render } = recording();
				yield* run(["check", "--format", "json", "-d", "--nope"], { render });
				assert.deepStrictEqual(calls[0]?.format, Option.some("json"));
				assert.deepStrictEqual(calls[0]?.verbose, Option.some(true));
			}),
		);

		it.effect("some(default) when absent from argv", () =>
			Effect.gen(function* () {
				const { calls, render } = recording();
				yield* run(["check", "--nope"], { render });
				assert.deepStrictEqual(calls[0]?.format, Option.some("text"));
				assert.deepStrictEqual(calls[0]?.verbose, Option.some(false));
			}),
		);

		it.effect("none when the setting is out of scope for the subcommand", () =>
			Effect.gen(function* () {
				const { calls, render } = recording();
				const { out } = yield* run(["other", "--format", "json", "--nope"], { render });
				assert.deepStrictEqual(calls[0]?.commandPath, ["app", "other"]);
				assert.deepStrictEqual(calls[0]?.format, Option.none());
				assert.deepStrictEqual(calls[0]?.verbose, Option.none());
				assert.isFalse(
					out.some((line) => line.startsWith("{")),
					"no document for an out-of-scope --format",
				);
			}),
		);

		it.effect("none when the setting's own value fails to parse", () =>
			Effect.gen(function* () {
				const { calls, render } = recording();
				yield* run(["check", "--format", "xml", "--nope"], { render });
				assert.deepStrictEqual(calls[0]?.format, Option.none());
				assert.deepStrictEqual(calls[0]?.verbose, Option.some(false));
			}),
		);

		it.effect("none when a local flag on the path shares the setting's name", () =>
			Effect.gen(function* () {
				const { calls, render } = recording();
				const { out } = yield* run(["shadow", "--format", "json", "--nope"], { root: shadowed, render });
				assert.deepStrictEqual(calls[0]?.commandPath, ["app", "shadow"]);
				assert.deepStrictEqual(calls[0]?.format, Option.none());
				assert.isFalse(out.some((line) => line.startsWith("{")));
			}),
		);

		// The probe against core itself: for argv core runs successfully, the value core provides the handler is the
		// value `setting` resolves for the same argv with one unknown flag added.
		for (const argv of [
			["check"],
			["check", "--format", "json"],
			["check", "--format=json"],
			["--format", "json", "check"],
			["check", "-d"],
			["check", "--verbose=false", "--format", "text"],
			["check", "--no-verbose"],
			["check", "--count", "3", "--format", "json", "--verbose"],
		]) {
			it.effect(`matches what core provides: ${argv.join(" ")}`, () =>
				Effect.gen(function* () {
					seen.length = 0;
					const ok = yield* run(argv);
					assert.strictEqual(ok.code, 0);
					assert.strictEqual(seen.length, 1);
					const provided = seen[0];
					const { calls, render } = recording();
					yield* run([...argv, "--nope"], { render });
					assert.deepStrictEqual(calls[0]?.format, Option.some(provided?.format));
					assert.deepStrictEqual(calls[0]?.verbose, Option.some(provided?.verbose));
				}),
			);
		}
	});

	describe("undefined keeps today's behaviour", () => {
		for (const helpOnUsageError of [undefined, "stdout", "stderr"] as const) {
			for (const argv of [
				["check", "--nope"],
				["check", "--format", "json", "--count", "abc"],
				["other", "--format", "json"],
				["bogus"],
				["--help"],
				["check", "--help"],
				[],
				["check", "--format", "json"],
			]) {
				it.effect(`helpOnUsageError ${String(helpOnUsageError)}: ${argv.join(" ") || "(bare)"}`, () =>
					Effect.gen(function* () {
						const base = helpOnUsageError === undefined ? {} : { helpOnUsageError };
						const before = yield* run(argv, base);
						// The render asks for both settings, so the probe runs: it must write nothing.
						const after = yield* run(argv, {
							...base,
							render: ({ setting }) => {
								setting(Format);
								setting(Verbose);
								return undefined;
							},
						});
						assert.deepStrictEqual(after, before);
					}),
				);
			}
		}
	});

	describe("is not called", () => {
		for (const argv of [["--help"], ["check", "--help"], [], ["check", "--format", "json"], ["--version"]]) {
			it.effect(`for ${argv.join(" ") || "a bare root invocation"}`, () =>
				Effect.gen(function* () {
					const { calls, render } = recording();
					yield* run(argv, { render });
					assert.strictEqual(calls.length, 0);
				}),
			);
		}
	});
});
