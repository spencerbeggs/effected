import { ConfigProvider, Context, Effect, Layer, Option, Schema } from "effect";
import type { CiName } from "./CiName.js";
import { detectAgent } from "./internal/agentCi.js";
import { ciNames, detectCi, detectCiRun } from "./internal/ci.js";
import { normalizeEnv, readEnv } from "./internal/envRecord.js";
import { allKeys } from "./internal/keys.js";
import { detectOsc8 } from "./internal/osc8/detect.js";
import { detectSession, detectTermProgram } from "./internal/session.js";

/**
 * An `Option` field that encodes `None` as `null` and decodes when its key is absent, so a persisted snapshot keeps
 * decoding after a field is added.
 */
const optionField = <S extends Schema.Constraint>(schema: S) =>
	Schema.OptionFromNullOr(schema).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(Option.none())));

/**
 * A field added after 0.1.0: an {@link optionField} that also defaults to `None` in `make`, so a caller written
 * against an older field set keeps constructing.
 */
const addedOptionField = <S extends Schema.Constraint>(schema: S) =>
	optionField(schema).pipe(Schema.withConstructorDefault(Effect.succeed(Option.none())));

/**
 * Where a {@link TerminalSession} came from, in priority order: `tmux` (`TMUX_PANE`), `screen` (`STY`),
 * `windows-terminal` (`WT_SESSION`), `wezterm` (`WEZTERM_PANE`), `kitty` (`KITTY_WINDOW_ID`), `term-session`
 * (`TERM_SESSION_ID`, set by iTerm2 and Terminal.app).
 *
 * @public
 */
export type SessionSource = "tmux" | "screen" | "windows-terminal" | "wezterm" | "kitty" | "term-session";

/**
 * The terminal or multiplexer session the process runs in: the identity that survives a re-attach or a new shell in
 * the same pane.
 *
 * @public
 */
export interface TerminalSession {
	/** Which source matched first: see {@link SessionSource}. */
	readonly source: SessionSource;
	/** The name of the environment variable that matched, verbatim, e.g. `TMUX_PANE`. */
	readonly variable: string;
	/** That variable's raw value, e.g. `%3`. */
	readonly id: string;
	/**
	 * The multiplexer the process runs inside, with its variable's raw value: `TMUX` (socket path, server pid and
	 * session index, unparsed) before `STY`. Present whenever either is set, whichever source won.
	 */
	readonly multiplexer: Option.Option<{ readonly name: "tmux" | "screen"; readonly value: string }>;
}

/**
 * The coordinates of the CI run the process is part of, each read raw from the provider's documented variable.
 *
 * @remarks
 * Present exactly when `RuntimeEnv.ci` is. A coordinate the provider does not document, and every coordinate of
 * `generic`, is `None`. Values are strings as the provider wrote them: providers disagree on whether an id is a
 * number, a UUID or a slug. For GitHub Actions they are `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_JOB`,
 * `GITHUB_SHA`, `GITHUB_REF_NAME`, and `RUNNER_OS` with `RUNNER_ARCH`.
 *
 * @public
 */
export interface CiRun {
	/** The run, build or pipeline id. */
	readonly runId: Option.Option<string>;
	/** The attempt (or retry count) of this run, where the provider has one. */
	readonly attempt: Option.Option<string>;
	/** The job (or step, or task) id within the run. */
	readonly jobId: Option.Option<string>;
	/** The commit being built. */
	readonly sha: Option.Option<string>;
	/** The short branch or tag name being built. */
	readonly refName: Option.Option<string>;
	/** The runner's operating system and architecture, as the provider spells them, where it exposes them. */
	readonly runner: Option.Option<{ readonly os: string; readonly arch: Option.Option<string> }>;
}

/**
 * `TERM_PROGRAM` and `TERM_PROGRAM_VERSION`, verbatim and independent of each other: the raw values behind
 * `RuntimeEnv.terminal`'s normalized name, kept even when the program is not a known terminal (`tmux`, `zed`).
 *
 * @public
 */
export interface TermProgram {
	/** `TERM_PROGRAM`, verbatim. */
	readonly name: Option.Option<string>;
	/** `TERM_PROGRAM_VERSION`, verbatim, whether or not `TERM_PROGRAM` is set. */
	readonly version: Option.Option<string>;
}

/**
 * A snapshot of who is running the program: the agent, the CI and its run, the terminal, and the session.
 *
 * @remarks
 * Each field is an `Option` in memory and `null` when absent on the wire, so the snapshot persists as plain JSON
 * through `Schema.fromJsonString(RuntimeEnv)`. Every field decodes when its key is absent, so a persisted snapshot
 * keeps decoding after a field is added. Built from `Config` only (no stream is consulted), so it is safe inside a
 * stdio MCP server.
 *
 * @public
 */
export class RuntimeEnv extends Schema.Class<RuntimeEnv>("@effected/env/RuntimeEnv")({
	/**
	 * The AI agent running the process, as its family (`claude` for Claude Code, whatever `AI_AGENT` says it is
	 * beyond that), or `None`.
	 */
	agent: optionField(Schema.String),
	/** The CI the process runs in: {@link CiName}, so a consumer can match it exhaustively, or `None`. */
	ci: optionField(Schema.Literals(ciNames)),
	/** The identified terminal program and its version when it exposes one, or `None`. */
	terminal: optionField(Schema.Struct({ name: Schema.String, version: optionField(Schema.String) })),
	/** The terminal or multiplexer session: see {@link TerminalSession}. Defaults to `None` in `make`. */
	session: addedOptionField(
		Schema.Struct({
			source: Schema.Literals(["tmux", "screen", "windows-terminal", "wezterm", "kitty", "term-session"]),
			variable: Schema.String,
			id: Schema.String,
			multiplexer: optionField(Schema.Struct({ name: Schema.Literals(["tmux", "screen"]), value: Schema.String })),
		}),
	),
	/** The coordinates of the CI run: see {@link CiRun}. Defaults to `None` in `make`. */
	ciRun: addedOptionField(
		Schema.Struct({
			runId: optionField(Schema.String),
			attempt: optionField(Schema.String),
			jobId: optionField(Schema.String),
			sha: optionField(Schema.String),
			refName: optionField(Schema.String),
			runner: optionField(Schema.Struct({ os: Schema.String, arch: optionField(Schema.String) })),
		}),
	),
	/**
	 * The raw `TERM_PROGRAM` pair: see {@link TermProgram}. Both halves default to `None`, when the key is absent on
	 * decode and in `make`.
	 */
	termProgram: Schema.Struct({ name: optionField(Schema.String), version: optionField(Schema.String) }).pipe(
		Schema.withDecodingDefaultTypeKey(Effect.succeed({ name: Option.none(), version: Option.none() })),
		Schema.withConstructorDefault(Effect.succeed({ name: Option.none(), version: Option.none() })),
	),
}) {
	/**
	 * The snapshot of an environment record, as a pure function: no `Config`, no `process`, no service.
	 *
	 * @remarks
	 * It is what {@link CurrentRuntimeEnv.layer} computes from the variables it reads, so the two agree on the same
	 * record. An `undefined` or empty value reads as unset, under every caller. Use it where a service is in the
	 * way: a long-lived host that holds its own environment record, or a renderer with no Effect context.
	 *
	 * @param env - variable name to value
	 */
	static fromRecord(env: Readonly<Record<string, string | undefined>>): RuntimeEnv {
		const clean = normalizeEnv(env);
		return RuntimeEnv.make({
			agent: detectAgent(clean),
			ci: detectCi(clean),
			terminal: detectOsc8(clean, false, false).terminal,
			session: detectSession(clean),
			ciRun: detectCiRun(clean),
			termProgram: detectTermProgram(clean),
		});
	}
}

/**
 * The fields {@link CurrentRuntimeEnv.layerTest} can override.
 *
 * @public
 */
export interface RuntimeEnvOverrides {
	/** Replaces the detected agent. */
	readonly agent?: Option.Option<string>;
	/** Replaces the detected CI. */
	readonly ci?: Option.Option<CiName>;
	/** Replaces the detected terminal. */
	readonly terminal?: Option.Option<{ readonly name: string; readonly version: Option.Option<string> }>;
	/** Replaces the detected session. */
	readonly session?: Option.Option<TerminalSession>;
	/** Replaces the detected CI run coordinates. Independent of `ci`: set both for a consistent snapshot. */
	readonly ciRun?: Option.Option<CiRun>;
	/** Replaces the raw `TERM_PROGRAM` pair. */
	readonly termProgram?: TermProgram;
}

/**
 * The {@link RuntimeEnv} of the running process, as a service.
 *
 * @remarks
 * The service's whole shape is one immutable value, so it is provided with `Layer.succeed` rather than mocked.
 * `layer` reads the ambient `ConfigProvider` once when it is built; `layerTest` is the only way a test changes the
 * environment.
 *
 * @example
 * ```ts
 * import { CurrentRuntimeEnv } from "@effected/env"
 * import { Effect, Option } from "effect"
 *
 * const program = Effect.gen(function* () {
 * 	const env = yield* CurrentRuntimeEnv
 * 	return Option.getOrElse(env.agent, () => "no agent")
 * }).pipe(Effect.provide(CurrentRuntimeEnv.layerTest({ agent: Option.some("claude") })))
 * ```
 *
 * @public
 */
export class CurrentRuntimeEnv extends Context.Service<CurrentRuntimeEnv, RuntimeEnv>()(
	"@effected/env/CurrentRuntimeEnv",
) {
	/**
	 * Reads the environment through `Config` once, when the layer is built. Requires nothing: the provider is read
	 * from the ambient `ConfigProvider`.
	 *
	 * @remarks
	 * Two things make this a frozen read, and a long-lived host (an MCP server, a watch-mode runner) trips on both.
	 * Core's default `ConfigProvider.fromEnv()` snapshots `process.env` once per process, so a change after the
	 * first read is never seen; and this is one static layer, memoized by reference, so two consumers that provide
	 * different providers in one graph share the first snapshot. Use {@link CurrentRuntimeEnv.layerFrom}, which is
	 * a fresh layer per call and per use, or provide a fresh `ConfigProvider` for every read.
	 */
	static readonly layer: Layer.Layer<CurrentRuntimeEnv> = Layer.effect(
		this,
		Effect.map(readEnv(allKeys), (env) => RuntimeEnv.fromRecord(env)),
	);

	/**
	 * A snapshot of an explicit source: an environment record, or a `ConfigProvider` read instead of the ambient
	 * one.
	 *
	 * @remarks
	 * Each call returns a new layer, and the layer is `Layer.fresh`, so it is built again for every use rather
	 * than shared through the build's memo: two calls with different sources in one graph see different values,
	 * and a provider is read again each time the layer is used. A record is read when the layer is built, never
	 * at the call.
	 *
	 * @param source - a variable-name-to-value record, or a `ConfigProvider`
	 */
	static readonly layerFrom = (
		source: Readonly<Record<string, string | undefined>> | ConfigProvider.ConfigProvider,
	): Layer.Layer<CurrentRuntimeEnv> =>
		Layer.fresh(
			Layer.effect(
				CurrentRuntimeEnv,
				// A record's values are strings, so a function-valued `load` identifies a provider.
				typeof source.load === "function"
					? Effect.map(
							readEnv(allKeys).pipe(
								Effect.provideService(ConfigProvider.ConfigProvider, source as ConfigProvider.ConfigProvider),
							),
							(env) => RuntimeEnv.fromRecord(env),
						)
					: Effect.sync(() => RuntimeEnv.fromRecord(source as Readonly<Record<string, string | undefined>>)),
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
			RuntimeEnv.make({
				agent: overrides.agent ?? Option.none(),
				ci: overrides.ci ?? Option.none(),
				terminal: overrides.terminal ?? Option.none(),
				session: overrides.session ?? Option.none(),
				ciRun: overrides.ciRun ?? Option.none(),
				termProgram: overrides.termProgram ?? { name: Option.none(), version: Option.none() },
			}),
		);
}
