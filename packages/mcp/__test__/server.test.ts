import { assert, describe, it } from "@effect/vitest";
import { McpHarness } from "@effected/mcp-kit/testing";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path } from "effect";
import { ServerLayer } from "../src/server.js";

const DISTRIBUTION = { name: "@effected/plugin", version: "1.2.3" };

const harnessFor = (options: Parameters<typeof ServerLayer>[0]) =>
	Effect.gen(function* () {
		const harness = yield* McpHarness.make(
			ServerLayer(options).pipe(Layer.provide(Layer.mergeAll(MemoryFileSystem.layer, Path.layer))),
		);
		yield* harness.initialize;
		return harness;
	});

describe("effected-mcp", () => {
	it.effect("tools/list serves the identity tool and the schema tools", () =>
		Effect.gen(function* () {
			const harness = yield* harnessFor({});
			const tools = yield* harness.listTools;
			assert.deepStrictEqual(tools.map((tool) => tool.name).sort(), [
				"identity",
				"schema_build",
				"schema_check",
				"schema_validate",
			]);
		}).pipe(Effect.scoped),
	);

	it.effect("identity reports the tool, the distribution and the effect version", () =>
		Effect.gen(function* () {
			const harness = yield* harnessFor({ distribution: DISTRIBUTION });
			const response = yield* harness.callTool("identity", {});
			const result = response.result as { isError?: boolean; structuredContent?: Record<string, unknown> };
			assert.strictEqual(result.isError ?? false, false);
			const report = result.structuredContent as Record<string, unknown>;
			assert.strictEqual(report.tool, "effected");
			assert.deepStrictEqual(report.distribution, DISTRIBUTION);
			assert.ok(typeof report.effect === "string" && report.effect.length > 0);
			assert.ok(typeof report.version === "string" && report.version.length > 0);
		}).pipe(Effect.scoped),
	);

	it.effect("identity reports a null distribution for a direct install", () =>
		Effect.gen(function* () {
			const harness = yield* harnessFor({});
			const response = yield* harness.callTool("identity", {});
			const report = (response.result as { structuredContent: Record<string, unknown> }).structuredContent;
			assert.strictEqual(report.distribution, null);
		}).pipe(Effect.scoped),
	);
});
