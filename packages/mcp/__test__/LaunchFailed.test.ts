// LaunchFailed carries core's runtime markers as prototype getters, as the kit's other marked errors do: core still
// reads them, and a JSON or logger dump of the error does not carry them.
import { assert, describe, it } from "@effect/vitest";
import { Runtime } from "effect";
import { LaunchFailed } from "../src/internal/LaunchFailed.js";

describe("LaunchFailed", () => {
	it("core reads its exit code and that it is not to be reported again", () => {
		const error = new LaunchFailed(3);
		assert.strictEqual(Runtime.getErrorExitCode(error), 3);
		assert.isFalse(Runtime.getErrorReported(error));
		assert.isTrue(Runtime.getErrorReported(new Error("control: an unmarked error is reported")));
		assert.strictEqual(Runtime.getErrorExitCode(new LaunchFailed(70)), 70, "each instance keeps its own code");
	});

	it("a dump of the error does not carry the runtime markers", () => {
		const error = new LaunchFailed(3);
		const own = Object.keys(error);
		assert.notInclude(own, Runtime.errorExitCode);
		assert.notInclude(own, Runtime.errorReported);
		const dump = JSON.stringify(error);
		assert.notInclude(dump, Runtime.errorExitCode);
		assert.notInclude(dump, Runtime.errorReported);
	});
});
