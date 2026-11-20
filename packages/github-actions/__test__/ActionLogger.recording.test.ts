import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { ActionLogger } from "../src/index.js";

describe("ActionLogger.recording", () => {
	it.effect("captures a phase with a nested step tree and its outcomes", () => {
		const { layer, entries } = ActionLogger.recording();
		return Effect.gen(function* () {
			const logger = yield* ActionLogger;
			yield* logger.phase(
				"Prepare",
				logger.step(
					"outer",
					Effect.gen(function* () {
						yield* Effect.logInfo("hello");
						yield* logger.step("inner", Effect.logWarning("careful"), { summary: () => "inner done" });
						yield* Effect.flip(logger.step("bad", Effect.fail("boom")));
					}),
				),
			);
			assert.deepStrictEqual(entries(), [
				{ kind: "phase", title: "Prepare" },
				{
					kind: "step",
					name: "outer",
					outcome: "warning",
					summary: "outer",
					detail: ["hello"],
					steps: [
						{ kind: "step", name: "inner", outcome: "warning", summary: "inner done", detail: [], steps: [] },
						{ kind: "step", name: "bad", outcome: "failure", summary: "bad · boom", detail: [], steps: [] },
					],
				},
			]);
		}).pipe(Effect.provide(layer));
	});

	it.effect("passes the result through and records an interrupted step", () => {
		const { layer, entries } = ActionLogger.recording();
		return Effect.gen(function* () {
			const logger = yield* ActionLogger;
			assert.strictEqual(yield* logger.step("s", Effect.succeed(5)), 5);
			yield* Effect.exit(logger.step("i", Effect.interrupt));
			assert.deepStrictEqual(
				entries().map((entry) => (entry.kind === "step" ? entry.outcome : entry.kind)),
				["success", "interrupted"],
			);
		}).pipe(Effect.provide(layer));
	});
});
