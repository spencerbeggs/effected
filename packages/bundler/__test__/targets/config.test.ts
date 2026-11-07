// Ported from savvy-web/systems packages/tsdown-plugins/__test__/targets/config.test.ts on 2026-11-06
import { assert, describe, it } from "@effect/vitest";
import { isTargetObject } from "../../src/targets/config.js";

describe("isTargetObject", () => {
	it("is true only for object target values (not true or string)", () => {
		assert.strictEqual(isTargetObject({ registry: "https://r" }), true);
		assert.strictEqual(isTargetObject(true), false);
		assert.strictEqual(isTargetObject("@scope/x"), false);
	});
});
