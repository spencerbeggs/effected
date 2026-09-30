// The audience flag must be known BEFORE core parses, because a fallback prompt fires during the parse: core parses
// the root flags into a local context (Command.ts:922-925) and only wraps the subcommand HANDLER with what
// `provideEffect` resolves (Command.ts:941), so the prompt in `sub.parse` (Param.ts:1478-1485) cannot see them.
// `CliAudience.run` / `runWith` scan argv first and provide the answer around the whole run.
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Audience } from "@effected/env";
import { Cause, Console, Effect, Exit, Layer, Runtime } from "effect";
import { Command, Flag, Prompt } from "effect/cli";
import { CliAudience, CliInteractive, CliPrompt, CliRuntime } from "../src/index.js";
import { TestTerminal } from "../src/testing.js";

const capturing = () => {
	const out: string[] = [];
	const err: string[] = [];
	const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { double, out, err };
};

const profile = Flag.String("profile").pipe(
	Flag.withFallbackPrompt(
		CliPrompt.fallback(
			Prompt.Select({
				message: "Profile",
				choices: [
					{ title: "x", value: "x" },
					{ title: "library", value: "library" },
				],
			}),
			{ flag: "profile", otherwise: "x" },
		),
	),
);

const init = Command.make("init", { profile }, ({ profile }) =>
	Effect.gen(function* () {
		const audience = yield* Audience;
		yield* Console.log(`profile=${profile} audience=${audience.kind}/${audience.source}`);
	}),
);
const root = Command.make("tool").pipe(
	Command.withSharedFlags(CliAudience.flags()),
	Command.withSubcommands([init]),
	CliAudience.provide,
);

/** A human on a terminal (interactive), with keys waiting that "down, enter" would answer the prompt with. */
const run = (argv: ReadonlyArray<string>, via: "runWith" | "core" = "runWith", gateWizard = false) =>
	Effect.gen(function* () {
		const terminal = yield* TestTerminal.make();
		yield* terminal.input([{ name: "down" }, { name: "enter" }]);
		const { double, out, err } = capturing();
		const program =
			via === "runWith"
				? CliAudience.runWith(root, { version: "1.0.0" })(argv)
				: Command.runWith(root, { version: "1.0.0" })(argv);
		const exit = yield* CliRuntime.main(program, {
			platform: Layer.mergeAll(NodeServices.layer, CliPrompt.gateTerminal.pipe(Layer.provide(terminal.layer))),
		}).pipe(
			Effect.exit,
			Effect.provideService(Console.Console, double),
			gateWizard ? Effect.provide(CliPrompt.gateWizard) : (self) => self,
			Effect.provide(CliInteractive.layerTest(true)),
			Effect.provide(Audience.layerTest("human", "detected")),
		);
		const code = Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : 0;
		return { out, err, code, reads: yield* terminal.reads };
	});

const QUIET = { keys: 0, lines: 0, subscriptions: 0 };

describe("CliAudience.runWith resolves the audience flag before parsing", () => {
	it.effect("no flag: the human on a terminal is prompted", () =>
		Effect.gen(function* () {
			const { out, reads } = yield* run(["init"]);
			assert.deepStrictEqual(out, ["profile=library audience=human/detected"]);
			assert.deepStrictEqual(reads.keys, 2);
			assert.isAtLeast(reads.subscriptions, 1);
		}),
	);

	for (const [label, argv, audience] of [
		["--agent before the subcommand", ["--agent", "init"], "agent"],
		["--ci before the subcommand", ["--ci", "init"], "ci"],
		["--agent after the subcommand", ["init", "--agent"], "agent"],
		["--audience agent", ["--audience", "agent", "init"], "agent"],
		["--audience=ci", ["--audience=ci", "init"], "ci"],
	] as const) {
		it.effect(`${label}: no prompt, the fallback default is used, the terminal is never touched`, () =>
			Effect.gen(function* () {
				const { out, code, reads } = yield* run(argv);
				assert.strictEqual(code, 0);
				assert.deepStrictEqual(out, [`profile=x audience=${audience}/flag`]);
				assert.deepStrictEqual(reads, QUIET);
			}),
		);
	}

	it.effect("--no-agent and --agent=false are not given: the prompt still fires", () =>
		Effect.gen(function* () {
			for (const argv of [
				["--no-agent", "init"],
				["--agent=false", "init"],
				["--agent", "false", "init"],
			]) {
				const { out, reads } = yield* run(argv);
				assert.deepStrictEqual(out, ["profile=library audience=human/detected"], argv.join(" "));
				assert.deepStrictEqual(reads.keys, 2);
			}
		}),
	);

	it.effect("--human on an interactive run still prompts (a flag never turns interactivity on, nor off here)", () =>
		Effect.gen(function* () {
			const { out } = yield* run(["--human", "init"]);
			assert.deepStrictEqual(out, ["profile=library audience=human/flag"]);
		}),
	);

	it.effect("--agent --ci: exit 64 from core's own resolver, and no prompt", () =>
		Effect.gen(function* () {
			const { out, err, code, reads } = yield* run(["--agent", "--ci", "init"]);
			assert.strictEqual(code, 64);
			assert.isFalse(out.some((line) => line.startsWith("profile=")));
			assert.isTrue(err.some((line) => line.includes("Give at most one of --audience, --human, --agent, --ci")));
			assert.deepStrictEqual(reads, QUIET);
		}),
	);

	it.effect("control: core's own runWith lets the prompt fire under --agent (the parse-order gap)", () =>
		Effect.gen(function* () {
			const { out, reads } = yield* run(["--agent", "init"], "core");
			// The fallback ran before the flag was visible, so the terminal was read.
			assert.deepStrictEqual(out, ["profile=library audience=agent/flag"]);
			assert.deepStrictEqual(reads.keys, 2);
		}),
	);

	// `gateWizard` decides from the audience DETECTED at build time, before the flag is read, so on a human terminal
	// `--agent --wizard` used to run core's wizard (ANSI on stdout, exit 0) for a run that did nothing.
	it.effect("--agent --wizard on a human terminal is an unrecognised flag (64), never the wizard", () =>
		Effect.gen(function* () {
			const { out, err, code } = yield* run(["--agent", "--wizard", "init"], "runWith", true);
			assert.strictEqual(code, 64);
			assert.isTrue(
				err.some((line) => line.includes("wizard")),
				err.join("\n"),
			);
			assert.isFalse(
				out.some((line) => /wizard/i.test(line) && !line.includes("--wizard")),
				"no wizard output",
			);
		}),
	);
});
