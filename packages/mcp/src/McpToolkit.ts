import type { JsonSchema } from "effect";
import { Context, Effect, Layer, Schema } from "effect";
import { McpSchema, McpServer, Tool, Toolkit } from "effect/ai";
import { ToolFailure } from "./ToolFailure.js";
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
	 * re-annotated (core dies at registration on a strict dynamic tool).
	 */
	readonly strict?: "all" | "annotated" | undefined;
	/**
	 * Ignored. Core's strict decode reports every excess key at every depth,
	 * together with every missing or invalid field, in one `InvalidParams`,
	 * and the layer appends a fixed `Accepted params at <path>: …` line per
	 * level that carries an unknown key; this option changes neither.
	 *
	 * @deprecated A no-op, scheduled for removal in a later minor.
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
	/** The success schema. Defaults to `Schema.Void`; object-root a union whose members are all objects with `ToolOutputSchema.objectRooted`. */
	readonly success?: S | undefined;
	/** Declared failures besides `InvalidParams`, such as `ToolRefusal`. Defaults to `Schema.Never`. */
	readonly failure?: F | undefined;
	/** Services the handler needs, as with `Tool.make`. */
	readonly dependencies?: Dependencies | undefined;
}

/**
 * Options for {@link McpToolkit.unionHandler}.
 *
 * @public
 */
export interface UnionHandlerOptions {
	/**
	 * Ignored. The union decode reports every excess, missing and invalid
	 * field in one `InvalidParams`, followed by the same fixed
	 * `Accepted params at <path>: …` lines {@link McpToolkit.layer} appends;
	 * this option changes neither.
	 *
	 * @deprecated A no-op, scheduled for removal in a later minor.
	 */
	readonly unknownKeyMessage?: ((levels: ReadonlyArray<UnknownKeysLevel>) => string) | undefined;
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

const MAX_ACCEPTED_LINES = 20;

/**
 * `path` as core renders an issue path, `["a"][0]["b"]`: a segment indexing
 * an array in `payload` is bare, any other is a JSON string. Truncated, since
 * the segments are the caller's keys.
 */
const issuePath = (payload: unknown, path: ReadonlyArray<string>): string => {
	let node = payload;
	let out = "";
	for (const segment of path) {
		out += Array.isArray(node) ? `[${segment}]` : `[${JSON.stringify(segment)}]`;
		node = typeof node === "object" && node !== null ? (node as Record<string, unknown>)[segment] : undefined;
	}
	return ToolFailure.truncate(out);
};

/**
 * One line per level of `payload` that carries a key the served
 * `inputSchema` does not accept: `Accepted params at <path>: a, b.`, with
 * `keys matching <pattern>` for a level that also accepts keys by
 * `patternProperties`, and `This tool accepts no params.` for a
 * zero-parameter root. At most 20 lines; empty when no level has an
 * unknown key.
 */
const acceptedParamsLines = (payload: unknown, inputSchema: JsonSchema.JsonSchema): ReadonlyArray<string> =>
	ToolInputSchema.unknownKeys(payload, inputSchema)
		.slice(0, MAX_ACCEPTED_LINES)
		.map((level) => {
			const patterns = level.acceptedPatterns ?? [];
			if (level.path.length === 0 && level.accepted.length === 0 && patterns.length === 0) {
				return "This tool accepts no params.";
			}
			const parts = [
				...(level.accepted.length > 0 ? [level.accepted.join(", ")] : []),
				...(patterns.length > 0 ? [`keys matching ${patterns.join(", ")}`] : []),
			];
			const where = level.path.length === 0 ? "the root" : issuePath(payload, level.path);
			return `Accepted params at ${where}: ${parts.length > 0 ? parts.join("; ") : "(none)"}.`;
		});

/**
 * `error` with {@link acceptedParamsLines} appended to its message, one per
 * line after core's own report; `error` itself when there is nothing to add.
 * Core stays the decoder: this only annotates the report it produced.
 */
const withAcceptedParams = (
	error: McpSchema.InvalidParams,
	payload: unknown,
	inputSchema: JsonSchema.JsonSchema,
): McpSchema.InvalidParams => {
	const lines = acceptedParamsLines(payload, inputSchema);
	return lines.length === 0
		? error
		: new McpSchema.InvalidParams({
				message: [error.message, ...lines].join("\n"),
				...(error.data !== undefined ? { data: error.data } : {}),
			});
};

/**
 * The one decode a union tool's payload gets, shared by the `McpToolkit.layer`
 * decorator and {@link McpToolkit.unionHandler}: the union's strict decode
 * with the options core decodes a strict `Tool.make` tool with
 * (`onExcessProperty: "error"`, `errors: "all"`), so every excess, missing and
 * invalid field of the matched member is reported together, worded as core
 * words a `Tool.make` failure, with the accepted params appended as the layer
 * appends them to core's own report.
 */
const decodeUnionPayload = <A>(
	name: string,
	union: Schema.Decoder<A>,
	inputSchema: JsonSchema.JsonSchema,
): ((payload: unknown) => Effect.Effect<A, McpSchema.InvalidParams>) => {
	const decode = Schema.decodeUnknownEffect(union);
	return (payload) => {
		const raw = payload ?? {};
		return decode(raw, { onExcessProperty: "error", errors: "all" }).pipe(
			Effect.mapError((error) => withAcceptedParams(invalidParameters(name, error.message), raw, inputSchema)),
		);
	};
};

type Registration = Parameters<McpServer.McpServer["Service"]["addTool"]>[0];

/**
 * The registration `McpToolkit.layer` hands core in place of `registration`:
 * a union tool gets its payload decoded first, with the wrapped handler built
 * only after the decode passes, so a rejected payload never reaches it.
 * Anything else is decoded by core as before, and core's parameter failure,
 * the only `InvalidParams` its `handle` fails with, gets the accepted params
 * appended.
 *
 * @internal
 */
export const guardRegistration = (registration: Registration): Registration => {
	const union = Context.get(registration.annotations, UnionParameters);
	if (union === undefined) {
		return {
			...registration,
			handle: (payload) =>
				registration
					.handle(payload)
					.pipe(
						Effect.catchTag("InvalidParams", (error) =>
							Effect.fail(withAcceptedParams(error, payload ?? {}, registration.tool.inputSchema)),
						),
					),
		};
	}
	// Outside core's handler, so an InvalidParams here lands where core's own
	// parameter failure does: -32602 on 2025-06-18, isError on later revisions.
	const check = decodeUnionPayload(registration.tool.name, union, registration.tool.inputSchema);
	return {
		...registration,
		handle: (payload) => check(payload).pipe(Effect.flatMap(() => registration.handle(payload))),
	};
};

// Strict by default because a real client allows it: Claude Code 2.1.281 sends a tool call's `arguments` with
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
 * Register a toolkit exactly as core's `McpServer.toolkit` does, except that
 * every tool is strict by default and a {@link McpToolkit.unionTool} gets its
 * union decoded.
 *
 * @remarks
 * Rejection and reporting are core's: a tool annotated `Tool.Strict` is
 * served with `additionalProperties: false` on every object node and decoded
 * with `onExcessProperty: "error"` and `errors: "all"`, so one
 * `InvalidParams` names every excess key at every depth together with every
 * missing or invalid field. The layer appends to that report, never in place
 * of it: for every object level of the payload that carries a key the served
 * input schema does not accept, one line naming what that level does accept,
 * `Accepted params at the root: query, filter.` or
 * `Accepted params at ["filter"]: kind, tag.` (the path as core writes it),
 * with `keys matching <pattern>` for keys a `patternProperties` level
 * accepts, and `This tool accepts no params.` for a zero-parameter tool. An
 * agent can fix the call from the reply alone. A failure with no unknown key
 * (a missing or mistyped field only) is core's report unchanged. The lines
 * are appended to core's `InvalidParams` as it leaves the tool's registered
 * handler, the one failure that handler has for bad parameters.
 *
 * On top of that is the policy: under
 * `strict: "all"` (the default) it annotates every tool that carries no
 * `Tool.Strict` annotation of its own as strict, skipping `Tool.dynamic`
 * tools (core dies at registration on a strict dynamic tool). It runs core's
 * `registerToolkit` unchanged under a registration-scoped `McpServer` whose
 * `addTool` puts the union decode in front of a union tool's handler and
 * passes every other registration through untouched. It patches no core
 * internals: it uses only `McpServer.registerToolkit` and `addTool`.
 *
 * Registration goes through core's module-level `McpServer.McpServer.layer`,
 * shared by reference with `McpStdio.layer`'s own copy — provide both into
 * the same graph, as with `McpServer.toolkit`. Never wrap that layer in
 * `Layer.fresh`: tools would register into a second registry nobody serves.
 * To give two servers separate registries, wrap each whole bundle (this
 * layer together with `McpStdio.layer`) in `Layer.fresh` instead.
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
	 * treatment as a strict `Tool.make` tool: a strict decode with
	 * `errors: "all"` before the handler runs, reporting every excess, missing
	 * and invalid field of the matched member in one `InvalidParams`, with the
	 * same `Accepted params at <path>: …` lines appended, so bad
	 * arguments answer JSON-RPC `-32602` on `2025-06-18` and an `isError`
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
	 * exactly as {@link McpToolkit.layer} does, and passes the decoded member
	 * to `handler`.
	 *
	 * @remarks
	 * A payload that does not decode strictly fails with one
	 * `McpSchema.InvalidParams`, worded as core words a `Tool.make` decode
	 * failure, naming every excess key at every depth together with every
	 * missing or invalid field of the matched member, then one
	 * `Accepted params at <path>: …` line per level with an unknown key. It
	 * is the same
	 * implementation the layer runs, so a handler called directly (a test
	 * helper, or a toolkit registered through core's `McpServer.toolkit`)
	 * reports what a client of the layer sees. Under {@link McpToolkit.layer}
	 * the layer has already rejected a bad call before the handler runs.
	 * `options.unknownKeyMessage` is deprecated and ignored.
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
		_options: UnionHandlerOptions = {},
	): ((payload: unknown) => Effect.Effect<A, E | McpSchema.InvalidParams, RH>) => {
		const check = decodeUnionPayload(tool.name, tool.unionParameters, tool.jsonSchema);
		return (payload) => check(payload).pipe(Effect.flatMap(handler));
	};

	/**
	 * `McpServer.toolkit`'s registration layer, strict by default.
	 * `options.unknownKeyMessage` is deprecated and ignored.
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
				const decorated = McpServer.McpServer.of({
					...registry,
					addTool: (registration) => registry.addTool(guardRegistration(registration)),
				});
				yield* McpServer.registerToolkit(strictened(toolkit, options.strict ?? DEFAULT_STRICT)).pipe(
					Effect.provideService(McpServer.McpServer, decorated),
				);
			}),
		).pipe(Layer.provide(McpServer.McpServer.layer));
}
