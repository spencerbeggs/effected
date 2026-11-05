import { assert, describe, it } from "@effect/vitest";
import { Cause, Console, Effect, Exit, Layer, MutableRef, Runtime } from "effect";
import { CliExit, CliRuntime } from "../src/index.js";

const capturing = (): { readonly console: Console.Console; readonly out: string[]; readonly err: string[] } => {
	const out: string[] = [];
	const err: string[] = [];
	const console_: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { console: console_, out, err };
};

class Drift extends Error {
	readonly _tag = "Drift";
}

describe("CliExit", () => {
	it.effect("starts at 0", () =>
		Effect.gen(function* () {
			const exit = yield* CliExit;
			assert.strictEqual(MutableRef.get(exit.code), 0);
		}).pipe(Effect.provide(CliExit.layer)),
	);

	it.effect("keeps the highest code set during the run", () =>
		Effect.gen(function* () {
			yield* CliExit.set(1);
			yield* CliExit.set(2);
			yield* CliExit.set(1);
			const exit = yield* CliExit;
			assert.strictEqual(MutableRef.get(exit.code), 2);
		}).pipe(Effect.provide(CliExit.layer)),
	);

	it.effect("each layer build is a fresh cell", () =>
		Effect.gen(function* () {
			yield* CliExit.set(2).pipe(Effect.provide(CliExit.layer));
			const exit = yield* CliExit;
			assert.strictEqual(MutableRef.get(exit.code), 0);
		}).pipe(Effect.provide(CliExit.layer)),
	);

	for (const bad of [256, 1.5, Number.NaN, -1]) {
		it.effect(`dies on ${bad}: an exit code must be an integer 0..255`, () =>
			Effect.gen(function* () {
				const exit = yield* CliExit.set(bad).pipe(Effect.exit, Effect.provide(CliExit.layer));
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					// A defect, not a typed failure: a bad code is a wiring bug.
					assert.isTrue(Cause.hasDies(exit.cause));
					assert.isFalse(Cause.hasFails(exit.cause));
					const defect = Cause.squash(exit.cause);
					assert.instanceOf(defect, Error);
					assert.strictEqual(
						(defect as Error).message,
						`CliExit.set: exit code must be an integer 0..255, received ${bad}`,
					);
				}
			}),
		);
	}

	it.effect("accepts the boundaries 0 and 255", () =>
		Effect.gen(function* () {
			yield* CliExit.set(0);
			yield* CliExit.set(255);
			const exit = yield* CliExit;
			assert.strictEqual(MutableRef.get(exit.code), 255);
		}).pipe(Effect.provide(CliExit.layer)),
	);

	describe("report", () => {
		it.effect("writes to stderr only, nothing on stdout, and records the code", () =>
			Effect.gen(function* () {
				const { console: double, out, err } = capturing();
				yield* CliExit.report(3, "drifted").pipe(Effect.provideService(Console.Console, double));
				assert.deepStrictEqual(err, ["drifted"]);
				assert.deepStrictEqual(out, []);
				const exit = yield* CliExit;
				assert.strictEqual(MutableRef.get(exit.code), 3);
			}).pipe(Effect.provide(CliExit.layer)),
		);

		it.effect("keeps the highest code", () =>
			Effect.gen(function* () {
				const { console: double } = capturing();
				yield* CliExit.report(4, "a").pipe(Effect.provideService(Console.Console, double));
				yield* CliExit.report(2, "b").pipe(Effect.provideService(Console.Console, double));
				const exit = yield* CliExit;
				assert.strictEqual(MutableRef.get(exit.code), 4);
			}).pipe(Effect.provide(CliExit.layer)),
		);

		it.effect("report(256, ...) dies before writing", () =>
			Effect.gen(function* () {
				const { console: double, err } = capturing();
				const exit = yield* CliExit.report(256, "nope").pipe(
					Effect.provideService(Console.Console, double),
					Effect.exit,
				);
				assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
				assert.deepStrictEqual(err, []);
			}).pipe(Effect.provide(CliExit.layer)),
		);
	});

	describe("reportCause", () => {
		const report = (cause: Cause.Cause<unknown>, codeOf: (error: unknown) => number) =>
			Effect.gen(function* () {
				const { console: double, out, err } = capturing();
				const exit = yield* CliExit.reportCause(cause, codeOf).pipe(
					Effect.provideService(Console.Console, double),
					Effect.exit,
				);
				const cell = yield* CliExit;
				return { out, err, exit, code: MutableRef.get(cell.code) };
			}).pipe(Effect.provide(CliExit.layer));

		it.effect("writes code, tag and message for a tagged failure", () =>
			Effect.gen(function* () {
				const { err, out, code } = yield* report(Cause.fail(new Drift("3 schemas drifted")), () => 2);
				assert.deepStrictEqual(err, ["2 Drift: 3 schemas drifted"]);
				assert.deepStrictEqual(out, []);
				assert.strictEqual(code, 2);
			}),
		);

		it.effect("on a defect uses codeOf and omits the tag when there is none", () =>
			Effect.gen(function* () {
				const { err, code } = yield* report(Cause.die(new Error("boom")), (e) => (e instanceof Error ? 70 : 1));
				assert.deepStrictEqual(err, ["70 boom"]);
				assert.strictEqual(code, 70);
			}),
		);

		it.effect("sanitizes an escape in the message", () =>
			Effect.gen(function* () {
				const { err } = yield* report(Cause.fail(new Error("bad \u001b[31mred\u001b[0m\u0007 text")), () => 1);
				assert.deepStrictEqual(err, ["1 bad red text"]);
			}),
		);

		it.effect("survives an error whose _tag getter throws", () =>
			Effect.gen(function* () {
				const hostile = {
					get _tag(): string {
						throw new Error("tag trap");
					},
					message: "still readable",
				};
				const { err, exit, code } = yield* report(Cause.fail(hostile), () => 5);
				assert.isTrue(Exit.isSuccess(exit));
				assert.deepStrictEqual(err, ["5 still readable"]);
				assert.strictEqual(code, 5);
			}),
		);

		it.effect("an interrupt-only cause writes nothing, records nothing and re-interrupts", () =>
			Effect.gen(function* () {
				const { err, exit, code } = yield* report(Cause.interrupt(), () => 9);
				assert.deepStrictEqual(err, []);
				assert.strictEqual(code, 0);
				assert.isTrue(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause));
			}),
		);
	});

	it.effect("through CliRuntime.main a run that reports exits with the code and runs its finalizers", () =>
		Effect.gen(function* () {
			const { console: double, err } = capturing();
			let finalized = false;
			const program = Effect.gen(function* () {
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						finalized = true;
					}),
				);
				yield* CliExit.report(2, "hook says no");
			}).pipe(Effect.scoped);
			const exit = yield* CliRuntime.main(program, { platform: Layer.empty }).pipe(
				Effect.exit,
				Effect.provideService(Console.Console, double),
			);
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				assert.strictEqual(Runtime.getErrorExitCode(Cause.squash(exit.cause)), 2);
			}
			assert.isTrue(finalized);
			assert.deepStrictEqual(err, ["hook says no"]);
		}),
	);
});
