import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer, Ref, Schema, Stdio } from "effect";
import { McpProtocol, Tool, Toolkit } from "effect/ai";
import { McpStdio, McpToolkit } from "../src/index.js";
import { McpHarness } from "../src/testing.js";

const Probe = Tool.make("probe", { success: Schema.Struct({ text: Schema.String }) });
const Kit = Toolkit.make(Probe);
const Handlers = Kit.toLayer({ probe: () => Effect.succeed({ text: "ok" }) });

describe("McpStdio.layer metadata", () => {
	it.effect("cacheHints reach the tools/list result on the stateless protocol", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(
				McpStdio.layer({
					name: "hints",
					version: "0.0.0",
					cacheHints: { tools: { ttl: "5 minutes", cacheScope: "private" } },
					registrations: McpToolkit.layer(Kit).pipe(Layer.provide(Handlers)),
				}),
				{ protocol: McpProtocol.v2026_07_28 },
			);
			const response = yield* harness.request("tools/list");
			const result = response.result as { readonly ttlMs?: number; readonly cacheScope?: string };
			assert.strictEqual(result.ttlMs, 300_000);
			assert.strictEqual(result.cacheScope, "private");
		}),
	);

	it.effect("websiteUrl, icons and extensions appear in server/discover", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(
				McpStdio.layer({
					name: "meta",
					version: "0.0.0",
					websiteUrl: "https://example.com/meta",
					icons: [{ src: "https://example.com/icon.png", mimeType: "image/png" }],
					extensions: { "example/feature": { enabled: true } },
				}),
				{ protocol: McpProtocol.v2026_07_28 },
			);
			const response = yield* harness.discover;
			const text = JSON.stringify(response.result);
			assert.include(text, "https://example.com/meta");
			assert.include(text, "https://example.com/icon.png");
			assert.include(text, "example/feature");
		}),
	);
});

describe("McpHarness services", () => {
	class Counter extends Context.Service<Counter, Ref.Ref<number>>()("test/Counter") {}
	const CounterTool = Tool.make("count", { success: Schema.Struct({ n: Schema.Number }) });
	const CounterKit = Toolkit.make(CounterTool);
	const CounterHandlers = CounterKit.toLayer(
		Effect.gen(function* () {
			const ref = yield* Counter;
			return { count: () => Ref.get(ref).pipe(Effect.map((n) => ({ n }))) };
		}),
	);
	const server = McpStdio.layer({
		name: "services",
		version: "0.0.0",
		registrations: McpToolkit.layer(CounterKit).pipe(Layer.provide(CounterHandlers)),
	});

	it.effect("harness services are the seeded instance, not a rebuild", () =>
		Effect.gen(function* () {
			const ref = yield* Ref.make(0);
			yield* Ref.set(ref, 42);
			const services = Context.make(Counter, ref);
			const harness = yield* McpHarness.make(server, { services });
			yield* harness.initialize;
			const response = yield* harness.callTool("count");
			assert.deepStrictEqual((response.result as { readonly structuredContent: unknown }).structuredContent, { n: 42 });
		}),
	);

	it.effect("a Stdio in services doesn't replace the harness's", () =>
		Effect.gen(function* () {
			const ref = yield* Ref.make(7);
			// A Stdio that would hang the server if it were used: stdin never delivers.
			const poisoned = Stdio.make({
				args: Effect.succeed([]),
				stdin: undefined as never,
				stdout: undefined as never,
				stderr: undefined as never,
			});
			const services = Context.make(Counter, ref).pipe(Context.add(Stdio.Stdio, poisoned));
			const harness = yield* McpHarness.make(server, { services });
			yield* harness.initialize;
			const response = yield* harness.callTool("count");
			assert.deepStrictEqual((response.result as { readonly structuredContent: unknown }).structuredContent, { n: 7 });
		}),
	);
});
