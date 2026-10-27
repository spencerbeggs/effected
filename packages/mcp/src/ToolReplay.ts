import type { Struct } from "effect";
import { Effect, Option, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import { ToolOutcome } from "./ToolOutcome.js";

/**
 * The narrow store {@link ToolReplay.wrap} reads and writes: `get` and `set`
 * on string values, nothing else.
 *
 * @remarks
 * Core's `KeyValueStore` already satisfies it structurally, so a
 * `KeyValueStore` value can be passed as is. An application backed by its
 * own table implements just these two methods, instead of stubbing the
 * `remove`, `clear` and `size` that `KeyValueStore.makeStringOnly` demands.
 *
 * `get` answers `undefined` for a missing key, the same contract as
 * `KeyValueStore.get`. A failure from either method is never a tool error:
 * a failed `get` is a miss and a failed `set` is a skipped write, both
 * logged at debug level, so the error channel is `unknown`.
 *
 * @public
 */
export interface ToolReplayStore {
	/** The stored value for `key`, or `undefined` when nothing is stored under it. */
	readonly get: (key: string) => Effect.Effect<string | undefined, unknown>;
	/** Stores `value` under `key`, replacing any earlier value. */
	readonly set: (key: string, value: string) => Effect.Effect<void, unknown>;
}

/**
 * What {@link ToolReplay.wrap} needs to know about one tool.
 *
 * @typeParam Store - The type of {@link ToolReplayOptions.store}; when it is
 * omitted, `wrap` requires `KeyValueStore` in `R` instead.
 *
 * @public
 */
export interface ToolReplayOptions<P, S extends Schema.Top, Store extends ToolReplayStore | undefined = undefined> {
	/** The served tool name. It must not contain `:`, the separator of the stored key ({@link ToolReplay.storeKey}). */
	readonly tool: string;
	/**
	 * The tool's success schema. Results are stored encoded through it and
	 * decoded through it on replay. It must declare {@link ToolReplay.marker} on
	 * each object member, or core's encoder drops the marker from the reply:
	 * build each member with {@link ToolReplay.success} so it cannot be left out.
	 */
	readonly success: S;
	/**
	 * The idempotency key for one call; `Option.none()` runs the handler with
	 * nothing stored or replayed.
	 *
	 * @remarks
	 * The key must identify the request completely. A replay compares nothing
	 * else: not the params, not the schema version. So a reused key with
	 * different params returns the FIRST call's result. When the params under
	 * one caller-supplied id can vary, fold a digest of them into the key.
	 */
	readonly key: (params: P) => Option.Option<string>;
	/**
	 * Where results are stored. Omitted, `wrap` reads core's `KeyValueStore`
	 * from `R`; given, it uses this store and `KeyValueStore` leaves `R`.
	 */
	readonly store?: Store;
}

/**
 * Idempotent replay for a write tool: a repeated call with the same key returns
 * the first call's stored result, marked `_idempotentReplay: true`, instead of
 * running the mutation again.
 *
 * @remarks
 * The store is core's `KeyValueStore` (`effect/persistence`), required in `R`
 * (`KeyValueStore.layerMemory`, `layerFileSystem` or `layerSql`), unless
 * {@link ToolReplayOptions.store} supplies a {@link ToolReplayStore}: just
 * `get` and `set`, for an application's own table. Then `R` carries no
 * `KeyValueStore`.
 *
 * Semantics, per call:
 *
 * - A key of `Option.none()` runs the handler; nothing is read or stored.
 * - A stored value that decodes through `success` is returned with the marker,
 *   and the handler does not run.
 * - A miss runs the handler and stores its result, best-effort. A store that
 *   fails, a row that no longer decodes (written under an older schema, or
 *   corrupt), and a failed write are each a miss or a skipped write, never a
 *   tool error. Each is logged at debug level with the tool name.
 * - A handler failure stores nothing, so a retry runs it again.
 * - An `ok: false` result (a {@link ToolOutcome} envelope failure) is never
 *   stored: a "not found" must not replay after the thing exists.
 *
 * This is replay, not exactly-once: two concurrent calls with one key both
 * miss and both run.
 *
 * The key is the whole identity of a request. A hit compares neither the
 * params nor the schema version (a row written under an older schema replays
 * whenever it still decodes), and rows never expire: the store keeps a result
 * until something removes it. A key reused with different params therefore
 * replays the first result, so {@link ToolReplayOptions.key} must fold in a
 * digest of any params that can vary under one id.
 *
 * Wrap it inside {@link ToolOutcome.catchAsEnvelope}, so the envelope sees the
 * handler's real errors and replay sees only real successes.
 *
 * @example
 * ```ts
 * import { ToolReplay } from "@effected/mcp"
 * import { Option, Schema } from "effect"
 *
 * const Created = ToolReplay.success(Schema.Struct({ ok: Schema.Literal(true), id: Schema.Number }))
 * const create = ToolReplay.wrap({
 * 	tool: "goal_create",
 * 	success: Created,
 * 	key: (params: { readonly requestId?: string }) => Option.fromUndefinedOr(params.requestId),
 * })(createGoal)
 * ```
 *
 * @public
 */
export class ToolReplay {
	private constructor() {}

	/**
	 * The marker field, to spread into each object member of a replayable
	 * success schema. {@link ToolReplay.success} adds it for you.
	 */
	static readonly marker = {
		_idempotentReplay: Schema.optionalKey(
			Schema.Literal(true).annotate({
				description:
					"Present and true when this result replays an earlier call with the same idempotency key: the stored result is returned and the mutation did not run again.",
			}),
		),
	} as const;

	/**
	 * A struct with {@link ToolReplay.marker} added. Use it for each object
	 * success member, so core's encoder keeps the marker on a replayed reply.
	 *
	 * @remarks
	 * Built with core's `fieldsAssign`, which, like `mapFields`, does not carry
	 * the struct's own `.check(...)` refinements over: apply checks to the
	 * result, not to the struct passed in.
	 */
	static readonly success = <const Fields extends Schema.Struct.Fields>(
		schema: Schema.Struct<Fields>,
	): Schema.Struct<Struct.Simplify<Struct.Assign<Fields, typeof ToolReplay.marker>>> =>
		schema.pipe(Schema.fieldsAssign(ToolReplay.marker));

	/**
	 * The `KeyValueStore` key one call is stored under: `<tool>:<key>`. Split on
	 * the first `:` to recover both parts; MCP tool names are `[A-Za-z0-9_.-]`.
	 */
	static readonly storeKey = (tool: string, key: string): string => `${tool}:${key}`;

	/**
	 * Wraps a handler with replay. Throws at wrap time when `tool` contains
	 * `:`, a wiring mistake, so it surfaces when the server is built.
	 */
	static readonly wrap = <P, S extends Schema.Top, Store extends ToolReplayStore | undefined = undefined>(
		options: ToolReplayOptions<P, S, Store>,
	): (<E, R>(
		handler: (params: P) => Effect.Effect<S["Type"], E, R>,
	) => (
		params: P,
	) => Effect.Effect<
		S["Type"],
		E,
		| R
		| ([Store] extends [ToolReplayStore] ? never : KeyValueStore.KeyValueStore)
		| S["DecodingServices"]
		| S["EncodingServices"]
	>) => {
		if (options.tool.includes(":")) {
			throw new Error(`ToolReplay.wrap: tool name "${options.tool}" contains ":", the stored-key separator.`);
		}
		const { tool, success } = options;
		const given: ToolReplayStore | undefined = options.store;
		// The JSON codec is built once per wrap, not per call: the same pair `KeyValueStore.toSchemaStore` builds.
		const json = Schema.fromJsonString(Schema.toCodecJson(success));
		const decode = Schema.decodeEffect(json);
		const encode = Schema.encodeEffect(json);
		type Codec = S["DecodingServices"] | S["EncodingServices"];
		type Read = [Store] extends [ToolReplayStore] ? never : KeyValueStore.KeyValueStore;
		return <E, R>(handler: (params: P) => Effect.Effect<S["Type"], E, R>) =>
			(params: P): Effect.Effect<S["Type"], E, R | Read | Codec> => {
				const found = options.key(params);
				if (Option.isNone(found)) return handler(params);
				const storeKey = ToolReplay.storeKey(tool, found.value);
				// Typed in full, so a wrong error or service type in the body still fails to compile.
				const replayed: Effect.Effect<S["Type"], E, R | KeyValueStore.KeyValueStore | Codec> = Effect.gen(function* () {
					const store: ToolReplayStore = given ?? (yield* KeyValueStore.KeyValueStore);
					const cached = yield* store.get(storeKey).pipe(
						Effect.flatMap((raw) => (raw === undefined ? Effect.succeedNone : Effect.asSome(decode(raw)))),
						Effect.tapCause((cause) =>
							Effect.logDebug("ToolReplay lookup failed; treating as a miss", { tool, cause }),
						),
						Effect.orElseSucceed(() => Option.none<S["Type"]>()),
					);
					if (Option.isSome(cached)) {
						yield* Effect.annotateCurrentSpan("mcp.tool.replayed", true);
						return withMarker(cached.value);
					}
					yield* Effect.annotateCurrentSpan("mcp.tool.replayed", false);
					const result = yield* handler(params);
					if (!ToolOutcome.isFailure(result)) {
						yield* encode(result).pipe(
							Effect.flatMap((encoded) => store.set(storeKey, encoded)),
							Effect.tapCause((cause) =>
								Effect.logDebug("ToolReplay store failed; result not stored", { tool, cause }),
							),
							Effect.ignore,
						);
					}
					return result;
				}).pipe(Effect.withSpan("ToolReplay.wrap", { attributes: { "mcp.tool.name": tool } }));
				// The one narrowing: `KeyValueStore` leaves `R` exactly when `store` is given, the one case the body never
				// reads it (`given ?? …` short-circuits). `E`, `R` and the codec services pass through unchanged.
				return replayed as Effect.Effect<S["Type"], E, R | Read | Codec>;
			};
	};
}

const withMarker = <A>(value: A): A =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? ({ ...value, _idempotentReplay: true } as A)
		: value;
