import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { ChildProcess, CommandLine } from "effect/process";
import { TestClock, TestConsole } from "effect/testing";
import { ActionEnvironment, ActionLogger } from "../src/index.js";
import { commandLines } from "./helpers/runnerCommands.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: the colour codes are exactly what is being stripped
const SGR = /\x1b\[[0-9;]*m/g;
const lines = Effect.map(TestConsole.logLines, (captured) => captured.map((line) => String(line).replace(SGR, "")));

const live = <A, E, R>(program: Effect.Effect<A, E, R>) =>
	program.pipe(
		Effect.provide(
			Layer.mergeAll(
				ActionLogger.layer.pipe(Layer.provide(ActionEnvironment.layerTest({}))),
				ActionLogger.layerLogger,
				NodeServices.layer,
			),
		),
	);

const script = "console.log('out line'); console.error('err line'); process.exit(3)";

describe("ActionLogger.command", () => {
	it.effect("records the command line, both streams and the exit code in a step's detail", () =>
		live(
			Effect.gen(function* () {
				const logger = yield* ActionLogger;
				const result = yield* logger.step("run", ActionLogger.command(ChildProcess.make("node", ["-e", script])));
				assert.strictEqual(result.exitCode, 3);
				assert.strictEqual(result.stdout.trim(), "out line");
				assert.strictEqual(result.stderr.trim(), "err line");
				const captured = yield* lines;
				assert.strictEqual(captured[0]?.startsWith("::group::"), true);
				const body = captured.slice(1, -1);
				assert.strictEqual(body[0], `$ ${CommandLine.display(["node", "-e", script])}`);
				assert.sameMembers(body.slice(1, 3), ["out line", "err line"]);
				assert.strictEqual(body[3], "exit 3");
			}),
		),
	);

	it.effect("collects stderr whole and apart from stdout, so a failure can be classified from it", () =>
		live(
			Effect.gen(function* () {
				// npm's shape: a failing install writes its error code to stderr, and only there.
				const npmLike = [
					"process.stdout.write('progress 1\\nprogress 2\\n');",
					"process.stderr.write('npm error code ETARGET\\n');",
					"process.stderr.write('npm error notarget No matching version\\n');",
					"process.exit(1)",
				].join(" ");
				const failed = yield* ActionLogger.command(ChildProcess.make("node", ["-e", npmLike]), { display: "x" });
				assert.strictEqual(failed.exitCode, 1);
				assert.strictEqual(failed.stderr, "npm error code ETARGET\nnpm error notarget No matching version\n");
				assert.strictEqual(failed.stdout, "progress 1\nprogress 2\n");
				assert.notInclude(failed.stdout, "ETARGET");
				// A child that writes nothing to stderr resolves with an empty string, not a missing field.
				const quiet = yield* ActionLogger.command(ChildProcess.make("node", ["-e", "console.log('ok')"]), {
					display: "y",
				});
				assert.strictEqual(quiet.stderr, "");
				assert.strictEqual(quiet.stdout, "ok\n");
			}),
		),
	);

	it.effect("shows the display text instead of the command line", () =>
		live(
			Effect.gen(function* () {
				yield* (yield* ActionLogger).step(
					"run",
					ActionLogger.command(ChildProcess.make("node", ["-e", "0"]), { display: "build it" }),
				);
				assert.include(yield* lines, "$ build it");
			}),
		),
	);

	it.effect("outside any step the lines print live", () =>
		live(
			Effect.gen(function* () {
				yield* ActionLogger.command(ChildProcess.make("node", ["-e", "console.log('hi')"]), { display: "x" });
				assert.deepStrictEqual(yield* lines, ["$ x", "hi", "exit 0"]);
			}),
		),
	);

	it.effect(
		"stops reading a pipe a grandchild still holds once the drain bound passes after the child exits",
		() =>
			live(
				Effect.gen(function* () {
					// The child writes, starts a grandchild that inherits stdout and stays alive, and exits.
					const parent = [
						"const { spawn } = require('node:child_process');",
						"spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: ['ignore', 'inherit', 'inherit'] }).unref();",
						"console.log('parent done');",
					].join(" ");
					const fiber = yield* Effect.forkChild(
						ActionLogger.command(ChildProcess.make("node", ["-e", parent]), { display: "x" }),
					);
					// Advance the test clock until the drain bound has passed after the real child's exit.
					for (let tries = 0; tries < 200 && fiber.pollUnsafe() === undefined; tries++) {
						yield* TestClock.withLive(Effect.sleep("25 millis"));
						yield* TestClock.adjust("10 seconds");
					}
					const result = yield* Fiber.join(fiber);
					assert.strictEqual(result.exitCode, 0);
					assert.strictEqual(result.stdout, "parent done\n");
					assert.strictEqual(result.stderr, "");
				}),
			),
		{ timeout: 10_000 },
	);

	it.effect("a hostile line from the child is never a workflow command", () =>
		live(
			Effect.gen(function* () {
				yield* ActionLogger.command(ChildProcess.make("node", ["-e", "console.log('::add-mask::secret')"]));
				const captured = (yield* TestConsole.logLines).map(String);
				assert.deepStrictEqual(commandLines(captured.join("\n")), [], JSON.stringify(captured));
				// The line still prints, neutralized, rather than being dropped.
				assert.isTrue(
					captured.some((line) => line.includes("add-mask") && line.includes("secret")),
					JSON.stringify(captured),
				);
			}),
		),
	);
});
