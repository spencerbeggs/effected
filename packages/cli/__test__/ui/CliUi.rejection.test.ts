import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import { vi } from "vitest";

// Ink whose waitUntilExit rejects at once, as it does when the app crashes outside any boundary.
vi.mock("ink", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ink")>();
	return {
		...actual,
		render: (...args: Parameters<typeof actual.render>) => {
			const instance = actual.render(...args);
			return { ...instance, waitUntilExit: () => Promise.reject(new Error("ink crashed")) };
		},
	};
});

describe("CliUi.run when Ink's exit rejects", () => {
	it.live("dies with the rejection, never hangs", () =>
		Effect.gen(function* () {
			const { createElement } = yield* Effect.promise(() => import("react"));
			const { Text } = yield* Effect.promise(() => import("ink"));
			const { CliInteractive, CliTheme } = yield* Effect.promise(() => import("../../src/index.js"));
			const { CliUi, UiStreams } = yield* Effect.promise(() => import("../../src/ui.js"));
			const { makeFakeStreams } = yield* Effect.promise(() => import("../../src/ui/testing/fakeStreams.js"));
			const fake = makeFakeStreams();
			const exit = yield* Effect.exit(
				CliUi.run(() => createElement(Text, null, "doomed")).pipe(
					Effect.provideService(UiStreams, fake.streams),
					Effect.provideService(CliInteractive, true),
					Effect.provide(CliTheme.layerTest()),
					Effect.timeout("2 seconds"),
				),
			);
			if (Exit.isFailure(exit)) {
				assert.isTrue(Cause.hasDies(exit.cause), "a defect");
				assert.isFalse(Cause.hasFails(exit.cause), "not a typed failure, and not the timeout");
				const defect = Cause.squash(exit.cause);
				assert.strictEqual(defect instanceof Error ? defect.message : "", "ink crashed");
			} else {
				assert.fail("expected a defect, but the screen resolved");
			}
		}),
	);
});
