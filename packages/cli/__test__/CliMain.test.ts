import { assert, describe, it } from "@effect/vitest";
import { Cause, Console, Context, Effect, Exit, Layer, Runtime } from "effect";
import { CliExit, CliRuntime } from "../src/index.js";

class Platform extends Context.Service<Platform, { readonly name: string }>()("test/Platform") {}

const capturing = () => {
	const out: string[] = [];
	const err: string[] = [];
	const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { double, out, err };
};

const codeOf = <A>(exit: Exit.Exit<A, unknown>): number | undefined =>
	Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : undefined;

describe("CliRuntime.main", () => {
	it.effect("a program that succeeds with no findings succeeds", () =>
		Effect.gen(function* () {
			const { double } = capturing();
			const exit = yield* CliRuntime.main(Effect.void, { platform: Layer.empty }).pipe(
				Effect.exit,
				Effect.provideService(Console.Console, double),
			);
			assert.isTrue(Exit.isSuccess(exit));
		}),
	);

	it.effect("findings exit non-zero and finalizers still run", () =>
		Effect.gen(function* () {
			const { double, err } = capturing();
			let finalized = false;
			const program = Effect.gen(function* () {
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						finalized = true;
					}),
				);
				yield* CliExit.set(1);
			}).pipe(Effect.scoped);
			const exit = yield* CliRuntime.main(program, { platform: Layer.empty }).pipe(
				Effect.exit,
				Effect.provideService(Console.Console, double),
			);
			assert.strictEqual(codeOf(exit), 1);
			assert.isTrue(finalized);
			assert.deepStrictEqual(err, [], "the findings sentinel is never rendered");
		}),
	);

	it.effect("a platform layer that fails to build renders one line on stderr with the fallback code", () =>
		Effect.gen(function* () {
			const { double, out, err } = capturing();
			const broken = Layer.effect(Platform, Effect.fail(new Error("HOME is not set")));
			const program = Effect.gen(function* () {
				yield* Platform;
			});
			const exit = yield* CliRuntime.main(program, { platform: broken, exitCode: 3 }).pipe(
				Effect.exit,
				Effect.provideService(Console.Console, double),
			);
			assert.strictEqual(codeOf(exit), 3);
			assert.deepStrictEqual(err, ["Error: HOME is not set"]);
			assert.deepStrictEqual(out, []);
		}),
	);

	it.effect("the default logger is installed outermost: a failure lands on stderr", () =>
		Effect.gen(function* () {
			const { double, out, err } = capturing();
			yield* CliRuntime.main(Effect.fail(new Error("boom")), { platform: Layer.empty }).pipe(
				Effect.exit,
				Effect.provideService(Console.Console, double),
			);
			assert.deepStrictEqual(err, ["Error: boom"]);
			assert.deepStrictEqual(out, []);
		}),
	);
});
