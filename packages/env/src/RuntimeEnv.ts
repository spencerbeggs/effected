import { Context, Effect, Layer, Option, Schema } from "effect";
import { detectAgent, detectCi } from "./internal/agentCi.js";
import { readEnv } from "./internal/envRecord.js";
import { allKeys } from "./internal/keys.js";
import { detectOsc8 } from "./internal/osc8/detect.js";

/**
 * An `Option` field that encodes `None` as `null` and decodes when its key is absent, so a persisted snapshot keeps
 * decoding after a field is added.
 */
const optionField = <S extends Schema.Constraint>(schema: S) =>
	Schema.OptionFromNullOr(schema).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(Option.none())));

/**
 * A snapshot of who is running the program: the agent, the CI, and the terminal.
 *
 * @remarks
 * Each field is an `Option` in memory and `null` when absent on the wire, so the snapshot persists as plain JSON
 * through `Schema.fromJsonString(RuntimeEnv)`. **Fields added after 0.1.0 must decode when absent**, as every field
 * does today, so a persisted snapshot keeps decoding. Built from `Config` only (no stream is consulted), so it is safe
 * inside a stdio MCP server. See `okf/modules/env.md`.
 *
 * @public
 */
export class RuntimeEnv extends Schema.Class<RuntimeEnv>("@effected/env/RuntimeEnv")({
	/**
	 * The AI agent running the process, as its family (`claude` for Claude Code, whatever `AI_AGENT` says it is
	 * beyond that), or `None`.
	 */
	agent: optionField(Schema.String),
	/** The CI the process runs in: `github-actions` or `generic`, or `None`. */
	ci: optionField(Schema.String),
	/** The identified terminal program and its version when it exposes one, or `None`. */
	terminal: optionField(Schema.Struct({ name: Schema.String, version: optionField(Schema.String) })),
}) {}

/**
 * The fields {@link CurrentRuntimeEnv.layerTest} can override.
 *
 * @public
 */
export interface RuntimeEnvOverrides {
	/** Replaces the detected agent. */
	readonly agent?: Option.Option<string>;
	/** Replaces the detected CI. */
	readonly ci?: Option.Option<string>;
	/** Replaces the detected terminal. */
	readonly terminal?: Option.Option<{ readonly name: string; readonly version: Option.Option<string> }>;
}

/**
 * The {@link RuntimeEnv} of the running process, as a service.
 *
 * @remarks
 * The service's whole shape is one immutable value, so it is provided with `Layer.succeed` rather than mocked.
 * `layer` reads the ambient `ConfigProvider` once when it is built; `layerTest` is the only way a test changes the
 * environment. See `okf/modules/env.md`.
 *
 * @public
 */
export class CurrentRuntimeEnv extends Context.Service<CurrentRuntimeEnv, RuntimeEnv>()(
	"@effected/env/CurrentRuntimeEnv",
) {
	/**
	 * Reads the environment through `Config` once, when the layer is built. Requires nothing: the provider is read
	 * from the ambient `ConfigProvider`.
	 */
	static readonly layer: Layer.Layer<CurrentRuntimeEnv> = Layer.effect(
		this,
		Effect.map(
			readEnv(allKeys),
			(env) =>
				new RuntimeEnv({
					agent: detectAgent(env),
					ci: detectCi(env),
					terminal: detectOsc8(env, false, false).terminal,
				}),
		),
	);

	/**
	 * A fixed snapshot that never touches `Config`: every field is `None` unless `overrides` sets it.
	 *
	 * @param overrides - the fields to set
	 */
	static readonly layerTest = (overrides: RuntimeEnvOverrides = {}): Layer.Layer<CurrentRuntimeEnv> =>
		Layer.succeed(
			CurrentRuntimeEnv,
			new RuntimeEnv({
				agent: overrides.agent ?? Option.none(),
				ci: overrides.ci ?? Option.none(),
				terminal: overrides.terminal ?? Option.none(),
			}),
		);
}
