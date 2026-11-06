import { assert, describe, it } from "@effect/vitest";
import { isTargetObject } from "../../src/targets/config.js";

describe("isTargetObject", () => {
	it("is true only for object target values (not true or string)", () => {
		assert.strictEqual(isTargetObject({ registry: "https://r" }), true);
		assert.strictEqual(isTargetObject(true), false);
		assert.strictEqual(isTargetObject("@scope/x"), false);
	});
});
