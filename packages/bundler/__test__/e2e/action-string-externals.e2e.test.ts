// Ported from @savvy-web/github-action-builder __test__/integration/string-externals.int.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { ActionBundle } from "../../src/index.js";
import { configOf, runBundle, withFiles, withFixture } from "./action-fixture.js";

describe("build.externals", () => {
	it.live("externalizes node: builtins and a configured package that is not installed", () =>
		withFixture("string-externals", (cwd) =>
			Effect.gen(function* () {
				const result = yield* ActionBundle.build(
					configOf({ build: { minify: false, externals: ["uninstalled-peer-dep"] } }),
					{ cwd, clean: true },
				);
				assert.isTrue(result.success, JSON.stringify(result));
				const bundle = readFileSync(join(cwd, "dist", "main.js"), "utf8");
				assert.match(bundle, /import\s*["']uninstalled-peer-dep["']/);
				assert.match(bundle, /from\s*["']node:crypto["']/);
			}),
		),
	);

	it.live("leaves an installed package out of the bundle only when it is configured as external", () =>
		withFiles(
			{
				"src/main.ts": 'import { value } from "installed-dep";\nconsole.log(value);\n',
				"node_modules/installed-dep/package.json": '{ "name": "installed-dep", "type": "module", "main": "index.js" }',
				"node_modules/installed-dep/index.js": 'export const value = "from-the-dependency";\n',
			},
			(cwd) =>
				Effect.gen(function* () {
					const mainJs = join(cwd, "dist", "main.js");
					yield* ActionBundle.build(configOf(), { cwd, clean: true });
					assert.include(readFileSync(mainJs, "utf8"), "from-the-dependency");

					const result = yield* ActionBundle.build(configOf({ build: { externals: ["installed-dep"] } }), {
						cwd,
						clean: true,
					});
					assert.isTrue(result.success, JSON.stringify(result));
					const bundle = readFileSync(mainJs, "utf8");
					assert.notInclude(bundle, "from-the-dependency");
					assert.match(bundle, /from\s*["']installed-dep["']/);
					assert.strictEqual(runBundle(mainJs).trim(), "from-the-dependency");
				}),
		),
	);

	it.live("fails the entry when the same package is not configured as external", () =>
		withFixture("string-externals", (cwd) =>
			Effect.gen(function* () {
				const result = yield* ActionBundle.build(configOf(), { cwd, clean: true });
				assert.isFalse(result.success);
				assert.isFalse(result.entries[0]?.success);
				assert.include(result.entries[0]?.error ?? "", "uninstalled-peer-dep");
			}),
		),
	);
});
