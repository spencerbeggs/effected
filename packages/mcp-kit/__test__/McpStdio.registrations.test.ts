import { assert, describe, it } from "@effect/vitest";
import type { Stdio } from "effect";
import { Effect, Layer, Schema } from "effect";
import type { McpServer } from "effect/ai";
import { McpProtocol, Tool, Toolkit } from "effect/ai";
import { McpStdio, McpToolkit } from "../src/index.js";
import { McpHarness } from "../src/testing.js";

interface ToolResult {
	readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
	readonly structuredContent?: unknown;
	readonly isError?: boolean;
}
const resultOf = (response: { readonly result?: unknown }): ToolResult => response.result as ToolResult;

const Echo = Tool.make("echo", {
	parameters: Schema.Struct({ text: Schema.String }),
	success: Schema.Struct({ text: Schema.String }),
});
const Kit = Toolkit.make(Echo);
const Handlers = Kit.toLayer({ echo: ({ text }) => Effect.succeed({ text }) });

const PROTOCOLS = [McpProtocol.v2025_06_18, McpProtocol.v2025_11_25, McpProtocol.v2026_07_28] as const;

describe("McpStdio.layer registrations", () => {
	for (const protocol of PROTOCOLS) {
		it.effect(`${protocol.protocolVersion}: a toolkit passed as registrations is listed and served`, () =>
			Effect.gen(function* () {
				const server = McpStdio.layer({
					name: "registrations",
					version: "0.0.0",
					registrations: McpToolkit.layer(Kit).pipe(Layer.provide(Handlers)),
				});
				const harness = yield* McpHarness.make(server, { protocol });
				yield* harness.initialize;
				assert.deepStrictEqual(
					(yield* harness.listTools).map((tool) => tool.name),
					["echo"],
				);
				assert.deepStrictEqual(resultOf(yield* harness.callTool("echo", { text: "hi" })).structuredContent, {
					text: "hi",
				});
				// Strict decoding is McpToolkit.layer's, and survives the registrations route.
				const rejected = yield* harness.callTool("echo", { text: "hi", extra: 1 });
				if (protocol.protocolVersion === "2025-06-18") {
					assert.strictEqual((rejected.error as { readonly code: number }).code, -32602);
				} else {
					assert.isTrue(resultOf(rejected).isError);
				}
			}),
		);
	}

	it.effect("a registration's build logs go to stderr, never through console.log", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(
				McpStdio.layer({
					name: "registration-log",
					version: "0.0.0",
					registrations: Layer.effectDiscard(Effect.logError("registration-build-log")),
				}),
			);
			assert.include(yield* harness.stderrSoFar, "registration-build-log");
			assert.isFalse((yield* harness.consoleLogSoFar).some((line) => line.includes("registration-build-log")));
		}),
	);

	it.effect("a registration's typed error stays typed", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				McpHarness.make(
					McpStdio.layer({
						name: "registration-error",
						version: "0.0.0",
						registrations: Layer.effectDiscard(Effect.fail("registration failed" as const)),
					}),
				),
			);
			assert.strictEqual(error, "registration failed");
		}),
	);

	it.effect("a bad protocols list is a defect", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				McpHarness.make(
					McpStdio.layer({
						name: "bad-protocols",
						version: "0.0.0",
						protocols: [McpProtocol.v2026_07_28, McpProtocol.v2026_07_28],
					}),
				),
			);
			assert.isTrue(exit._tag === "Failure");
			if (exit._tag === "Failure") {
				const defect = exit.cause.reasons.find((reason) => reason._tag === "Die");
				assert.isDefined(defect, String(exit.cause));
			}
		}),
	);
});

const Done = McpToolkit.unionTool("done", {
	parameters: Schema.Union([Schema.Struct({ action: Schema.Literal("finish") })]),
});
const DoneKit = Toolkit.make(Done);

describe("a union tool with the default Schema.Void success", () => {
	for (const protocol of PROTOCOLS) {
		it.effect(`${protocol.protocolVersion}: answers with empty content, not an internal error`, () =>
			Effect.gen(function* () {
				const server = McpStdio.layer({
					name: "void",
					version: "0.0.0",
					registrations: McpToolkit.layer(DoneKit).pipe(
						Layer.provide(DoneKit.toLayer({ done: McpToolkit.unionHandler(Done, () => Effect.void) })),
					),
				});
				const harness = yield* McpHarness.make(server, { protocol });
				yield* harness.initialize;
				const response = yield* harness.callTool("done", { action: "finish" });
				assert.isUndefined(response.error);
				const result = resultOf(response);
				assert.notStrictEqual(result.isError, true, JSON.stringify(result));
				assert.deepStrictEqual(result.content, []);
			}),
		);
	}
});

// Compile-time: a server passed through registrations needs nothing but Stdio.
export const requirementFree: Layer.Layer<McpServer.McpServer, never, Stdio.Stdio> = McpStdio.layer({
	name: "typed",
	version: "0.0.0",
	registrations: McpToolkit.layer(Kit).pipe(Layer.provide(Handlers)),
});
