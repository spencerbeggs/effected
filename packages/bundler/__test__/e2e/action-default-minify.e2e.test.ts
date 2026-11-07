// Ported from @savvy-web/github-action-builder __test__/integration/default-minify.int.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { ActionBundle } from "../../src/index.js";
import { configOf, runBundle, withFixture } from "./action-fixture.js";

describe("a default-config action build", () => {
	it.live("minifies, and an explicit minify = false does not", () =>
		withFixture("default-minify", (cwd) =>
			Effect.gen(function* () {
				const mainJs = join(cwd, "dist", "main.js");

				const minified = yield* ActionBundle.build(configOf(), { cwd, clean: true });
				assert.isTrue(minified.success);
				const compact = readFileSync(mainJs, "utf8");
				assert.isBelow(compact.split("\n").length, 5);
				assert.strictEqual(runBundle(mainJs).trim(), "DEFAULT-DEFAULT|MINIFY-MINIFY|FIXTURE-FIXTURE");

				const plain = yield* ActionBundle.build(configOf({ build: { minify: false } }), { cwd, clean: true });
				assert.isTrue(plain.success);
				assert.isAbove(readFileSync(mainJs, "utf8").split("\n").length, compact.split("\n").length + 3);
				assert.strictEqual(runBundle(mainJs).trim(), "DEFAULT-DEFAULT|MINIFY-MINIFY|FIXTURE-FIXTURE");
			}),
		),
	);
});
