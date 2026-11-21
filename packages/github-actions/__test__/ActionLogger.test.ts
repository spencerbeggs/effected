import { assert, describe, it } from "@effect/vitest";
import { WorkflowCommand } from "@effected/github-commands";
import { Console, Context, Effect, Fiber, Latch, Layer, References } from "effect";
import { TestConsole } from "effect/testing";
import { ActionEnvironment, ActionLogger } from "../src/index.js";
import { commandLines, isCommand } from "./helpers/runnerCommands.js";

/** Everything written to `Console.log`, as strings, in order. */
const lines = Effect.map(TestConsole.logLines, (captured) => captured.map(String));

const live = <A, E>(program: Effect.Effect<A, E, ActionLogger>, env: Readonly<Record<string, string>> = {}) =>
	program.pipe(Effect.provide(ActionLogger.layer.pipe(Layer.provide(ActionEnvironment.layerTest(env)))));

describe("ActionLogger", () => {
	describe("groups", () => {
		it.effect("brackets the effect with ::group:: and ::endgroup::", () =>
			live(
				Effect.gen(function* () {
					const logger = yield* ActionLogger;
					const value = yield* logger.group("install", Effect.succeed(7));
					assert.strictEqual(value, 7);
					const captured = yield* lines;
					assert.deepStrictEqual(captured, ["::group::install", "::endgroup::"]);
				}),
			),
		);

		it.effect("closes the group even when the effect fails", () =>
			live(
				Effect.gen(function* () {
					const logger = yield* ActionLogger;
					yield* Effect.flip(logger.group("install", Effect.fail("boom")));
					const captured = yield* lines;
					assert.strictEqual(captured.at(-1), "::endgroup::");
				}),
			),
		);

		it.effect("escapes a group name that would otherwise inject a command", () =>
			live(
				Effect.gen(function* () {
					const logger = yield* ActionLogger;
					yield* logger.group("bad\n::error::smuggled", Effect.void);
					const captured = yield* lines;
					assert.strictEqual(captured[0], "::group::bad%0A::error::smuggled");
				}),
			),
		);
	});

	describe("annotations", () => {
		it.effect("emits a notice with its source annotation", () =>
			live(
				Effect.gen(function* () {
					yield* (yield* ActionLogger).notice("looks odd", { file: "src/a.ts", startLine: 12 });
					const captured = yield* lines;
					assert.deepStrictEqual(captured, ["::notice file=src/a.ts,line=12::looks odd"]);
				}),
			),
		);

		it.effect("annotated puts file and line on a log the workflow logger renders", () =>
			live(
				Effect.gen(function* () {
					const logger = yield* ActionLogger;
					yield* logger.annotated({ file: "src/b.ts", startLine: 3, startColumn: 5 }, Effect.logWarning("careful"));
					const captured = yield* lines;
					assert.deepStrictEqual(captured, ["::warning file=src/b.ts,line=3,col=5::careful"]);
				}),
			).pipe(Effect.provide(ActionLogger.layerLogger)),
		);
	});

	describe("the workflow-command logger", () => {
		const logged = <A, E>(program: Effect.Effect<A, E>) =>
			Effect.gen(function* () {
				yield* program;
				return yield* lines;
			}).pipe(Effect.provide(ActionLogger.layerLogger));

		it.effect("maps error to ::error::", () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* logged(Effect.logError("it broke")), ["::error::it broke"]);
			}),
		);

		it.effect("maps warning to ::warning::", () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* logged(Effect.logWarning("careful")), ["::warning::careful"]);
			}),
		);

		it.effect("maps info to plain text, with no command prefix", () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* logged(Effect.logInfo("hello")), ["hello"]);
			}),
		);

		it.effect("maps debug to ::debug::", () =>
			Effect.gen(function* () {
				const captured = yield* logged(
					Effect.logDebug("noisy").pipe(Effect.provideService(References.MinimumLogLevel, "All")),
				);
				assert.deepStrictEqual(captured, ["::debug::noisy"]);
			}),
		);

		it.effect("escapes a newline so a log line cannot become a second command", () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* logged(Effect.logError("line one\n::error::smuggled")), [
					"::error::line one%0A::error::smuggled",
				]);
			}),
		);

		it.effect("joins a multi-part message", () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* logged(Effect.logInfo("count", 3)), ["count 3"]);
			}),
		);
	});

	describe("silence", () => {
		it.effect("layerSilent drops log output entirely", () =>
			Effect.gen(function* () {
				yield* Effect.logError("would be noisy");
				assert.deepStrictEqual(yield* lines, []);
			}).pipe(Effect.provide(ActionLogger.layerSilent)),
		);

		it.effect("layerSilent still serves the service, passing effects through", () =>
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				assert.strictEqual(yield* logger.group("quiet", Effect.succeed(1)), 1);
				assert.deepStrictEqual(yield* lines, []);
			}).pipe(Effect.provide(ActionLogger.layerSilent)),
		);
	});

	describe("test double", () => {
		it.effect("the default double is silent rather than dying", () =>
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				yield* logger.notice("nothing to see");
				assert.strictEqual(yield* logger.step("step", Effect.succeed("value")), "value");
				assert.deepStrictEqual(yield* lines, []);
			}).pipe(Effect.provide(ActionLogger.layerTest())),
		);

		it.effect("an override wins over the silent default", () =>
			Effect.gen(function* () {
				const notices: Array<string> = [];
				yield* Effect.gen(function* () {
					yield* (yield* ActionLogger).notice("recorded");
				}).pipe(
					Effect.provide(
						ActionLogger.layerTest({
							notice: (message) => Effect.sync(() => void notices.push(message)),
						}),
					),
				);
				assert.deepStrictEqual(notices, ["recorded"]);
			}),
		);
	});
});

describe("ActionLogger group nesting", () => {
	// The runner does not nest groups: a second `::group::` implicitly ends the
	// first. So exactly one group/endgroup pair may reach the log, and a nested
	// call degrades to a header line inside it.

	it.effect("a nested group writes a header inside the outer group, not a second group command", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				yield* logger.group("Outer", logger.group("Inner", Console.log("body")));
				assert.deepStrictEqual(yield* lines, ["::group::Outer", "▸ Inner", "body", "::endgroup::"]);
			}),
		),
	);

	it.effect("three levels deep is still one group pair, with a header per nested level", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				yield* logger.group("L1", logger.group("L2", logger.group("L3", Console.log("deep"))));
				assert.deepStrictEqual(yield* lines, ["::group::L1", "▸ L2", "▸ L3", "deep", "::endgroup::"]);
			}),
		),
	);

	it.effect("sequential top-level groups each open a real group: depth resets when a group closes", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				yield* logger.group("A", Effect.void);
				yield* logger.group("B", Effect.void);
				assert.deepStrictEqual(yield* lines, ["::group::A", "::endgroup::", "::group::B", "::endgroup::"]);
			}),
		),
	);

	it.effect("a failing nested group closes once, last, and the next top-level group is real again", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				yield* Effect.flip(logger.group("F", logger.group("G", Effect.fail("boom"))));
				assert.deepStrictEqual(yield* lines, ["::group::F", "▸ G", "::endgroup::"]);
				yield* logger.group("After", Effect.void);
				assert.deepStrictEqual((yield* lines).slice(3), ["::group::After", "::endgroup::"]);
			}),
		),
	);

	it.effect("a hostile nested name is one header line that is not a command", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				yield* logger.group("Outer", logger.group("x\n::add-mask::s ##[error]y", Effect.void));
				const captured = yield* lines;
				assert.lengthOf(captured, 3, "the name's line break must not split the header");
				const header = captured[1] ?? "";
				assert.isTrue(header.startsWith("▸ x "));
				assert.isFalse(isCommand(header), header);
				assert.deepStrictEqual(commandLines(captured.join("\n")), ["::group::Outer", "::endgroup::"]);
			}),
		),
	);

	it.effect("a child fiber forked and joined inside a group inherits the depth", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				yield* logger.group(
					"Outer",
					Effect.flatMap(Effect.forkChild(logger.group("Child", Console.log("child"))), Fiber.join),
				);
				assert.deepStrictEqual(yield* lines, ["::group::Outer", "▸ Child", "child", "::endgroup::"]);
			}),
		),
	);

	it.effect("interrupting a fiber inside a nested group still closes the outer group", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				const inside = yield* Latch.make();
				const fiber = yield* Effect.forkChild(
					logger.group("Outer", logger.group("Inner", Effect.andThen(inside.open, Effect.never))),
				);
				yield* inside.await;
				yield* Fiber.interrupt(fiber);
				const captured = yield* lines;
				assert.deepStrictEqual(captured, ["::group::Outer", "▸ Inner", "::endgroup::"]);
			}),
		),
	);
});

describe("ActionLogger group depth is the kit-wide fiber-local", () => {
	// The count lives under `WorkflowCommand.groupDepthKey`, so a reference built from
	// that key anywhere (cli's `Render.context`, a consumer's wrapper) reads the depth
	// `group` provides, and a depth provided elsewhere is honoured here.
	const GroupDepth = Context.Reference<number>(WorkflowCommand.groupDepthKey, { defaultValue: () => 0 });

	it.effect("a reference built from the key reads the depth group provides, and phase leaves it alone", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				assert.strictEqual(yield* GroupDepth, 0);
				const seen = yield* logger.group(
					"Outer",
					Effect.all([GroupDepth, logger.group("Inner", GroupDepth), logger.phase("Phase", GroupDepth)]),
				);
				assert.deepStrictEqual(seen, [1, 2, 1]);
				assert.strictEqual(yield* GroupDepth, 0);
			}),
		),
	);

	it.effect("a group opened by another writer, provided through the key, turns group into a header line", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				yield* logger.group("Inner", Console.log("body")).pipe(Effect.provideService(GroupDepth, 1));
				assert.deepStrictEqual(yield* lines, ["▸ Inner", "body"]);
			}),
		),
	);
});
