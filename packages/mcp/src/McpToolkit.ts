import type { JsonSchema } from "effect";
import { Context, Effect, Layer, Schema } from "effect";
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

/**
 * A `Tool.dynamic` made by {@link McpToolkit.unionTool}: served with the
 * strict, object-rooted JSON Schema of a `Schema.Union` of objects, and
 * carrying that union so {@link McpToolkit.unionHandler} can decode it.
 *
 * @remarks
 * `annotate` and `addDependency` keep the type, so a chained
 * `.annotate(Tool.Title, …)` still hands `unionHandler` the union. The
 * declared failure is `failure` together with `McpSchema.InvalidParams`.
 *
 * @public
 */
export interface UnionTool<
	Name extends string,
	P extends Schema.Decoder<unknown>,
	S extends Schema.Constraint,
	F extends Schema.Constraint,
	R = never,
> extends Tool.Dynamic<
		Name,
		{
			readonly parameters: JsonSchema.JsonSchema;
			readonly success: S;
			readonly failure: Schema.Union<readonly [F, typeof McpSchema.InvalidParams]>;
			readonly failureMode: "error";
		},
		R
	> {
	/** The union the tool decodes its arguments with. */
	readonly unionParameters: P;
	/** Add an annotation, keeping the union. */
	annotate<I, V>(tag: Context.Key<I, V>, value: V): UnionTool<Name, P, S, F, R>;
	/** Add a request-level dependency, keeping the union. */
	addDependency<Identifier, Service>(tag: Context.Key<Identifier, Service>): UnionTool<Name, P, S, F, Identifier | R>;
}

/**
 * Options for {@link McpToolkit.unionTool}.
 *
 * @public
 */
export interface UnionToolOptions<
	P extends Schema.Decoder<unknown>,
	S extends Schema.Constraint,
	F extends Schema.Constraint,
	Dependencies extends ReadonlyArray<Context.Key<unknown, unknown>>,
> {
	/** What the tool does, for the agent. */
	readonly description?: string | undefined;
	/** A `Schema.Union` of object schemas, discriminated by an `action`, `kind`, `_tag` or `type` literal. */
	readonly parameters: P;
	/** The success schema. Defaults to `Schema.Void`; object-root a union with `ToolOutputSchema.objectRooted`. */
	readonly success?: S | undefined;
	/** Declared failures besides `InvalidParams`, such as `ToolRefusal`. Defaults to `Schema.Never`. */
	readonly failure?: F | undefined;
	/** Services the handler needs, as with `Tool.make`. */
	readonly dependencies?: Dependencies | undefined;
}

/** The union a {@link McpToolkit.unionTool} decodes with; read by the `McpToolkit.layer` decorator. */
const UnionParameters = Context.Reference<Schema.Decoder<unknown> | undefined>("@effected/mcp/UnionParameters", {
	defaultValue: () => undefined,
});

/**
 * Effect's strict JSON Schema document for `parameters`, definitions attached
 * as `$defs`, then object-rooted: the served input schema of a union tool.
 */
const unionInputJsonSchema = (parameters: Schema.Decoder<unknown>): JsonSchema.JsonSchema => {
	const document = Schema.toJsonSchemaDocument(parameters, { onExcessProperty: "error" });
	return ToolInputSchema.objectRooted(
		Object.keys(document.definitions).length === 0
			? document.schema
			: { ...document.schema, $defs: document.definitions },
	);
};

const invalidParameters = (name: string, message: string): McpSchema.InvalidParams =>
	// Core's own wording for a `Tool.make` decode failure (`AiError.ToolParameterValidationError`).
	new McpSchema.InvalidParams({ message: `Invalid parameters for tool '${name}': ${message}` });

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
	 * A tool whose parameters are a `Schema.Union` of objects, which
	 * `Tool.make` cannot take: core dies at registration on a non-object
	 * `parameters` root.
	 *
	 * @remarks
	 * The tool is a `Tool.dynamic` served with Effect's strict JSON Schema
	 * document for `parameters` (`additionalProperties: false` on every
	 * object node, definitions as `$defs`), rewritten by
	 * `ToolInputSchema.objectRooted` to an object root carrying `type`,
	 * `oneOf` and `x-discriminator`. Write its handler with
	 * {@link McpToolkit.unionHandler}, which receives the decoded member.
	 *
	 * Registered through {@link McpToolkit.layer}, a union tool gets the same
	 * treatment as a strict `Tool.make` tool: every unknown key named in one
	 * `InvalidParams`, then a strict decode, both before the handler runs, so
	 * bad arguments answer JSON-RPC `-32602` on `2025-06-18` and an `isError`
	 * result on the later revisions, exactly as a `Tool.make` decode failure
	 * does. Registered through core's `McpServer.toolkit` it still decodes
	 * strictly, in the handler, but the `InvalidParams` is then a declared
	 * failure: an `isError` result on every revision.
	 *
	 * Never annotate it `Tool.Strict` true: core dies at registration on a
	 * strict tool with a raw JSON Schema.
	 *
	 * @example
	 * ```ts
	 * const Note = McpToolkit.unionTool("note", {
	 *   parameters: Schema.Union([AddNote, ListNotes]),
	 *   success: ToolOutputSchema.objectRooted(Schema.Union([Added, Listed])),
	 *   failure: ToolRefusal,
	 * }).annotate(Tool.Title, "Note")
	 * const handlers = Kit.toLayer({ note: McpToolkit.unionHandler(Note, (params) => handleNote(params)) })
	 * ```
	 */
	static readonly unionTool = <
		const Name extends string,
		P extends Schema.Decoder<unknown>,
		S extends Schema.Constraint = typeof Schema.Void,
		F extends Schema.Constraint = typeof Schema.Never,
		const Dependencies extends ReadonlyArray<Context.Key<unknown, unknown>> = [],
	>(
		name: Name,
		options: UnionToolOptions<P, S, F, Dependencies>,
	): UnionTool<Name, P, S, F, Context.Service.Identifier<Dependencies[number]>> => {
		const tool = Tool.dynamic(name, {
			description: options.description,
			parameters: unionInputJsonSchema(options.parameters),
			success: options.success ?? Schema.Void,
			failure: Schema.Union([options.failure ?? Schema.Never, McpSchema.InvalidParams]),
		}).annotate(UnionParameters, options.parameters);
		// `Tool` clones copy own properties, so the union survives every later `annotate`.
		return Object.assign(tool, { unionParameters: options.parameters }) as unknown as UnionTool<
			Name,
			P,
			S,
			F,
			Context.Service.Identifier<Dependencies[number]>
		>;
	};

	/**
	 * The handler for a {@link McpToolkit.unionTool}: decodes the raw payload
	 * with the tool's union, `onExcessProperty: "error"`, and passes the
	 * decoded member to `handler`.
	 *
	 * @remarks
	 * A payload that does not decode fails with `McpSchema.InvalidParams`,
	 * worded as core words a `Tool.make` decode failure. Under
	 * {@link McpToolkit.layer} that never happens here: the layer has
	 * already rejected the call before the handler runs.
	 */
	static readonly unionHandler = <
		Name extends string,
		P extends Schema.Decoder<unknown>,
		S extends Schema.Constraint,
		F extends Schema.Constraint,
		R,
		A,
		E,
		RH,
	>(
		tool: UnionTool<Name, P, S, F, R>,
		handler: (params: P["Type"]) => Effect.Effect<A, E, RH>,
	): ((payload: unknown) => Effect.Effect<A, E | McpSchema.InvalidParams, RH>) => {
		const decode = Schema.decodeUnknownEffect(tool.unionParameters);
		return (payload) =>
			decode(payload ?? {}, { onExcessProperty: "error" }).pipe(
				Effect.mapError((error) => invalidParameters(tool.name, error.message)),
				Effect.flatMap(handler),
			);
	};

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
					addTool: (registration) => {
						const union = Context.get(registration.annotations, UnionParameters);
						if (union !== undefined) {
							// Outside core's handler, so an InvalidParams here lands where core's own
							// parameter failure does: -32602 on 2025-06-18, isError on later revisions.
							const decode = Schema.decodeUnknownEffect(union);
							const name = registration.tool.name;
							return registry.addTool({
								...registration,
								handle: (payload) =>
									Effect.suspend(() => {
										const raw = payload ?? {};
										const levels = ToolInputSchema.unknownKeys(raw, registration.tool.inputSchema);
										if (levels.length > 0) return Effect.fail(new McpSchema.InvalidParams({ message: format(levels) }));
										return decode(raw, { onExcessProperty: "error" }).pipe(
											Effect.mapError((error) => invalidParameters(name, error.message)),
											Effect.andThen(registration.handle(payload)),
										);
									}),
							});
						}
						// Same predicate core uses to pick strict decoding (`Tool.getStrictMode(tool) === true`):
						// a tool core decodes leniently is never rejected here, whatever its schema looks like.
						return Context.get(registration.annotations, Tool.Strict) === true
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
							: registry.addTool(registration);
					},
				});
				yield* McpServer.registerToolkit(strictened(toolkit, options.strict ?? DEFAULT_STRICT)).pipe(
					Effect.provideService(McpServer.McpServer, decorated),
				);
			}),
		).pipe(Layer.provide(McpServer.McpServer.layer));
}
