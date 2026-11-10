// Ported from @savvy-web/github-action-builder __test__/integration/cjs-node-interop.int.test.ts.
import { join } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { ActionBuilder, ActionBundle } from "../../src/index.js";
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

	it.live("comes through the whole ActionBuilder, as far as the local action directory", () =>
		withFixture("cjs-node-interop", (cwd) =>
			Effect.gen(function* () {
				const result = yield* ActionBuilder.build({
					cwd,
					config: configOf({ build: { minify: false } }),
					validate: true,
					persist: true,
					ci: false,
				});
				assert.isTrue(result.build.success);
				assert.isTrue(result.persisted);
				assert.deepStrictEqual(
					result.validation.warnings.map((warning) => warning.code),
					["ACTION_YML_NO_BRANDING"],
				);
				assert.strictEqual(runBundle(join(cwd, ".github/actions/local/dist/main.js")).trim(), "isStream=true");
			}).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
		),
	);
});
