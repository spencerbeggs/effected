import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Bundler } from "../src/Bundler.js";
import { BundlerError } from "../src/BundlerError.js";
import { PackageBuildConfig } from "../src/config/BuildConfig.js";

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("a crash inside the meta pass", () => {
	it.effect("fails phase meta and leaves an issues.json a reader can gate on", () =>
		Effect.gen(function* () {
			const cwd = mkdtempSync(join(tmpdir(), "bundler-meta-failure-"));
			dirs.push(cwd);
			const error = yield* Effect.flip(
				Bundler.build({
					cwd,
					config: Schema.decodeUnknownSync(PackageBuildConfig)({}),
					bundle: undefined,
					noExe: true,
					verbose: false,
					plugins: [],
					ci: false,
					// The real meta pass and the real issues writer, over an API Extractor that crashes.
					seams: {
						readPackageJson: () => ({ name: "fixture", version: "1.0.0", exports: { ".": "./src/index.ts" } }),
						writeTsconfig: () => "/fake/tsconfig.json",
						buildTargetGroups: async () => {},
						resolveNextVersions: async () => ({ versions: new Map() }),
						generateMeta: async () => {
							throw new Error("API Extractor blew up");
						},
					},
				}),
			);
			assert.instanceOf(error, BundlerError);
			assert.strictEqual(error.phase, "meta");
			assert.strictEqual(error.message, "API Extractor blew up");

			const path = join(cwd, "dist", "prod", "issues.json");
			assert.isTrue(existsSync(path));
			const issues = JSON.parse(readFileSync(path, "utf-8")) as {
				buildOk: boolean;
				failure?: { name?: string; message: string };
			};
			assert.strictEqual(issues.buildOk, false);
			assert.strictEqual(issues.failure?.message, "API Extractor blew up");
		}),
	);
});
