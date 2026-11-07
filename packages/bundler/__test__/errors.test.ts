// Ported from savvy-web/systems packages/tsdown-plugins/__test__/errors.test.ts on 2026-11-06
import { assert, describe, it } from "@effect/vitest";
import { ConfigValidationError, MetaGenerationError, TsdoctorEmitError } from "../src/errors.js";

describe("typed errors", () => {
	it("MetaGenerationError carries the entry and reason", () => {
		const e = new MetaGenerationError({ entry: "index", reason: "extractor failed" });
		assert.strictEqual(e._tag, "MetaGenerationError");
		assert.include(e.message, "index");
	});

	it("TsdoctorEmitError names the package, path and cause", () => {
		const e = new TsdoctorEmitError({ packageName: "@x/p", path: "meta/tsdoctor.json", cause: new Error("disk full") });
		assert.strictEqual(e._tag, "TsdoctorEmitError");
		assert.include(e.message, "@x/p");
		assert.include(e.message, "disk full");
	});

	it("ConfigValidationError carries the path and reason", () => {
		const e = new ConfigValidationError({ path: "publishConfig.targets.mirror", reason: "dangling from" });
		assert.strictEqual(e._tag, "ConfigValidationError");
		assert.include(e.message, "publishConfig.targets.mirror");
		assert.include(e.message, "dangling from");
	});
});
