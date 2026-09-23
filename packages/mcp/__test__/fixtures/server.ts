import { Context, Effect, Layer, Schema, Stdio, Stream } from "effect";
import { McpSchema, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { McpStdio, type McpStdioOptions, ToolFailure } from "../../src/index.js";

/** A consumer-shaped declared failure: ToolFailure's fields spread into a TaggedError. */
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { ...ToolFailure.fields, id: Schema.String }) {}

const remediation = { hint: "Check the id.", suggestedTool: "list_things" };

export const Echo = Tool.make("echo", {
	description: "Echo text back.",
	parameters: Schema.Struct({ text: Schema.String }),
	success: Schema.Struct({ text: Schema.String }),
})
	.annotate(Tool.Title, "Echo")
	.annotate(Tool.Readonly, true);
export const Lookup = Tool.make("lookup", {
	description: "Look a thing up by id.",
	parameters: Schema.Struct({ id: Schema.String }),
	success: Schema.Struct({ id: Schema.String }),
	failure: NotFound,
});
export const Boom = Tool.make("boom", { description: "Always dies.", success: Schema.Struct({ ok: Schema.Boolean }) });
export const Ping = Tool.make("ping", { description: "Takes no parameters.", success: Schema.Struct({ pong: Schema.Boolean }) });
export const Hang = Tool.make("hang", { description: "Never completes.", success: Schema.Struct({ ok: Schema.Boolean }) });
export const Garble = Tool.make("garble", {
	description: "Writes a stray line to stdout.",
	success: Schema.Struct({ ok: Schema.Boolean }),
	dependencies: [Stdio.Stdio],
});
export const Grow = Tool.make("grow", {
	description: "Registers another tool at runtime.",
	success: Schema.Struct({ ok: Schema.Boolean }),
	dependencies: [McpServer.McpServer],
});
export const Version = Tool.make("version", { description: "Returns a bare string.", success: Schema.String });

export const FixtureKit = Toolkit.make(Echo, Lookup, Boom, Ping, Hang, Garble, Grow, Version);

export const FixtureHandlers = FixtureKit.toLayer({
	echo: ({ text }) => Effect.succeed({ text }),
	lookup: ({ id }) =>
		Effect.fail(
			new NotFound({ id, remediation, message: ToolFailure.message(`No thing "${ToolFailure.truncate(id)}".`, remediation) }),
		),
	boom: () => Effect.die(new Error("kaboom")),
	ping: () => Effect.succeed({ pong: true }),
	hang: () => Effect.never,
	garble: () =>
		Effect.gen(function* () {
			const stdio = yield* Stdio.Stdio;
			yield* Stream.run(Stream.make("garbage\n"), stdio.stdout());
			return { ok: true };
		}).pipe(Effect.orDie),
	grow: () =>
		Effect.gen(function* () {
			const server = yield* McpServer.McpServer;
			yield* server.addTool({
				tool: new McpSchema.Tool({ name: "late", inputSchema: { type: "object" } }),
				annotations: Context.empty(),
				handle: () => Effect.succeed(new McpSchema.CallToolResult({ content: [] })),
			});
			return { ok: true };
		}),
	version: () => Effect.succeed("1.2.3"),
});

/** The toolkit provided WITH McpStdio.layer — the composition okfit uses. */
export const fixtureServer = (options: Pick<McpStdioOptions, "protocols"> = {}) =>
	McpServer.toolkit(FixtureKit).pipe(
		Layer.provide(FixtureHandlers),
		Layer.provideMerge(McpStdio.layer({ name: "fixture", version: "0.0.0", ...options })),
	);

const BoomKit = Toolkit.make(Boom);

/** The toolkit MERGED BESIDE McpStdio.layer — it never sees the layer's outputs at build time. */
export const fixtureServerMerged = () =>
	Layer.mergeAll(
		McpServer.toolkit(BoomKit).pipe(Layer.provide(BoomKit.toLayer({ boom: () => Effect.die(new Error("kaboom")) }))),
		McpStdio.layer({ name: "fixture-merged", version: "0.0.0" }),
	);
