import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import effectPackage from "effect/package.json" with { type: "json" };
import { Identity, IdentityReport } from "../src/index.js";

describe("Identity.report", () => {
	it.effect("reports the tool, echoes version and distribution, and resolves effect", () =>
		Effect.gen(function* () {
			const report = yield* Identity.report({ version: "1.2.3", distribution: { name: "effected", version: "1.2.3" } });
			assert.instanceOf(report, IdentityReport);
			assert.strictEqual(report.tool, "effected");
			assert.strictEqual(report.version, "1.2.3");
			assert.deepStrictEqual(report.distribution, { name: "effected", version: "1.2.3" });
			assert.match(report.effect, /^[0-9]+\.[0-9]+\.[0-9]+/);
			assert.strictEqual(report.effect, effectPackage.version);
		}),
	);

	it.effect("passes a null distribution through", () =>
		Effect.gen(function* () {
			const report = yield* Identity.report({ version: "0.0.1", distribution: null });
			assert.strictEqual(report.distribution, null);
		}),
	);
});
