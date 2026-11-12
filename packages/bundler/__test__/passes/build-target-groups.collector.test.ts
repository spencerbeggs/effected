// Ported from savvy-web/systems packages/tsdown-plugins/__test__/build/build-target-groups.collector.test.ts on 2026-11-06
// packages/bundler/__test__/build/build-target-groups.collector.test.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { BuildTargetGroupsOptions } from "../../src/passes/build-target-groups.js";
import { buildTargetGroups } from "../../src/passes/build-target-groups.js";
import { BuildCollector } from "../../src/report/collector.js";

/**
 * A package directory that does not exist, under a fresh temp dir. A fixed path such as `/tmp/x` reads whatever the
 * host left there: a stray FILE at it makes the `public/` probe fail instead of finding nothing.
 */
const absentCwd = join(mkdtempSync(join(tmpdir(), "btg-collector-")), "pkg");

/** The pass copies `public/`, writes temp tsconfigs and reads real tsconfig files, so it runs on the host disk. */
const runBuildTargetGroups = (options: BuildTargetGroupsOptions): Promise<void> =>
	Effect.runPromise(buildTargetGroups(options).pipe(Effect.provide(NodeServices.layer)));

describe("buildTargetGroups collector wiring", () => {
	it("muzzles tsdown and records per-pass timing when a collector is provided", async () => {
		const c = new BuildCollector();
		const configs: Array<Record<string, unknown>> = [];
		const fakeBuild = async (config: Record<string, unknown>): Promise<unknown> => {
			configs.push(config);
			return undefined;
		};
		await runBuildTargetGroups({
			cwd: absentCwd,
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "tsconfig.json",
			groups: [{ id: "npm", name: "@x/p" }],
			devManifest: "preserve",
			collector: c,
			verbose: false,
			build: fakeBuild,
		});
		// Every build() config is muzzled with silent + a customLogger.
		assert.isAtLeast(configs.length, 2);
		for (const cfg of configs) {
			assert.strictEqual(cfg.logLevel, "silent");
			assert.isDefined(cfg.customLogger);
		}
		const [report] = c.snapshot("@x/p");
		const group = report?.targetGroups[0];
		assert.strictEqual(group?.id, "npm");
		assert.deepStrictEqual(group?.passes.map((p) => p.id).sort(), ["dts", "js"]);
	});

	it("leaves tsdown output untouched when no collector is provided", async () => {
		const configs: Array<Record<string, unknown>> = [];
		const fakeBuild = async (config: Record<string, unknown>): Promise<unknown> => {
			configs.push(config);
			return undefined;
		};
		await runBuildTargetGroups({
			cwd: absentCwd,
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "tsconfig.json",
			groups: [{ id: "dev", name: "@x/p" }],
			devManifest: "preserve",
			build: fakeBuild,
		});
		for (const cfg of configs) assert.isUndefined(cfg.logLevel);
	});
});
