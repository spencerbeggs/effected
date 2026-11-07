// Ported from @savvy-web/github-action-builder __test__/integration/idempotent-build.int.test.ts.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { ActionBundle } from "../../src/index.js";
import { configOf, withFixture } from "./action-fixture.js";

const config = configOf({ build: { minify: false, ignore: ["excluded-native-dep"] } });

describe("an action build", () => {
	it.live("is byte-identical on a second run and from another directory, with no sidecar", () =>
		withFixture("ignore-modules", (cwd) =>
			Effect.gen(function* () {
				const mainJs = join(cwd, "dist", "main.js");
				yield* ActionBundle.build(config, { cwd, clean: true });
				const first = readFileSync(mainJs, "utf8");
				assert.deepStrictEqual(
					readdirSync(join(cwd, "dist")).filter((file) => file.endsWith(".LICENSE.txt")),
					[],
				);

				yield* ActionBundle.build(config, { cwd, clean: true });
				assert.strictEqual(readFileSync(mainJs, "utf8"), first);

				const elsewhere = yield* withFixture("ignore-modules", (other) =>
					ActionBundle.build(config, { cwd: other, clean: true }).pipe(
						Effect.map(() => readFileSync(join(other, "dist", "main.js"), "utf8")),
					),
				);
				assert.strictEqual(elsewhere, first);
			}),
		),
	);
});
