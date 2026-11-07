// Ported from @savvy-web/github-action-builder __test__/integration/license-comments.int.test.ts.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { ActionBundle } from "../../src/index.js";
import { configOf, withFixture } from "./action-fixture.js";

describe("license comments", () => {
	it.live("stay inline in a minified bundle, with no sidecar file", () =>
		withFixture("license-comments", (cwd) =>
			Effect.gen(function* () {
				const result = yield* ActionBundle.build(configOf({ build: { minify: true } }), { cwd, clean: true });
				assert.isTrue(result.success, JSON.stringify(result));
				const dist = join(cwd, "dist");
				assert.sameMembers(readdirSync(dist), ["main.js", "package.json"]);
				assert.include(readFileSync(join(dist, "main.js"), "utf8"), "@license MIT | example-licensed-dep");
			}),
		),
	);
});
