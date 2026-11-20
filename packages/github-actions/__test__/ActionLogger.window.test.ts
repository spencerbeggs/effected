import { assert, describe, it } from "@effect/vitest";
import { WorkflowCommand } from "@effected/github-commands";
import type { Duration } from "effect";
import { Console, Effect, Fiber, Latch, Layer, References } from "effect";
import { TestClock, TestConsole } from "effect/testing";
import { ActionEnvironment, ActionLogger } from "../src/index.js";

/** SGR escape sequences, the only escapes the step log writes. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the colour codes are exactly what is being stripped
const SGR = /\x1b\[[0-9;]*m/g;

/** Everything written to `Console.log`, colour codes stripped, in order. */
const lines = Effect.map(TestConsole.logLines, (captured) => captured.map((line) => String(line).replace(SGR, "")));

const withEnv =
	(overrides: Readonly<Record<string, string>>) =>
	<A, E>(program: Effect.Effect<A, E, ActionLogger>) =>
		program.pipe(Effect.provide(ActionLogger.layer.pipe(Layer.provide(ActionEnvironment.layerTest(overrides)))));

const live = withEnv({});

describe("ActionLogger step windows", () => {
	it.effect("a step that finishes inside its window folds", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				const fiber = yield* Effect.forkChild(
					logger.step("fetch", Effect.andThen(Effect.logInfo("a"), Effect.sleep("500 millis")), { window: "1 second" }),
				);
				yield* TestClock.adjust("500 millis");
				yield* Fiber.join(fiber);
				yield* TestClock.adjust("5 seconds");
				assert.deepStrictEqual(yield* lines, ["::group::✓ fetch · 0.5s", "a", "::endgroup::"]);
			}),
		),
	);

	it.effect("a step past its window goes live", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				const fiber = yield* Effect.forkChild(
					logger.step(
						"install",
						Effect.logInfo("a").pipe(Effect.andThen(Effect.sleep("2 seconds")), Effect.andThen(Effect.logInfo("b"))),
						{ window: "1 second" },
					),
				);
				yield* TestClock.adjust("1 second");
				assert.deepStrictEqual(yield* lines, ["… install is taking longer than 1s, showing live output", "  a"]);
				yield* TestClock.adjust("1 second");
				yield* Fiber.join(fiber);
				const all = yield* lines;
				assert.deepStrictEqual(all, [
					"… install is taking longer than 1s, showing live output",
					"  a",
					"  b",
					"✓ install · 2.0s",
				]);
				assert.isFalse(all.some((line) => line.startsWith("::group::")));
			}),
		),
	);

	it.effect("the default window is 30 seconds", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				const fiber = yield* Effect.forkChild(logger.step("install", Effect.sleep("1 minute")));
				yield* TestClock.adjust("29 seconds");
				assert.deepStrictEqual(yield* lines, []);
				yield* TestClock.adjust("1 second");
				assert.deepStrictEqual(yield* lines, ["… install is taking longer than 30s, showing live output"]);
				yield* TestClock.adjust("30 seconds");
				yield* Fiber.join(fiber);
			}),
		),
	);

	it.effect("a live step with no detail still closes", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				const fiber = yield* Effect.forkChild(logger.step("wait", Effect.sleep("2 seconds"), { window: "1 second" }));
				yield* TestClock.adjust("2 seconds");
				yield* Fiber.join(fiber);
				assert.deepStrictEqual(yield* lines, ["… wait is taking longer than 1s, showing live output", "✓ wait · 2.0s"]);
			}),
		),
	);

	it.effect("a live step that fails closes with ✗ and no fold", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				const fiber = yield* Effect.forkChild(
					Effect.flip(
						logger.step(
							"fetch",
							Effect.logInfo("$ git fetch").pipe(
								Effect.andThen(Effect.sleep("2 seconds")),
								Effect.andThen(Effect.fail(new Error("boom"))),
							),
							{ window: "1 second" },
						),
					),
				);
				yield* TestClock.adjust("2 seconds");
				yield* Fiber.join(fiber);
				assert.deepStrictEqual(yield* lines, [
					"… fetch is taking longer than 1s, showing live output",
					"  $ git fetch",
					"✗ fetch · boom · 2.0s",
				]);
			}),
		),
	);

	it.effect("a live step's inner steps print their result lines as they finish", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				const fiber = yield* Effect.forkChild(
					logger.step(
						"prepare",
						logger
							.step("inner", Effect.logInfo("x"))
							.pipe(Effect.andThen(Effect.sleep("2 seconds")), Effect.andThen(logger.step("second", Effect.void))),
						{ window: 0 },
					),
				);
				yield* TestClock.adjust("1 second");
				assert.deepStrictEqual(yield* lines, ["… prepare", "    x", "  ✓ inner · 0.0s"]);
				yield* TestClock.adjust("1 second");
				yield* Fiber.join(fiber);
				assert.deepStrictEqual(yield* lines, [
					"… prepare",
					"    x",
					"  ✓ inner · 0.0s",
					"  ✓ second · 0.0s",
					"✓ prepare · 2.0s",
				]);
			}),
		),
	);

	it.effect("a recovered inner failure marks a live step and is still unfolded", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				yield* logger.step(
					"prepare",
					Effect.catch(logger.step("inner", Effect.fail(new Error("boom"))), () => Effect.void),
					{ window: 0 },
				);
				assert.deepStrictEqual(yield* lines, [
					"… prepare",
					"  ✗ inner · boom · 0.0s",
					"⚠ prepare · 1 failed step · 0.0s",
				]);
			}),
		),
	);

	it.effect("debug forces live", () =>
		withEnv({ RUNNER_DEBUG: "1" })(
			Effect.gen(function* () {
				yield* (yield* ActionLogger).step("fetch", Effect.logDebug("$ git fetch"));
				assert.deepStrictEqual(yield* lines, ["… fetch", "  $ git fetch", "✓ fetch · 0.0s"]);
			}),
		),
	);

	it.effect("an ambient Debug minimum level forces live", () =>
		live(
			Effect.gen(function* () {
				yield* (yield* ActionLogger).step("fetch", Effect.logInfo("a"));
				assert.deepStrictEqual(yield* lines, ["… fetch", "  a", "✓ fetch · 0.0s"]);
			}).pipe(Effect.provideService(References.MinimumLogLevel, "Debug")),
		),
	);

	it.effect("concurrent live steps prefix their lines", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				// Both go live at 1 s and log at 2 s and 3 s; the first runs on to 4 s, so both are live at every log.
				const body = (tag: string, tail: Duration.Input) =>
					Effect.sleep("2 seconds").pipe(
						Effect.andThen(Effect.logInfo(`${tag} 1`)),
						Effect.andThen(Effect.sleep("1 second")),
						Effect.andThen(Effect.logInfo(`${tag} 2`)),
						Effect.andThen(Effect.sleep(tail)),
					);
				const fiber = yield* Effect.forkChild(
					Effect.all(
						[
							logger.step("first", body("a", "1 second"), { window: "1 second" }),
							logger.step("second", body("b", 0), { window: "1 second" }),
						],
						{ concurrency: 2 },
					),
				);
				yield* TestClock.adjust("4 seconds");
				yield* Fiber.join(fiber);
				const all = yield* lines;
				const detail = all.filter((line) => line.startsWith("  "));
				assert.deepStrictEqual(detail.toSorted(), [
					"  [first]  a 1",
					"  [first]  a 2",
					"  [second]  b 1",
					"  [second]  b 2",
				]);
				assert.includeMembers(all, [
					"… first is taking longer than 1s, showing live output",
					"… second is taking longer than 1s, showing live output",
					"✓ first · 4.0s",
					"✓ second · 3.0s",
				]);
			}),
		),
	);

	it.effect("a zero-window step interrupted as it opens still closes, so a later live step has no prefix", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				const real = yield* Console.Console;
				// Interrupt the step's own fiber the moment its opening line is written: after its window is armed
				// and before its body starts.
				const fiber = yield* Effect.forkChild(
					Effect.withFiber((self) =>
						logger.step("first", Effect.never, { window: 0 }).pipe(
							Effect.provideService(Console.Console, {
								...real,
								log: (...args: ReadonlyArray<unknown>) => {
									real.log(...args);
									if (String(args[0]).includes("… first")) self.interruptUnsafe();
								},
							}),
						),
					),
				);
				yield* Fiber.await(fiber);
				yield* logger.step("second", Effect.logInfo("b"), { window: 0 });
				const all = yield* lines;
				assert.include(all, "  b");
				assert.notInclude(all, "  [second]  b");
				assert.include(all, "✗ first · interrupted");
			}),
		),
	);

	it.effect("an inner step's window is ignored", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				const fiber = yield* Effect.forkChild(
					logger.step(
						"outer",
						logger.step("inner", Effect.andThen(Effect.logInfo("x"), Effect.sleep("500 millis")), { window: 0 }),
						{ window: "1 second" },
					),
				);
				yield* TestClock.adjust("500 millis");
				yield* Fiber.join(fiber);
				yield* TestClock.adjust("5 seconds");
				assert.deepStrictEqual(yield* lines, ["::group::✓ outer · 0.5s", "  x", "✓ inner · 0.5s", "::endgroup::"]);
			}),
		),
	);

	describe("Console writes inside a step", () => {
		it.effect("a Console.log inside a held step lands in the fold", () =>
			live(
				Effect.gen(function* () {
					yield* (yield* ActionLogger).step("render", Console.log("table row", 3));
					assert.deepStrictEqual(yield* lines, ["::group::✓ render · 0.0s", "table row 3", "::endgroup::"]);
				}),
			),
		);

		it.effect("a Console.log inside a live step streams indented", () =>
			live(
				Effect.gen(function* () {
					yield* (yield* ActionLogger).step("render", Console.log("line one\nline two"), { window: 0 });
					assert.deepStrictEqual(yield* lines, ["… render", "  line one", "  line two", "✓ render · 0.0s"]);
				}),
			),
		);

		it.effect("a group command written to Console becomes a header line of the detail", () =>
			live(
				Effect.gen(function* () {
					yield* (yield* ActionLogger).step(
						"render",
						Console.log([WorkflowCommand.group("refs"), "main", WorkflowCommand.endGroup()].join("\n")),
					);
					assert.deepStrictEqual(yield* lines, ["::group::✓ render · 0.0s", "▸ refs", "main", "::endgroup::"]);
				}),
			),
		);

		it.effect("a mask command written to Console goes out at once, ahead of the fold", () =>
			live(
				Effect.gen(function* () {
					yield* (yield* ActionLogger).step(
						"auth",
						Effect.andThen(Console.log(WorkflowCommand.addMask("s3cret")), Effect.logInfo("token s3cret")),
					);
					assert.deepStrictEqual(yield* lines, [
						"::add-mask::s3cret",
						"::group::✓ auth · 0.0s",
						"token s3cret",
						"::endgroup::",
					]);
				}),
			),
		);

		it.effect("an annotation written to Console goes out at once and counts against the step", () =>
			live(
				Effect.gen(function* () {
					yield* (yield* ActionLogger).step("check", Console.log(WorkflowCommand.warning("peer missing")));
					assert.deepStrictEqual(yield* lines, ["::warning::peer missing", "⚠ check · 1 warning · 0.0s"]);
				}),
			),
		);

		it.effect("a notice inside a step reaches the console", () =>
			live(
				Effect.gen(function* () {
					const logger = yield* ActionLogger;
					yield* logger.step("check", logger.notice("hello"));
					assert.deepStrictEqual(yield* lines, ["::notice::hello", "✓ check · 0.0s"]);
				}),
			),
		);

		it.effect("a logged warning inside a step is written once", () =>
			live(
				Effect.gen(function* () {
					yield* (yield* ActionLogger).step("check", Effect.logWarning("w"));
					assert.deepStrictEqual(yield* lines, ["::warning::w", "⚠ check · 1 warning · 0.0s"]);
				}),
			),
		);
	});

	describe("a fiber forked inside a step", () => {
		it.effect("prints detail logged after the step closed as ordinary lines", () =>
			live(
				Effect.gen(function* () {
					const logger = yield* ActionLogger;
					const later = yield* Latch.make();
					const fiber = yield* logger.step(
						"spawn",
						Effect.forkChild(
							later.await.pipe(Effect.andThen(Effect.logInfo("late log")), Effect.andThen(Console.log("late console"))),
						),
					);
					yield* later.open;
					yield* Fiber.join(fiber);
					assert.deepStrictEqual(yield* lines, ["✓ spawn · 0.0s", "late log", "late console"]);
				}),
			),
		);

		it.effect("opens a fresh step after its parent step closed", () =>
			live(
				Effect.gen(function* () {
					const logger = yield* ActionLogger;
					const later = yield* Latch.make();
					const fiber = yield* logger.step(
						"spawn",
						Effect.forkChild(later.await.pipe(Effect.andThen(logger.step("after", Effect.logInfo("x"))))),
					);
					yield* later.open;
					yield* Fiber.join(fiber);
					assert.deepStrictEqual(yield* lines, ["✓ spawn · 0.0s", "::group::✓ after · 0.0s", "x", "::endgroup::"]);
				}),
			),
		);
	});
});
