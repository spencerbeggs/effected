// The `--watch` helpers both build commands share, on their own: what `reportAndContinue` renders and what it lets end
// the watch.
import { assert, describe, it } from "@effect/vitest";
import { CliLinks, CliTheme } from "@effected/cli-kit";
import { Audience, TerminalEnv } from "@effected/env";
import { Cause, Effect, Exit, Layer, Schema } from "effect";
import { TestConsole } from "effect/testing";
import { reportAndContinue } from "../src/commands/watch.js";

class BuildBroke extends Schema.TaggedError<BuildBroke>()("BuildBroke", {}) {
	override get message(): string {
		return "the build broke";
	}
}

const Presentation = Layer.mergeAll(
	CliTheme.layerTest(),
	TerminalEnv.layerTest(),
	Audience.layerTest("human"),
	CliLinks.layerTest("off"),
);

const stderr = Effect.map(TestConsole.errorLines, (lines) => lines.map(String).join("\n"));

describe("reportAndContinue", () => {
	it.effect("renders a failure on stderr and succeeds", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(reportAndContinue(Effect.fail(new BuildBroke())));
			assert.isTrue(Exit.isSuccess(exit));
			assert.include(yield* stderr, "the build broke");
		}).pipe(Effect.provide(Presentation)),
	);

	it.effect("renders a failure that arrived with an interrupt, and succeeds", () =>
		Effect.gen(function* () {
			const mixed = Cause.combine(Cause.fail(new BuildBroke()), Cause.interrupt());
			const exit = yield* Effect.exit(reportAndContinue(Effect.failCause(mixed)));
			assert.isTrue(Exit.isSuccess(exit), "a sibling's interrupt does not end the watch");
			assert.include(yield* stderr, "the build broke");
		}).pipe(Effect.provide(Presentation)),
	);

	it.effect("lets an interrupt through untouched, rendering nothing", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(reportAndContinue(Effect.interrupt));
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterruptsOnly(exit.cause), "the exit is interrupt-only");
			assert.strictEqual(yield* stderr, "");
		}).pipe(Effect.provide(Presentation)),
	);
});
