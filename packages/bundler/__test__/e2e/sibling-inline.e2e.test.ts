/**
 * `bundledPackages` naming a workspace sibling, through the real tsdown, tsgo and API Extractor: the sibling's built
 * declarations are inlined as a registry package's would be, and a sibling with no build fails before any pass.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer } from "effect";
import { Bundler } from "../../src/Bundler.js";
import { EffectedConfigFile } from "../../src/config/EffectedConfigFile.js";

const FIXTURE = resolve(import.meta.dirname, "../fixtures/sibling-inline");
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

const makeWorkspace = (): string => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "bundler-sibling-")));
	roots.push(root);
	cpSync(FIXTURE, root, { recursive: true });
	const links = join(root, "packages", "b", "node_modules", "@fixture");
	mkdirSync(links, { recursive: true });
	symlinkSync(join(root, "packages", "a"), join(links, "a"));
	return root;
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

describe("bundledPackages naming a workspace sibling", () => {
	it.effect(
		"inlines the sibling's built declarations, through the root and a nested subpath",
		() =>
			Effect.gen(function* () {
				const root = makeWorkspace();
				const cwd = join(root, "packages", "b");
				yield* build(join(root, "packages", "a"));
				const result = yield* build(cwd);

				const pkg = join(cwd, "dist", "prod", "npm", "pkg");
				const dts = readFileSync(join(pkg, "index.d.ts"), "utf-8");
				assert.match(dts, /interface SiblingContract/);
				assert.match(dts, /interface DeepContract/);
				assert.notInclude(dts, "@fixture/a");

				// The JS pass and the consumer's manifest are untouched: the dependency still ships.
				const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf-8")) as {
					dependencies: Record<string, string>;
				};
				assert.strictEqual(manifest.dependencies["@fixture/a"], "1.0.0");

				// The model documents what was inlined, the loss this exists to prevent.
				const model = readFileSync(join(cwd, "dist", "prod", "npm", "meta", "b.api.json"), "utf-8");
				assert.include(model, "SiblingContract");

				const issues = JSON.parse(readFileSync(result.issuesPath, "utf-8")) as {
					buildOk: boolean;
					errors: unknown[];
					warnings: unknown[];
				};
				assert.strictEqual(issues.buildOk, true);
				assert.deepStrictEqual(issues.errors, []);
				assert.deepStrictEqual(issues.warnings, []);
			}),
		TIMEOUT,
	);

	it.effect(
		"fails before any pass when the sibling has not been built, saying what to do",
		() =>
			Effect.gen(function* () {
				const root = makeWorkspace();
				const cwd = join(root, "packages", "b");
				const failure = yield* Effect.flip(build(cwd));
				assert.strictEqual(failure._tag, "ConfigValidationError");
				assert.include(failure.message, "Build @fixture/a first");
				assert.include(failure.message, 'dependsOn: ["^build"]');
				assert.isFalse(existsSync(join(cwd, "dist", "prod", "npm", "pkg", "index.js")));
			}),
		TIMEOUT,
	);
});
