// Ported from savvy-web/systems packages/tsdown-plugins/__test__/report/metrics-plugin.test.ts on 2026-11-06
import { assert, describe, it } from "@effect/vitest";
import { BuildCollector } from "../../src/report/collector.js";
import { buildMetricsPlugin } from "../../src/report/metrics-plugin.js";

// Minimal rolldown OutputBundle stand-in: a chunk and an asset.
const bundle = {
	"index.js": { type: "chunk", code: "export const a = 1;\n" },
	"styles.css": { type: "asset", source: "body{color:red}" },
} as unknown as Record<string, unknown>;

function callWriteBundle(plugin: { writeBundle?: unknown }, b: Record<string, unknown>): void {
	const fn = plugin.writeBundle as (o: unknown, bundle: unknown) => void;
	fn({ dir: "/out" }, b);
}

function callOnLog(plugin: { onLog?: unknown }, level: string, log: unknown): unknown {
	const fn = plugin.onLog as (level: string, log: unknown) => unknown;
	return fn(level, log);
}

describe("buildMetricsPlugin", () => {
	it("onLog records and returns false to suppress the leak", () => {
		const c = new BuildCollector();
		const plugin = buildMetricsPlugin(c, "npm", "js", false);
		const result = callOnLog(plugin, "warn", { message: "boom", code: "X" });
		assert.strictEqual(result, false);
		const [report] = c.snapshot("@x/p");
		assert.strictEqual(report?.targetGroups[0]?.warnings.length, 1);
		assert.strictEqual(report?.targetGroups[0]?.warnings[0]?.text, "boom");
	});

	it("onLog drops @tsdown/css SOURCEMAP_BROKEN noise without recording it", () => {
		const c = new BuildCollector();
		c.registerGroup("npm", ["index"]);
		const plugin = buildMetricsPlugin(c, "npm", "js", false);
		// Both @tsdown/css and its :collect sibling emit this benign, unfixable warning.
		for (const cssPlugin of ["@tsdown/css", "@tsdown/css:collect"]) {
			const result = callOnLog(plugin, "warn", {
				message: "[SOURCEMAP_BROKEN] Sourcemap is likely to be incorrect",
				code: "SOURCEMAP_BROKEN",
				plugin: cssPlugin,
				id: "/src/runtime/components/Foo/index.module.css",
			});
			// Still returns false so the console leak is suppressed, but nothing is recorded.
			assert.strictEqual(result, false);
		}
		const [report] = c.snapshot("@x/p");
		assert.strictEqual(report?.targetGroups[0]?.warnings.length, 0);
	});

	it("onLog still records SOURCEMAP_BROKEN from non-css plugins", () => {
		const c = new BuildCollector();
		const plugin = buildMetricsPlugin(c, "npm", "js", false);
		const result = callOnLog(plugin, "warn", { message: "real map issue", code: "SOURCEMAP_BROKEN", plugin: "other" });
		assert.strictEqual(result, false);
		const [report] = c.snapshot("@x/p");
		assert.strictEqual(report?.targetGroups[0]?.warnings.length, 1);
	});

	it("routes MIXED_EXPORTS to the suppressed bucket when the pass carries cjsDefaultInterop", () => {
		const c = new BuildCollector();
		const plugin = buildMetricsPlugin(c, "npm", "js", false, true);
		const result = callOnLog(plugin, "warn", { message: "mixed", code: "MIXED_EXPORTS", id: "/src/a.ts" });
		assert.strictEqual(result, false);
		const group = c.snapshot("@x/p")[0]?.targetGroups[0];
		// Suppressed, not warned — and labelled so the build summary can group it by code.
		assert.strictEqual(group?.warnings.length, 0);
		assert.strictEqual(group?.suppressed.length, 1);
		assert.strictEqual(group?.suppressed[0]?.code, "MIXED_EXPORTS");
		assert.strictEqual(group?.suppressed[0]?.file, "/src/a.ts");
	});

	it("keeps MIXED_EXPORTS a real warning on a pass without cjsDefaultInterop", () => {
		const c = new BuildCollector();
		// The flag defaults to false: an esm-only pass has no interop footer, so the warning stands.
		const plugin = buildMetricsPlugin(c, "npm", "js", false);
		assert.strictEqual(callOnLog(plugin, "warn", { message: "mixed", code: "MIXED_EXPORTS" }), false);
		const group = c.snapshot("@x/p")[0]?.targetGroups[0];
		assert.strictEqual(group?.warnings.length, 1);
		assert.strictEqual(group?.suppressed.length, 0);
	});

	it("onLog records an error and does not suppress it (returns undefined)", () => {
		const c = new BuildCollector();
		const plugin = buildMetricsPlugin(c, "npm", "js", false);
		const result = callOnLog(plugin, "error", { message: "hard-fail", code: "E" });
		// Errors must not be swallowed: rolldown's default error reporting still fires.
		assert.isUndefined(result);
		const [report] = c.snapshot("@x/p");
		const group = report?.targetGroups[0];
		assert.strictEqual(group?.errors.length, 1);
		assert.strictEqual(group?.errors[0]?.text, "hard-fail");
		// Warn is still suppressed (returns false) while error is not.
		assert.strictEqual(callOnLog(plugin, "warn", { message: "soft", code: "W" }), false);
	});

	it("records emitted files with byte sizes (no gzip when not verbose)", () => {
		const c = new BuildCollector();
		const plugin = buildMetricsPlugin(c, "npm", "js", false);
		callWriteBundle(plugin, bundle);
		const [report] = c.snapshot("@x/p");
		const js = report?.targetGroups[0]?.passes.find((p) => p.id === "js");
		assert.deepStrictEqual(js?.files.map((f) => f.path).sort(), ["index.js", "styles.css"]);
		const idx = js?.files.find((f) => f.path === "index.js");
		assert.strictEqual(idx?.bytes, Buffer.byteLength("export const a = 1;\n"));
		assert.isUndefined(idx?.gzip);
	});

	it("computes gzip when verbose", () => {
		const c = new BuildCollector();
		const plugin = buildMetricsPlugin(c, "npm", "js", true);
		callWriteBundle(plugin, bundle);
		const [report] = c.snapshot("@x/p");
		const js = report?.targetGroups[0]?.passes.find((p) => p.id === "js");
		assert.isAbove(js?.files.find((f) => f.path === "index.js")?.gzip ?? 0, 0);
	});
});
