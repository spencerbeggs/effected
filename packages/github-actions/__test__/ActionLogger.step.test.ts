import { assert, describe, it } from "@effect/vitest";
import { WorkflowCommand } from "@effected/github-commands";
import { Context, Effect, Fiber, Latch, Layer } from "effect";
import { TestConsole } from "effect/testing";
import { ActionEnvironment, ActionLogger } from "../src/index.js";
import { formatDuration } from "../src/internal/stepLog.js";

/** SGR escape sequences, the only escapes the step log writes. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the colour codes are exactly what is being stripped
const SGR = /\x1b\[[0-9;]*m/g;

/** Everything written to `Console.log`, colour codes stripped, in order. */
const lines = Effect.map(TestConsole.logLines, (captured) => captured.map((line) => String(line).replace(SGR, "")));

/** The raw lines, colour codes kept. */
const rawLines = Effect.map(TestConsole.logLines, (captured) => captured.map(String));

const live = <A, E>(program: Effect.Effect<A, E, ActionLogger>) =>
	program.pipe(Effect.provide(ActionLogger.layer.pipe(Layer.provide(ActionEnvironment.layerTest({})))));

/** The kit-wide group depth, read the way `@effected/cli-kit`'s `Render.context` reads it. */
const GroupDepth = Context.Reference<number>(WorkflowCommand.groupDepthKey, { defaultValue: () => 0 });

describe("ActionLogger step", () => {
	it.effect("a green step with detail folds under its result", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				const value = yield* logger.step("fetch", Effect.logInfo("a").pipe(Effect.as(3)), {
					summary: (n) => `fetched ${n}`,
				});
				assert.strictEqual(value, 3);
				assert.deepStrictEqual(yield* lines, ["::group::✓ fetched 3 · 0.0s", "a", "::endgroup::"]);
			}),
		),
	);

	it.effect("colours the mark green and the duration dim", () =>
		live(
			Effect.gen(function* () {
				yield* (yield* ActionLogger).step("fetch", Effect.void);
				assert.deepStrictEqual(yield* rawLines, ["\x1b[32m✓\x1b[39m fetch · \x1b[2m0.0s\x1b[22m"]);
			}),
		),
	);

	it.effect("a green step without detail is a plain line", () =>
		live(
			Effect.gen(function* () {
				yield* (yield* ActionLogger).step("fetch", Effect.void);
				assert.deepStrictEqual(yield* lines, ["✓ fetch · 0.0s"]);
			}),
		),
	);

	it.effect("Debug lines are detail", () =>
		live(
			Effect.gen(function* () {
				yield* (yield* ActionLogger).step("fetch", Effect.logDebug("$ git fetch"));
				assert.deepStrictEqual(yield* lines, ["::group::✓ fetch · 0.0s", "$ git fetch", "::endgroup::"]);
			}),
		),
	);

	it.effect("a failed step is never folded", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				const boom = new Error("boom\nsecond line");
				const error = yield* Effect.flip(
					logger.step("fetch", Effect.andThen(Effect.logInfo("$ git fetch"), Effect.fail(boom))),
				);
				assert.strictEqual(error, boom);
				assert.deepStrictEqual(yield* lines, ["✗ fetch · boom · 0.0s", "  $ git fetch"]);
			}),
		),
	);

	it.effect("a failure summary replaces the message", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				yield* Effect.flip(
					logger.step("fetch", Effect.fail(new Error("boom")), { failure: () => "fetch failed · ref not found" }),
				);
				assert.deepStrictEqual(yield* lines, ["✗ fetch failed · ref not found · 0.0s"]);
			}),
		),
	);

	it.effect("an interrupted step flushes as a failure", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				const inside = yield* Latch.make();
				const fiber = yield* Effect.forkChild(
					logger.step(
						"fetch",
						Effect.logInfo("started").pipe(Effect.andThen(inside.open), Effect.andThen(Effect.never)),
					),
				);
				yield* inside.await;
				yield* Fiber.interrupt(fiber);
				assert.deepStrictEqual(yield* lines, ["✗ fetch · interrupted", "  started"]);
			}),
		),
	);

	it.effect("warnings go out live and mark the step", () =>
		live(
			Effect.gen(function* () {
				yield* (yield* ActionLogger).step("fetch", Effect.logWarning("w"));
				assert.deepStrictEqual(yield* lines, ["::warning::w", "⚠ fetch · 1 warning · 0.0s"]);
			}),
		),
	);

	it.effect("an inner step renders as a result line inside the outer fold", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				yield* logger.step("prepare", logger.step("inner", Effect.logInfo("x")));
				assert.deepStrictEqual(yield* lines, ["::group::✓ prepare · 0.0s", "  x", "✓ inner · 0.0s", "::endgroup::"]);
			}),
		),
	);

	it.effect("an inner warning makes the outer step warn", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				yield* logger.step("prepare", logger.step("inner", Effect.logWarning("w")));
				assert.deepStrictEqual(yield* lines, [
					"::warning::w",
					"::group::⚠ prepare · 1 warning · 0.0s",
					"⚠ inner · 1 warning · 0.0s",
					"::endgroup::",
				]);
			}),
		),
	);

	it.effect("a phase is one heading line", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				const value = yield* logger.phase("Checkout o/r", logger.step("fetch", Effect.as(Effect.logInfo("a"), 5)));
				assert.strictEqual(value, 5);
				assert.deepStrictEqual(yield* lines, ["Checkout o/r", "::group::✓ fetch · 0.0s", "a", "::endgroup::"]);
				assert.strictEqual((yield* rawLines)[0], "\x1b[1mCheckout o/r\x1b[22m");
			}),
		),
	);

	it.effect("group inside a step renders plain", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				const seen = yield* logger.step(
					"fetch",
					logger.group("refs", Effect.andThen(Effect.logInfo("in group"), GroupDepth)),
				);
				assert.isAtLeast(seen, 1);
				assert.deepStrictEqual(yield* lines, ["::group::✓ fetch · 0.0s", "▸ refs", "in group", "::endgroup::"]);
			}),
		),
	);

	it.effect("neutralizes a detail line that would be a workflow command", () =>
		live(
			Effect.gen(function* () {
				yield* (yield* ActionLogger).step("fetch", Effect.logInfo("::add-mask::secret"));
				const captured = yield* lines;
				assert.notStrictEqual(captured[1], "::add-mask::secret");
				assert.isFalse(captured[1]?.startsWith("::"));
			}),
		),
	);
});

describe("formatDuration", () => {
	it("renders tenths of a second under a minute and minutes past it", () => {
		assert.strictEqual(formatDuration(0), "0.0s");
		assert.strictEqual(formatDuration(1234), "1.2s");
		assert.strictEqual(formatDuration(41_000), "41.0s");
		assert.strictEqual(formatDuration(221_000), "3m 41s");
	});
});
