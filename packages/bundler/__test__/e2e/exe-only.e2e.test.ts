/**
 * An exe-only package, built end to end through the real tsdown and `@tsdown/exe`: the config decoded from its own
 * `effected.toml`, and the compiled binary run. It skips, saying why, on a host the fixture does not declare, and when
 * `@tsdown/exe` cannot fetch the Node runtime it embeds.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Exit, Layer } from "effect";
import { Bundler } from "../../src/Bundler.js";
import { EffectedConfigFile } from "../../src/config/EffectedConfigFile.js";

const FIXTURE = resolve(import.meta.dirname, "../fixtures/exe-only");
const BINARY = "probe-sidecar-darwin-arm64";
const TIMEOUT = 180_000;

/** What `@tsdown/exe` throws when it cannot fetch the runtime it embeds, as opposed to any failure of the build. */
const isRuntimeFetchFailure = (message: string): boolean =>
	/Failed to (?:download|fetch) Node\.js|fetch failed/.test(message);

const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const discovery = WorkspaceDiscovery.layer().pipe(
	Layer.provideMerge(WorkspaceRoot.layer),
	Layer.provideMerge(platform),
);

describe("isRuntimeFetchFailure", () => {
	it("recognizes the fetch failures, and nothing else", () => {
		assert.isTrue(isRuntimeFetchFailure("Failed to download Node.js binary: HTTP 404 from https://nodejs.org/x"));
		assert.isTrue(isRuntimeFetchFailure("Failed to fetch Node.js releases: HTTP 503 from https://nodejs.org/x"));
		assert.isTrue(isRuntimeFetchFailure("Failed to download Node.js checksums: HTTP 404 from https://nodejs.org/x"));
		assert.isTrue(isRuntimeFetchFailure("fetch failed"));
		assert.isFalse(isRuntimeFetchFailure("Checksum mismatch for node-v25.9.0-darwin-arm64.tar.gz"));
		assert.isFalse(isRuntimeFetchFailure("expected compiled binary at /x but it is missing"));
		assert.isFalse(isRuntimeFetchFailure("Build failed with 1 error"));
	});
});

describe("an exe-only package", () => {
	it(
		"drops its dependencies, points bin at the binary, and the binary runs",
		async (ctx) => {
			if (process.platform !== "darwin" || process.arch !== "arm64") {
				ctx.skip(`the fixture declares darwin-arm64; this host is ${process.platform}-${process.arch}`);
			}
			// A copy, so the build writes nothing into the fixture and finds no workspace above it.
			const cwd = mkdtempSync(join(tmpdir(), "bundler-exe-only-"));
			try {
				cpSync(FIXTURE, cwd, { recursive: true });
				const exit = await Effect.runPromiseExit(
					Effect.gen(function* () {
						const { config } = yield* EffectedConfigFile.load({ cwd });
						return yield* Bundler.build({
							cwd,
							config: config.package.build,
							bundle: config.package.bundle,
							noExe: false,
							verbose: false,
							plugins: [],
							ci: false,
						});
					}).pipe(Effect.provide(discovery)),
				);
				if (Exit.isFailure(exit)) {
					const text = String(exit.cause);
					if (isRuntimeFetchFailure(text))
						ctx.skip(`@tsdown/exe could not fetch its Node runtime: ${text.slice(0, 200)}`);
					assert.fail(text);
				}

				const pkg = join(cwd, "dist", "prod", "npm", "pkg");
				const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf-8")) as Record<string, unknown>;
				assert.isFalse("dependencies" in manifest);
				assert.strictEqual(manifest.name, "probe-sidecar-darwin-arm64");
				// `@tsdown/exe` suffixes the configured file name with the target.
				assert.deepStrictEqual(manifest.bin, { "probe-sidecar": `bin/${BINARY}` });
				assert.strictEqual((manifest.exports as Record<string, unknown>)["."], `./bin/${BINARY}`);
				assert.deepStrictEqual(manifest.files, [`bin/${BINARY}`]);

				const binary = join(pkg, "bin", BINARY);
				assert.isTrue(existsSync(binary));
				const run = spawnSync(binary, ["--version"], { encoding: "utf-8", timeout: 30_000 });
				assert.strictEqual(run.status, 0, run.stderr);
				assert.strictEqual(run.stdout, "0.1.0\n");

				// No library pass ran, so nothing but the manifest and the binary ships, and no intermediate bundle leaks.
				assert.isFalse(existsSync(join(pkg, "bin.js")));
				assert.isFalse(existsSync(join(cwd, "dist", "bin.mjs")));
				assert.isFalse(existsSync(join(cwd, "dist", "prod", "npm", "meta")));
				const issues = JSON.parse(readFileSync(exit.value.issuesPath, "utf-8")) as {
					buildOk: boolean;
					errors: unknown[];
				};
				assert.strictEqual(issues.buildOk, true);
				assert.deepStrictEqual(issues.errors, []);
				assert.isTrue(exit.value.report.targetGroups[0]?.passes.some((pass) => pass.id === "exe"));
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		},
		TIMEOUT,
	);
});
