import { assert, describe, it } from "@effect/vitest";
import { Effect, MutableRef } from "effect";
import { CliExit } from "../src/index.js";

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
});
