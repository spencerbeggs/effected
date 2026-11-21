import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { ChildProcess, CommandLine } from "effect/process";
import { TestConsole } from "effect/testing";
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
				const captured = yield* lines;
				assert.strictEqual(captured[0]?.startsWith("::group::"), true);
				const body = captured.slice(1, -1);
				assert.strictEqual(body[0], `$ ${CommandLine.display(["node", "-e", script])}`);
				assert.sameMembers(body.slice(1, 3), ["out line", "err line"]);
				assert.strictEqual(body[3], "exit 3");
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
