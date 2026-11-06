// Ported from @savvy-web/github-action-builder __test__/integration/ignore-modules.int.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { ActionBundle } from "../../src/index.js";
import { configOf, runBundle, withFixture } from "./action-fixture.js";

describe("build.ignore", () => {
	it.live("replaces an ignored module with a throwing stub that a guarded require catches", () =>
		withFixture("ignore-modules", (cwd) =>
			Effect.gen(function* () {
				const result = yield* ActionBundle.build(
					configOf({ build: { minify: false, ignore: ["excluded-native-dep"] } }),
					{ cwd, clean: true },
				);
				assert.isTrue(result.success, JSON.stringify(result));
				const mainJs = join(cwd, "dist", "main.js");
				assert.include(readFileSync(mainJs, "utf8"), "excluded via the build 'ignore' option");
				assert.strictEqual(runBundle(mainJs).trim(), "xmlAvailable=false");
			}),
		),
	);

	it.live("wins over externals when a module is listed in both", () =>
		withFixture("ignore-modules", (cwd) =>
			Effect.gen(function* () {
				const result = yield* ActionBundle.build(
					configOf({ build: { ignore: ["excluded-native-dep"], externals: ["excluded-native-dep"] } }),
					{ cwd, clean: true },
				);
				assert.isTrue(result.success, JSON.stringify(result));
				assert.include(readFileSync(join(cwd, "dist", "main.js"), "utf8"), "excluded via the build 'ignore' option");
			}),
		),
	);
});
