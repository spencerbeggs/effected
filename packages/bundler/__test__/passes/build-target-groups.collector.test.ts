// Ported from savvy-web/systems packages/tsdown-plugins/__test__/build/build-target-groups.collector.test.ts on 2026-11-06
// packages/bundler/__test__/build/build-target-groups.collector.test.ts
import { assert, describe, it } from "@effect/vitest";
import { buildTargetGroups } from "../../src/passes/build-target-groups.js";
import { BuildCollector } from "../../src/report/collector.js";

describe("buildTargetGroups collector wiring", () => {
	it("muzzles tsdown and records per-pass timing when a collector is provided", async () => {
		const c = new BuildCollector();
		const configs: Array<Record<string, unknown>> = [];
		const fakeBuild = async (config: Record<string, unknown>): Promise<unknown> => {
			configs.push(config);
			return undefined;
		};
		await buildTargetGroups({
			cwd: "/tmp/x",
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
		await buildTargetGroups({
			cwd: "/tmp/x",
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
