import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import { unstubbed } from "../src/internal/unstubbed.js";

describe("unstubbed", () => {
	it.effect("dies with a defect naming the double, the member and the fix, and never fails typed", () =>
		Effect.gen(function* () {
			const dies = unstubbed("Example.makeTest");
			const exit = yield* Effect.exit(dies("save"));
			if (!Exit.isFailure(exit)) return assert.fail("an unstubbed member must not succeed");
			assert.isFalse(Cause.hasFails(exit.cause), "an unstubbed member must die, never fail typed");
			assert.isTrue(Cause.hasDies(exit.cause));
			const pretty = Cause.pretty(exit.cause);
			assert.include(pretty, "Example.makeTest: save() was called but not stubbed");
			assert.include(pretty, "pass a `save` override");
		}),
	);

	it("building the member's effect does not throw", () => {
		// The die happens when the effect RUNS; a member can be referenced, piped
		// and composed without running it.
		const effect = unstubbed("Example.makeTest")("load");
		assert.isTrue(Effect.isEffect(effect));
	});
});
