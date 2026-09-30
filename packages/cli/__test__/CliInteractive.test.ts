import { assert, describe, it } from "@effect/vitest";
import type { AudienceKind } from "@effected/env";
import { Audience, TerminalEnv } from "@effected/env";
import { Effect, Fiber, Layer } from "effect";
import { CliInteractive } from "../src/index.js";

const decide = (kind: AudienceKind, stdinIsTerminal: boolean, stdoutIsTerminal: boolean) =>
	Effect.gen(function* () {
		return yield* CliInteractive;
	}).pipe(
		Effect.provide(
			CliInteractive.layer.pipe(
				Layer.provide(
					Layer.mergeAll(
						Audience.layerTest(kind),
						TerminalEnv.layerTest({ stdinIsTerminal, stdout: { isTerminal: stdoutIsTerminal } }),
					),
				),
			),
		),
	);

describe("CliInteractive.layer", () => {
	const kinds: ReadonlyArray<AudienceKind> = ["human", "agent", "ci"];
	for (const kind of kinds) {
		for (const stdin of [true, false]) {
			for (const stdout of [true, false]) {
				// Only a human with a terminal on both ends is interactive.
				const expected = kind === "human" && stdin && stdout;
				it.effect(`${kind}, stdin TTY ${stdin}, stdout TTY ${stdout} => ${expected}`, () =>
					Effect.gen(function* () {
						assert.strictEqual(yield* decide(kind, stdin, stdout), expected);
					}),
				);
			}
		}
	}

	it.effect("defaults to non-interactive when no layer is provided", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* CliInteractive, false);
		}),
	);
});

describe("CliInteractive.unless", () => {
	const read = Effect.gen(function* () {
		return yield* CliInteractive;
	});

	it.effect("unless(true) turns an interactive scope off", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* CliInteractive.unless(true)(read), false);
		}).pipe(Effect.provide(CliInteractive.layerTest(true))),
	);

	it.effect("unless(false) leaves an interactive scope interactive", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* CliInteractive.unless(false)(read), true);
		}).pipe(Effect.provide(CliInteractive.layerTest(true))),
	);

	it.effect("unless(false) never turns a non-interactive scope on", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* CliInteractive.unless(false)(read), false);
			assert.strictEqual(yield* CliInteractive.unless(true)(read), false);
		}).pipe(Effect.provide(CliInteractive.layerTest(false))),
	);

	it.effect("restores the outer value after the scope exits", () =>
		Effect.gen(function* () {
			const inside = yield* CliInteractive.unless(true)(read);
			const after = yield* read;
			assert.strictEqual(inside, false);
			assert.strictEqual(after, true);
		}).pipe(Effect.provide(CliInteractive.layerTest(true))),
	);

	it.effect("narrowing nests: an inner unless(false) cannot undo an outer unless(true)", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* CliInteractive.unless(true)(CliInteractive.unless(false)(read)), false);
		}).pipe(Effect.provide(CliInteractive.layerTest(true))),
	);

	it.effect("restores the outer value when the scoped effect fails", () =>
		Effect.gen(function* () {
			yield* Effect.ignore(CliInteractive.unless(true)(Effect.fail("boom")));
			assert.strictEqual(yield* read, true);
		}).pipe(Effect.provide(CliInteractive.layerTest(true))),
	);

	it.effect("an interrupted unless scope still restores the outer value", () =>
		Effect.gen(function* () {
			const fiber = yield* Effect.forkChild(CliInteractive.unless(true)(Effect.never));
			yield* Effect.yieldNow;
			yield* Fiber.interrupt(fiber);
			assert.strictEqual(yield* read, true);
		}).pipe(Effect.provide(CliInteractive.layerTest(true))),
	);
});
