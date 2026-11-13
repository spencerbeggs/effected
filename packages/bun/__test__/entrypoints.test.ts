import { assert, describe, it } from "@effect/vitest";

describe("@effected/bun root entry", () => {
	it("exports the bun-only lockfile document and extension", async () => {
		assert.deepStrictEqual(Object.keys(await import("../src/index.js")).sort(), ["BunExtension", "BunLockDocument"]);
	});
});
