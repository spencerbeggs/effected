import { Context, Effect, Layer } from "effect";
import { McpSchema, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import type { UnknownKeysLevel } from "./ToolInputSchema.js";
import { ToolInputSchema } from "./ToolInputSchema.js";

/**
 * Options for {@link McpToolkit.layer}.
 *
 * @public
 */
export interface McpToolkitOptions {
	/**
	 * `"all"` (the default): every tool without its own `Tool.Strict`
	 * annotation is served and decoded strict. `"annotated"`: only tools
	 * annotated `Tool.Strict` true are. In both modes an explicit annotation,
	 * true or false, always wins, and a `Tool.dynamic` tool is never
	 * re-annotated (core dies at registration on a strict dynamic tool). Only
	 * a tool that ends up strict gets the unknown-key pre-check; a lenient
	 * one is passed through untouched even if its raw schema is closed.
	 */
	readonly strict?: "all" | "annotated" | undefined;
	/**
	 * Replaces the default `ToolInputSchema.formatUnknownKeys` rendering. It
	 * runs per rejected call inside the handler's effect, so a throw becomes
	 * a defect of that call alone — the client receives a JSON-RPC internal
	 * error (-32603) — never a crash of the server.
	 */
	readonly unknownKeyMessage?: ((levels: ReadonlyArray<UnknownKeysLevel>) => string) | undefined;
}

// Set from probe P2: Claude Code 2.1.281 sends a tool call's `arguments` with
// exactly the declared keys and keeps every extra under `params._meta`, so
// strict-by-default rejects nothing a real client sends.
const DEFAULT_STRICT: "all" | "annotated" = "all";

// A dynamic tool is skipped: core dies at registration on a strict dynamic
// tool, because it cannot strictly validate a raw JSON Schema.
const strictened = <Tools extends Record<string, Tool.Any>>(
	toolkit: Toolkit.Toolkit<Tools>,
	mode: "all" | "annotated",
): Toolkit.Toolkit<Tools> =>
	mode === "annotated"
		? toolkit
		: (Toolkit.make(
				...Object.values(toolkit.tools).map((tool: Tool.Any) =>
					Tool.isDynamic(tool) || Tool.getStrictMode(tool) !== undefined ? tool : tool.annotate(Tool.Strict, true),
				),
			) as unknown as Toolkit.Toolkit<Tools>);

/**
 * Register a toolkit exactly as core's `McpServer.toolkit` does, except that a
 * strict tool's unknown arguments are all named, at every depth, in one
 * response.
 *
 * @remarks
 * Rejection itself is core's: a tool annotated `Tool.Strict` is served with
 * `additionalProperties: false` on every object node and decoded with
 * `onExcessProperty: "error"`. But core reports only the FIRST excess key
 * (`Expected no excess property at ["extra"]`), so an agent fixes one typo
 * per round trip and never learns about a nested one until the next call.
 * This layer is the better report, not the rejecter: it runs core's
 * `registerToolkit` unchanged under a registration-scoped `McpServer` whose
 * `addTool` puts a `ToolInputSchema.unknownKeys` pre-check in front of each
 * handler. The pre-check walks the input schema the tool actually serves
 * (after core's own top-level `$ref` inlining), follows `$ref`, `allOf` and
 * discriminated `oneOf`/`anyOf` members, and fails with one
 * `McpSchema.InvalidParams` naming every unknown key path plus the accepted
 * params, before core decodes. Core's strict decode stays behind it as the
 * backstop. The pre-check is gated on the same predicate core uses to choose
 * strict decoding — the registered tool's `Tool.Strict` annotation is
 * `true` — so a lenient tool (explicit `Tool.Strict` false, a
 * `Tool.dynamic` tool, or any unannotated tool under `"annotated"`) is
 * never rejected here, even when its raw JSON Schema carries
 * `additionalProperties: false`. The pre-check runs under `Effect.suspend`,
 * so a throwing `unknownKeyMessage` dies inside the call's effect. No core
 * internals are patched, so this survives an rc bump without re-diffing.
 *
 * Registration goes through core's module-level `McpServer.McpServer.layer`,
 * shared by reference with `McpStdio.layer`'s own copy — provide both into
 * the same graph, as with `McpServer.toolkit`. Never wrap that layer in
 * `Layer.fresh`: tools would register into a second registry nobody serves.
 *
 * Each call mints a fresh layer; bind the result to a `const` or the
 * registration runs twice.
 *
 * @example
 * ```ts
 * import { Layer } from "effect";
 * import { McpStdio, McpToolkit } from "@effected/mcp";
 *
 * const ToolsLayer = McpToolkit.layer(MyToolkit).pipe(Layer.provide(MyHandlers));
 * const ServerLayer = ToolsLayer.pipe(Layer.provideMerge(McpStdio.layer({ name: "my-server", version: "1.0.0" })));
 * ```
 *
 * @public
 */
export class McpToolkit {
	private constructor() {}

	/**
	 * `McpServer.toolkit`'s registration layer, strict by default and naming
	 * every unknown argument in one `InvalidParams`.
	 */
	static readonly layer = <Tools extends Record<string, Tool.Any>>(
		toolkit: Toolkit.Toolkit<Tools>,
		options: McpToolkitOptions = {},
	): Layer.Layer<
		never,
		never,
		Tool.HandlersFor<Tools> | Exclude<Tool.HandlerServices<Tools>, McpSchema.McpRequestContext>
	> =>
		Layer.effectDiscard(
			Effect.gen(function* () {
				const registry = yield* McpServer.McpServer;
				const format =
					options.unknownKeyMessage ??
					((levels: ReadonlyArray<UnknownKeysLevel>) => ToolInputSchema.formatUnknownKeys(levels));
				const decorated = McpServer.McpServer.of({
					...registry,
					addTool: (registration) =>
						// Same predicate core uses to pick strict decoding (`Tool.getStrictMode(tool) === true`):
						// a tool core decodes leniently is never rejected here, whatever its schema looks like.
						Context.get(registration.annotations, Tool.Strict) === true
							? registry.addTool({
									...registration,
									handle: (payload) =>
										Effect.suspend(() => {
											const levels = ToolInputSchema.unknownKeys(payload ?? {}, registration.tool.inputSchema);
											return levels.length > 0
												? Effect.fail(new McpSchema.InvalidParams({ message: format(levels) }))
												: registration.handle(payload);
										}),
								})
							: registry.addTool(registration),
				});
				yield* McpServer.registerToolkit(strictened(toolkit, options.strict ?? DEFAULT_STRICT)).pipe(
					Effect.provideService(McpServer.McpServer, decorated),
				);
			}),
		).pipe(Layer.provide(McpServer.McpServer.layer));
}
