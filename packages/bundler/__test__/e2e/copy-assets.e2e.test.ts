/**
 * `copy` and `meta.localPaths` end to end through the real tsdown and API Extractor, from the package's own
 * `effected.toml`, for a package with two publish groups: the assets land in each group's `pkg/`, the emitted pattern
 * export resolves to them, and the API model reaches the configured directory.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer } from "effect";
import { Bundler } from "../../src/Bundler.js";
import { EffectedConfigFile } from "../../src/config/EffectedConfigFile.js";

const FIXTURE = resolve(import.meta.dirname, "../fixtures/copy-assets");
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

const warningCodes = (issuesPath: string): ReadonlyArray<string | undefined> =>
	(JSON.parse(readFileSync(issuesPath, "utf-8")) as { warnings: ReadonlyArray<{ code?: string }> }).warnings.map(
		(warning) => warning.code,
	);

describe("copy and meta.localPaths", () => {
	it.effect(
		"ship the assets in every group, resolve the pattern export, and place the model",
		() =>
			Effect.gen(function* () {
				const root = realpathSync(mkdtempSync(join(tmpdir(), "bundler-copy-")));
				roots.push(root);
				cpSync(FIXTURE, root, { recursive: true });
				const cwd = join(root, "pkg");
				const result = yield* build(cwd);

				for (const group of ["npm", "github"]) {
					const pkg = join(cwd, "dist", "prod", group, "pkg");
					assert.isTrue(existsSync(join(pkg, "schemas", "5.0", "run.json")), `${group}: the directory entry`);
					assert.isTrue(existsSync(join(pkg, "named", "run.json")), `${group}: "to" is relative to this group's pkg/`);
					const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf-8")) as {
						exports: Record<string, unknown>;
					};
					assert.strictEqual(manifest.exports["./schemas/*.json"], "./schemas/*.json");
				}
				// A "to" must not have escaped to the package directory, where tsdown alone would have put it.
				assert.isFalse(existsSync(join(cwd, "named")));

				// The subpath resolves through Node's own pattern rules from a consumer's seat.
				const pkg = join(cwd, "dist", "prod", "npm", "pkg");
				const consumer = join(root, "consumer");
				cpSync(pkg, join(consumer, "node_modules", "@fixture", "copy-assets"), { recursive: true });
				writeFileSync(join(consumer, "index.cjs"), "");
				const resolved = createRequire(join(consumer, "index.cjs")).resolve(
					"@fixture/copy-assets/schemas/5.0/run.json",
				);
				assert.include(resolved, join("schemas", "5.0", "run.json"));

				// The model reaches the configured directory, once, relative to the package.
				assert.isTrue(existsSync(join(root, "models", "copy-assets", "copy-assets.api.json")));

				assert.deepStrictEqual(warningCodes(result.issuesPath), []);
			}),
		TIMEOUT,
	);

	it.effect(
		"warns when the pattern export has nothing behind it, and the build still succeeds",
		() =>
			Effect.gen(function* () {
				const root = realpathSync(mkdtempSync(join(tmpdir(), "bundler-copy-")));
				roots.push(root);
				cpSync(FIXTURE, root, { recursive: true });
				const cwd = join(root, "pkg");
				writeFileSync(join(cwd, "effected.toml"), "[package.build]\n");
				const result = yield* build(cwd);
				const issues = JSON.parse(readFileSync(result.issuesPath, "utf-8")) as { buildOk: boolean };
				assert.strictEqual(issues.buildOk, true);
				assert.include(warningCodes(result.issuesPath), "exports-pattern-unmatched");
			}),
		TIMEOUT,
	);
});
