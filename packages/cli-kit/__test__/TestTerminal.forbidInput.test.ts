import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Scope, Stream, Terminal } from "effect";
import { TestTerminal } from "../src/testing.js";

const defectText = (exit: Exit.Exit<unknown, unknown>): string => {
	if (Exit.isSuccess(exit)) return assert.fail("expected a defect, but the effect succeeded");
	assert.isFalse(exit.cause.reasons.some(Cause.isFailReason), "a forbidden read is a defect, not a typed failure");
	return Cause.pretty(exit.cause);
};

describe("TestTerminal.make({ forbidInput: true })", () => {
	it.effect("dies on readLine and on readInput, naming the rule", () =>
		Effect.gen(function* () {
			const handle = yield* TestTerminal.make({ forbidInput: true });
			const line = yield* Effect.exit(
				Effect.flatMap(Terminal.Terminal, (t) => t.readLine).pipe(Effect.provide(handle.layer)),
			);
			assert.include(defectText(line), "must not read the terminal");
			const input = yield* Effect.exit(
				Effect.flatMap(Terminal.Terminal, (t) => t.readInput).pipe(Effect.provide(handle.layer)),
			);
			assert.include(defectText(input), "must not read the terminal");
		}),
	);

	it.effect("still serves size and resize", () =>
		Effect.gen(function* () {
			const handle = yield* TestTerminal.make({ forbidInput: true, columns: 50, rows: 10 });
			const scope = yield* Scope.make();
			const sizes = yield* Effect.gen(function* () {
				const terminal = yield* Terminal.Terminal;
				yield* handle.resize({ columns: 60, rows: 12 });
				return [yield* terminal.columns, yield* terminal.rows];
			}).pipe(Effect.provide(handle.layer));
			assert.deepStrictEqual(sizes, [60, 12]);
			const first = yield* Effect.gen(function* () {
				const terminal = yield* Terminal.Terminal;
				const size = yield* Scope.provide(terminal.size, scope);
				return yield* Stream.runHead(Stream.fromQueue(size));
			}).pipe(Effect.provide(handle.layer));
			assert.isTrue(first._tag === "Some" && first.value.columns === 60);
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("without the option a read still behaves as before: readLine quits", () =>
		Effect.gen(function* () {
			const handle = yield* TestTerminal.make();
			const exit = yield* Effect.exit(
				Effect.flatMap(Terminal.Terminal, (t) => t.readLine).pipe(Effect.provide(handle.layer)),
			);
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit))
				assert.isTrue(exit.cause.reasons.some(Cause.isFailReason), "control: a typed QuitError");
		}),
	);
});
