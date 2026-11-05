import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Console, Effect, Layer, Stdio } from "effect";
import { Command, Flag } from "effect/cli";
import { CliAudience, CliRuntime } from "../src/index.js";

const sub = Command.make("sub", { count: Flag.Int("count").pipe(Flag.withDefault(1)) }, () => Effect.void);
const app = Command.make("app").pipe(Command.withSharedFlags(CliAudience.flags()), Command.withSubcommands([sub]));

// A terminal stdout that supports colour, with stderr's check chosen per test.
const platform = Layer.merge(NodeServices.layer, Stdio.layerTest({ stdoutIsTerminal: Effect.succeed(true) }));
const painted = (text: string): boolean => text.includes(String.fromCharCode(27, 91));
const env = ConfigProvider.fromUnknown({ TERM: "xterm-256color" });

const run = (
	args: ReadonlyArray<string>,
	options: {
		readonly stderrIsTerminal: boolean;
		readonly helpOnUsageError?: "stderr";
		readonly helpFlags?: { readonly inheritedFlags?: "full" | "summary" | "none" };
	},
) =>
	Effect.gen(function* () {
		const out: string[] = [];
		const err: string[] = [];
		const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
			log: (...parts: ReadonlyArray<unknown>) => out.push(parts.map(String).join(" ")),
			error: (...parts: ReadonlyArray<unknown>) => err.push(parts.map(String).join(" ")),
		});
		yield* CliRuntime.main(Command.runWith(app, { version: "1.0.0" })(args), {
			platform,
			...(options.helpOnUsageError === undefined ? {} : { helpOnUsageError: options.helpOnUsageError }),
			env: {
				stderrIsTerminal: Effect.succeed(options.stderrIsTerminal),
				...(options.helpFlags === undefined ? {} : { helpFlags: options.helpFlags }),
			},
		}).pipe(
			Effect.exit,
			Effect.provideService(Console.Console, double),
			Effect.provideService(ConfigProvider.ConfigProvider, env),
		);
		return { out: out.join("\n"), err: err.join("\n") };
	});

describe("usage-error help colour follows the stream it is written to", () => {
	it.effect("is unpainted on stderr when stderr is not a terminal, though stdout is", () =>
		Effect.gen(function* () {
			const { err } = yield* run(["sub", "--nope"], { stderrIsTerminal: false, helpOnUsageError: "stderr" });
			assert.include(err, "USAGE");
			assert.isFalse(painted(err), err);
		}),
	);

	it.effect("is painted on stderr when stderr is a terminal", () =>
		Effect.gen(function* () {
			const { err } = yield* run(["sub", "--nope"], { stderrIsTerminal: true, helpOnUsageError: "stderr" });
			assert.isTrue(painted(err), err);
		}),
	);

	it.effect("an explicit --help on stdout keeps stdout's check", () =>
		Effect.gen(function* () {
			const { out } = yield* run(["sub", "--help"], { stderrIsTerminal: false, helpOnUsageError: "stderr" });
			assert.isTrue(painted(out), out);
		}),
	);
});

describe("env.helpFlags", () => {
	it.effect("inheritedFlags 'none' drops the inherited block and keeps colour", () =>
		Effect.gen(function* () {
			const full = yield* run(["sub", "--help"], { stderrIsTerminal: false });
			assert.include(full.out, "INHERITED FLAGS");
			const none = yield* run(["sub", "--help"], { stderrIsTerminal: false, helpFlags: { inheritedFlags: "none" } });
			assert.notInclude(none.out, "INHERITED FLAGS");
			assert.notInclude(none.out, "--agent");
			assert.isTrue(painted(none.out), none.out);
		}),
	);
});
