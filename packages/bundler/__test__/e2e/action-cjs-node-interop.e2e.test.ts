// Ported from @savvy-web/github-action-builder __test__/integration/cjs-node-interop.int.test.ts.
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { ActionBundle } from "../../src/index.js";
import { configOf, runBundle, withFixture } from "./action-fixture.js";

describe("a bundled CommonJS dependency", () => {
	it.live("keeps __importDefault(require('node:*')) and instanceof working", () =>
		withFixture("cjs-node-interop", (cwd) =>
			Effect.gen(function* () {
				const result = yield* ActionBundle.build(configOf({ build: { minify: false } }), { cwd, clean: true });
				assert.isTrue(result.success, JSON.stringify(result));
				assert.strictEqual(runBundle(join(cwd, "dist", "main.js")).trim(), "isStream=true");
			}),
		),
	);
});
