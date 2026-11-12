import { assert, describe, it } from "@effect/vitest";

describe("@effected/pnpm root entry", () => {
	it("exports nothing until its modules move in", async () => {
		assert.deepStrictEqual(Object.keys(await import("../src/index.js")), []);
	});
});
