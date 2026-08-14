import { assert, describe, it } from "@effect/vitest";
import { Cause, Console, Effect, Exit, Runtime } from "effect";
import { CliLogger } from "../src/CliLogger.js";
import { CliRuntime } from "../src/CliRuntime.js";

const capturing = (): { readonly console: Console.Console; readonly out: string[]; readonly err: string[] } => {
	const out: string[] = [];
	const err: string[] = [];
	const console_: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { console: console_, out, err };
};

/** Run a program under the CLI logger, returning what was written and the exit. */
const run = <A, E>(
	program: Effect.Effect<A, E>,
	options: Parameters<typeof CliRuntime.reportFailures>[0] = {},
): Effect.Effect<{ out: string[]; err: string[]; exit: Exit.Exit<A, Error> }> =>
	Effect.gen(function* () {
		const { console: double, out, err } = capturing();
		const exit = yield* program.pipe(
			CliRuntime.reportFailures(options),
			Effect.exit,
			Effect.provide(CliLogger.layer()),
			Effect.provideService(Console.Console, double),
		);
		return { out, err, exit };
	});

/** The squashed failure, the same way `makeRunMain` reads one. */
const failureOf = <A>(exit: Exit.Exit<A, Error>): unknown =>
	Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

describe("CliRuntime.reportFailures", () => {
	it.effect("reports through the program's own logger, on stderr", () =>
		Effect.gen(function* () {
			const { out, err, exit } = yield* run(Effect.fail(new Error("boom")));

			assert.deepStrictEqual(err, ["Error: boom"]);
			// The bug this exists to prevent is the report landing on stdout.
			assert.deepStrictEqual(out, []);
			assert.strictEqual(Exit.isFailure(exit), true);
		}),
	);

	it.effect("re-fails rather than swallowing, so a broken run cannot exit zero", () =>
		Effect.gen(function* () {
			const { exit } = yield* run(Effect.fail(new Error("boom")));
			assert.strictEqual(Exit.isSuccess(exit), false);
		}),
	);

	it.effect("marks the error so the runtime does NOT report it a second time", () =>
		Effect.gen(function* () {
			const { exit } = yield* run(Effect.fail(new Error("boom")));
			const error = failureOf(exit);

			// Read through core's own getter, not our property. The polarity is
			// inverted relative to the name — `false` is what suppresses — so this
			// assertion FAILS if anyone "corrects" the marker to `true` to match the
			// name, which is the whole reason it is written this way.
			assert.strictEqual(Runtime.getErrorReported(CliRuntime.reported(new Error("x"))), false);
			assert.strictEqual(error === undefined ? true : Runtime.getErrorReported(error), false);
		}),
	);

	it.effect("keeps an exit code the error chose for itself", () =>
		Effect.gen(function* () {
			const picky = Object.assign(new Error("needs 3"), { [Runtime.errorExitCode]: 3 });
			const { exit } = yield* run(Effect.fail(picky), { exitCode: 9 });
			const error = failureOf(exit);

			// The option is a FALLBACK, never an override: 3 was a deliberate choice
			// by whatever raised the error.
			assert.strictEqual(Runtime.getErrorExitCode(error), 3);
		}),
	);

	it.effect("distinguishes an explicit exit code of 1 from no marker at all", () =>
		Effect.gen(function* () {
			const explicitlyOne = Object.assign(new Error("one"), { [Runtime.errorExitCode]: 1 });
			const unmarked = new Error("unmarked");

			const kept = yield* run(Effect.fail(explicitlyOne), { exitCode: 7 });
			const defaulted = yield* run(Effect.fail(unmarked), { exitCode: 7 });

			const codeOf = (exit: Exit.Exit<never, Error>): number => Runtime.getErrorExitCode(failureOf(exit));

			// `getErrorExitCode` answers 1 for both an error marked 1 and an unmarked
			// one, so reading it alone would let the option override a deliberate 1.
			assert.strictEqual(codeOf(kept.exit as Exit.Exit<never, Error>), 1);
			assert.strictEqual(codeOf(defaulted.exit as Exit.Exit<never, Error>), 7);
		}),
	);

	it.effect("renders several lines when the renderer returns several", () =>
		Effect.gen(function* () {
			const { err } = yield* run(Effect.fail(new Error("bad config")), {
				render: (error) => [String(error), "  unknown key at groups.g.rulesetz"],
			});

			assert.deepStrictEqual(err, ["Error: bad config", "  unknown key at groups.g.rulesetz"]);
		}),
	);

	it.effect("leaves an interrupt alone", () =>
		Effect.gen(function* () {
			const { out, err, exit } = yield* run(Effect.interrupt);

			// An interrupt is not a failure to report, and the default teardown
			// already maps an interrupt-only cause to 130.
			assert.deepStrictEqual(err, []);
			assert.deepStrictEqual(out, []);
			assert.strictEqual(Exit.isFailure(exit), true);
		}),
	);

	it.effect("leaves a success untouched", () =>
		Effect.gen(function* () {
			const { out, err, exit } = yield* run(Effect.succeed(42));

			assert.strictEqual(Exit.isSuccess(exit), true);
			assert.deepStrictEqual([...out, ...err], []);
		}),
	);
});
