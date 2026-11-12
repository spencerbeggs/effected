import { assert, describe, it } from "@effect/vitest";
import { HostedSchema } from "@effected/schemastore";
import { EffectedConfigSchema } from "../../src/index.js";

describe("EffectedConfigSchema", () => {
	it("names the URL HostedSchema derives from its host, so a directive and the published $id agree", () => {
		assert.strictEqual(HostedSchema.github(EffectedConfigSchema.host).$id, EffectedConfigSchema.url);
	});

	it("is a #:schema directive naming that URL", () => {
		assert.strictEqual(EffectedConfigSchema.directive, `#:schema ${EffectedConfigSchema.url}`);
	});
});
