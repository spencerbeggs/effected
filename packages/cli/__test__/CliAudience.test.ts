import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { AudienceShape } from "@effected/env";
import { Audience } from "@effected/env";
import { Cause, Console, Effect, Exit, Runtime } from "effect";
import { Argument, Command } from "effect/cli";
import { CliAudience, CliRuntime } from "../src/index.js";

const capturing = () => {
	const out: string[] = [];
	const err: string[] = [];
	const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { double, out, err };
};

/** A real two-subcommand program; the handler records the `Audience` it observes. */
const run = (argv: ReadonlyArray<string>, options?: { readonly hidden?: boolean }) =>
	Effect.gen(function* () {
		const { double, out, err } = capturing();
		const seen: AudienceShape[] = [];
		const verify = Command.make("verify", { target: Argument.String("target") }, () =>
			Effect.gen(function* () {
				seen.push(yield* Audience);
			}),
		);
		const other = Command.make("other", {}, () => Effect.void);
		const root = Command.make("tool").pipe(
			Command.withSharedFlags(CliAudience.flags(options)),
			Command.withSubcommands([verify, other]),
			CliAudience.provide,
		);
		const exit = yield* CliRuntime.main(Command.runWith(root, { version: "1.0.0" })(argv), {
			platform: NodeServices.layer,
		}).pipe(
			Effect.exit,
			Effect.provideService(Console.Console, double),
			// The ambient audience, as env's detection would have left it.
			Effect.provide(Audience.layerTest("human", "detected")),
		);
		const code = Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : 0;
		return { code, seen, out, err };
	});

describe("CliAudience", () => {
	const cases: ReadonlyArray<readonly [string, ReadonlyArray<string>, AudienceShape]> = [
		["no flag leaves the ambient audience untouched", ["verify", "x"], { kind: "human", source: "detected" }],
		["--agent before the subcommand", ["--agent", "verify", "x"], { kind: "agent", source: "flag" }],
		["--agent after the subcommand", ["verify", "x", "--agent"], { kind: "agent", source: "flag" }],
		["--audience ci", ["verify", "x", "--audience", "ci"], { kind: "ci", source: "flag" }],
		["--human", ["--human", "verify", "x"], { kind: "human", source: "flag" }],
		["--ci", ["--ci", "verify", "x"], { kind: "ci", source: "flag" }],
	];
	for (const [label, argv, expected] of cases) {
		it.effect(label, () =>
			Effect.gen(function* () {
				const { code, seen } = yield* run(argv);
				assert.strictEqual(code, 0);
				assert.deepStrictEqual(seen, [expected]);
			}),
		);
	}

	describe("more than one occurrence is a usage error, even when the values agree", () => {
		const conflicts: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
			["--agent, then --ci after the subcommand", ["--agent", "verify", "x", "--ci"]],
			["--agent twice", ["--agent", "--agent", "verify", "x"]],
			["--agent and --audience agent", ["--agent", "--audience", "agent", "verify", "x"]],
			["--audience ci twice", ["--audience", "ci", "--audience", "ci", "verify", "x"]],
		];
		for (const [label, argv] of conflicts) {
			it.effect(label, () =>
				Effect.gen(function* () {
					const { code, seen, err } = yield* run(argv);
					assert.strictEqual(code, 64);
					assert.deepStrictEqual(seen, [], "the handler never runs");
					assert.strictEqual(err.length, 1, err.join("\n"));
					assert.include(err[0], "Give at most one of --audience, --human, --agent, --ci (once).");
				}),
			);
		}
	});

	it.effect("a bad --audience value is core's own parse error, exit 64", () =>
		Effect.gen(function* () {
			const { code, seen } = yield* run(["verify", "x", "--audience", "bogus"]);
			assert.strictEqual(code, 64);
			assert.deepStrictEqual(seen, []);
		}),
	);

	it.effect("--agent --ci --help exits 0 and prints help (intended: core's action flags win before the resolver)", () =>
		Effect.gen(function* () {
			// Review Focus 2. Core handles --help before the resolver runs, so a conflicting audience together with
			// --help is not a usage error. This is core's precedence, pinned here so a change to it is noticed.
			const { code, out, err } = yield* run(["--agent", "--ci", "--help"]);
			assert.strictEqual(code, 0);
			assert.isTrue(
				out.some((line) => line.includes("USAGE")),
				out.join("\n"),
			);
			assert.deepStrictEqual(err, []);
		}),
	);

	describe("flags({ hidden: true })", () => {
		it.effect("the root --help does not list --audience", () =>
			Effect.gen(function* () {
				const visible = yield* run(["--help"]);
				assert.isTrue(
					visible.out.some((line) => line.includes("--audience")),
					"control: shown when not hidden",
				);
				const hidden = yield* run(["--help"], { hidden: true });
				assert.strictEqual(hidden.code, 0);
				assert.isFalse(hidden.out.some((line) => line.includes("--audience")));
				for (const flag of ["--human", "--agent", "--ci"]) {
					assert.isFalse(hidden.out.some((line) => line.includes(flag)));
				}
			}),
		);

		it.effect("the flags still parse and resolve", () =>
			Effect.gen(function* () {
				const { code, seen } = yield* run(["--agent", "verify", "x"], { hidden: true });
				assert.strictEqual(code, 0);
				assert.deepStrictEqual(seen, [{ kind: "agent", source: "flag" }]);
			}),
		);
	});
});
