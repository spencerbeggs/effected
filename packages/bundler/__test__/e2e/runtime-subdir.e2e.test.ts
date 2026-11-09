/**
 * Three settings end to end through the real tsdown, from the package's own `effected.toml`: an `outSubdir` override
 * shipping a framework runtime one file per source (the role `@savvy-web/rspress-builder`'s `runtime: true` played),
 * `[package.build.manifest] set` renaming the published package, and the `effected-built` export condition routing a
 * plain-Node workspace consumer to the built output while every other resolver keeps the source.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer } from "effect";
import { Bundler } from "../../src/Bundler.js";
import { EffectedConfigFile } from "../../src/config/EffectedConfigFile.js";

const FIXTURE = resolve(import.meta.dirname, "../fixtures/runtime-subdir");
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

/** Resolve and import a specifier from `dir` in a plain Node, with no tsx and no inherited NODE_OPTIONS. */
const plainNode = (dir: string, conditions: ReadonlyArray<string>, specifier: string) => {
	const script = `const url = import.meta.resolve(${JSON.stringify(specifier)}); let loaded = "no"; try { await import(url); loaded = "yes"; } catch {} console.log(JSON.stringify({ url, loaded }));`;
	const run = spawnSync(
		process.execPath,
		[...conditions.map((c) => `--conditions=${c}`), "--input-type=module", "--eval", script],
		{ cwd: dir, encoding: "utf-8", env: { PATH: process.env.PATH ?? "", NODE_OPTIONS: "" } },
	);
	assert.strictEqual(run.status, 0, run.stderr);
	return JSON.parse(run.stdout) as { url: string; loaded: "yes" | "no" };
};

describe("a framework runtime, a renamed manifest and the built condition", () => {
	it.effect(
		"ships the runtime per file, publishes the renamed manifest without the condition, and resolves built output in plain Node",
		() =>
			Effect.gen(function* () {
				const root = realpathSync(mkdtempSync(join(tmpdir(), "bundler-runtime-")));
				roots.push(root);
				cpSync(FIXTURE, root, { recursive: true });
				const cwd = join(root, "pkg");
				const result = yield* build(cwd);
				const pkg = join(cwd, "dist", "prod", "npm", "pkg");
				const read = (path: string): string => readFileSync(join(pkg, path), "utf-8");

				// The runtime mirrors its source tree, including a file the barrel never imports, and leaves out tests.
				assert.isTrue(existsSync(join(pkg, "runtime", "index.js")));
				assert.isTrue(existsSync(join(pkg, "runtime", "components", "Shown", "index.js")));
				assert.isTrue(existsSync(join(pkg, "runtime", "components", "Unlisted", "index.js")));
				assert.isTrue(existsSync(join(pkg, "runtime", "hooks", "useMode.js")));
				assert.isFalse(existsSync(join(pkg, "runtime", "components", "Shown", "Shown.test.js")));
				// Each file keeps its own imports: relative, external and the framework's alias alike.
				const shown = read("runtime/components/Shown/index.js");
				assert.include(shown, 'from "../../hooks/useMode.js"');
				// `@theme` is external only through the override's own list: no dependency or base external names it, and
				// without that list rolldown warns UNRESOLVED_IMPORT, which the empty-warnings assertion below catches.
				assert.include(shown, 'from "@theme"');
				assert.include(shown, 'from "react/jsx-runtime"');
				// The site's build decides import.meta.env, so the shipped files leave it unresolved.
				assert.include(read("runtime/hooks/useMode.js"), "import.meta.env.SSG_MD");
				assert.include(read("runtime/components/Unlisted/index.js"), "import.meta.env.SSG_MD");

				const manifest = JSON.parse(read("package.json")) as Record<string, unknown>;
				assert.strictEqual(manifest.name, "@fixture/runtime");
				assert.strictEqual(manifest.description, "The runtime fixture");
				assert.deepStrictEqual((manifest.exports as Record<string, unknown>)["./runtime"], {
					types: "./runtime/index.d.ts",
					import: "./runtime/index.js",
					default: "./runtime/index.js",
				});
				assert.notInclude(read("package.json"), "effected-built");
				const targets = JSON.parse(readFileSync(join(cwd, "dist", "prod", "targets.json"), "utf-8")) as {
					groups: ReadonlyArray<{ name: string }>;
				};
				assert.deepStrictEqual(
					targets.groups.map((group) => group.name),
					["@fixture/runtime"],
				);

				const issues = JSON.parse(readFileSync(result.issuesPath, "utf-8")) as {
					buildOk: boolean;
					warnings: ReadonlyArray<unknown>;
				};
				assert.strictEqual(issues.buildOk, true);
				assert.deepStrictEqual(issues.warnings, []);
				assert.notInclude(read("index.js"), "@theme");

				// A workspace consumer links the package directory under its source name, as pnpm does.
				const consumer = join(root, "consumer");
				mkdirSync(join(consumer, "node_modules", "@fixture"), { recursive: true });
				symlinkSync(cwd, join(consumer, "node_modules", "@fixture", "runtime-subdir"), "dir");

				// Without the condition the link resolves to source, which plain Node cannot load.
				const source = plainNode(consumer, [], "@fixture/runtime-subdir");
				assert.isTrue(source.url.endsWith("/pkg/src/index.ts"), source.url);
				// With it, the same link resolves to the built file, which loads.
				const built = plainNode(consumer, ["effected-built"], "@fixture/runtime-subdir");
				assert.isTrue(built.url.endsWith("/pkg/dist/prod/npm/pkg/index.js"), built.url);
				assert.strictEqual(built.loaded, "yes");
				const runtime = plainNode(consumer, ["effected-built"], "@fixture/runtime-subdir/runtime");
				assert.isTrue(runtime.url.endsWith("/pkg/dist/prod/npm/pkg/runtime/index.js"), runtime.url);
			}),
		TIMEOUT,
	);
});
