/**
 * An export written as the built path, `./dist/foo.js`, through the real tsdown pass (#1259): the entry pass builds it
 * from `./src/foo.ts` and names the output after the export key, and the emitted manifest must point at that file, not
 * at a `./dist/foo.js` the build never writes. A literal target the build does not write is warned about.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer } from "effect";
import { Bundler } from "../../src/Bundler.js";
import { EffectedConfigFile } from "../../src/config/EffectedConfigFile.js";

const TIMEOUT = 120_000;

const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const discovery = WorkspaceDiscovery.layer().pipe(
	Layer.provideMerge(WorkspaceRoot.layer),
	Layer.provideMerge(platform),
);

const roots: string[] = [];
afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const scaffold = (exportsMap: Record<string, unknown>): { readonly root: string; readonly cwd: string } => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "bundler-dist-exports-")));
	roots.push(root);
	const cwd = join(root, "pkg");
	mkdirSync(join(cwd, "src"), { recursive: true });
	writeFileSync(
		join(cwd, "package.json"),
		JSON.stringify({
			name: "@fixture/dist-exports",
			version: "1.0.0",
			private: true,
			type: "module",
			exports: exportsMap,
			publishConfig: { access: "public" },
		}),
	);
	writeFileSync(
		join(cwd, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				module: "nodenext",
				moduleResolution: "nodenext",
				target: "es2023",
				strict: true,
				skipLibCheck: true,
				types: [],
			},
		}),
	);
	writeFileSync(join(cwd, "effected.toml"), "[package.build]\nmeta = false\n");
	for (const name of ["index", "foo", "bar"]) {
		writeFileSync(join(cwd, "src", `${name}.ts`), `/** @public */\nexport const name = "${name}";\n`);
	}
	return { root, cwd };
};

const build = (cwd: string) =>
	Effect.gen(function* () {
		const { config } = yield* EffectedConfigFile.load({ cwd });
		return yield* Bundler.build({
			cwd,
			config: config.package.build,
			bundle: config.package.bundle,
			noExe: true,
			verbose: false,
			plugins: [],
			ci: false,
		});
	}).pipe(Effect.provide(discovery));

const warningsOf = (issuesPath: string): ReadonlyArray<{ code?: string; text: string }> =>
	(JSON.parse(readFileSync(issuesPath, "utf-8")) as { warnings: ReadonlyArray<{ code?: string; text: string }> })
		.warnings;

describe("an export written as ./dist/*.js (#1259)", () => {
	it.effect(
		"points the published manifest at the emitted file, bare or under a condition, and it resolves",
		() =>
			Effect.gen(function* () {
				const { root, cwd } = scaffold({
					".": "./src/index.ts",
					"./foo": "./dist/foo.js",
					"./bar": { import: "./dist/bar.js" },
				});
				const result = yield* build(cwd);
				const pkg = join(cwd, "dist", "prod", "npm", "pkg");
				const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf-8")) as {
					exports: Record<string, Record<string, string>>;
				};
				assert.strictEqual(manifest.exports["./foo"]?.import, "./foo.js");
				assert.strictEqual(manifest.exports["./bar"]?.import, "./bar.js");
				assert.deepStrictEqual(warningsOf(result.issuesPath), []);

				// Both subpaths resolve from a consumer's seat to a file the build wrote.
				const consumer = join(root, "consumer");
				cpSync(pkg, join(consumer, "node_modules", "@fixture", "dist-exports"), { recursive: true });
				writeFileSync(join(consumer, "index.cjs"), "");
				const require = createRequire(join(consumer, "index.cjs"));
				for (const subpath of ["foo", "bar"]) {
					const resolved = require.resolve(`@fixture/dist-exports/${subpath}`);
					assert.isTrue(resolved.endsWith(join("dist-exports", `${subpath}.js`)), resolved);
				}
			}),
		TIMEOUT,
	);

	it.effect(
		"warns about a literal export target the build does not write, and the build still succeeds",
		() =>
			Effect.gen(function* () {
				const { cwd } = scaffold({ ".": "./src/index.ts", "./prebuilt": "./prebuilt/never.js" });
				const result = yield* build(cwd);
				const issues = JSON.parse(readFileSync(result.issuesPath, "utf-8")) as { buildOk: boolean };
				assert.strictEqual(issues.buildOk, true);
				const warning = warningsOf(result.issuesPath).find((w) => w.code === "exports-pattern-unmatched");
				assert.include(warning?.text ?? "", "./prebuilt/never.js");
			}),
		TIMEOUT,
	);
});
