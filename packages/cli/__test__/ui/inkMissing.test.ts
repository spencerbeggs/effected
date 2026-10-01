import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import { vi } from "vitest";
import { loadInk } from "../../src/ui/internal/ink.js";

vi.mock("ink", () => {
	throw new Error("Cannot find package 'ink'");
});

describe("a missing optional peer", () => {
	it.effect("loadInk dies, never fails, with a message naming ink and react as optional peers", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(loadInk);
			if (Exit.isFailure(exit)) {
				assert.isFalse(Cause.hasFails(exit.cause), "a missing peer is not a typed failure");
				assert.isTrue(Cause.hasDies(exit.cause));
				const defect = Cause.squash(exit.cause);
				assert.instanceOf(defect, Error);
				const message = defect instanceof Error ? defect.message : "";
				assert.include(message, "optional peers ink and react");
				assert.include(message, "install");
			} else {
				assert.fail("expected loadInk to die without ink");
			}
		}),
	);
});
