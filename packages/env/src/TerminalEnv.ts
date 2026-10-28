import type { Stdio as StdioModule, Terminal as TerminalModule } from "effect";
import { Context, Effect, Layer, Option, Stdio, Terminal } from "effect";
import type { TerminalCapabilities } from "effect/cli";
import type { ColorLevel } from "./ColorLevel.js";
import { colorDepth, colorKeys } from "./internal/colorDepth.js";
import { normalizeEnv, readEnv } from "./internal/envRecord.js";
import { terminalEnvKeys } from "./internal/keys.js";
import { detectOsc8 } from "./internal/osc8/detect.js";

/**
 * What one output stream can do.
 *
 * @public
 */
export interface StreamEnv {
	/** Whether the stream is attached to a terminal. */
	readonly isTerminal: boolean;
	/** The colour level: `none` unless the stream is a terminal or `FORCE_COLOR` says otherwise. */
	readonly color: ColorLevel;
	/**
	 * Whether the terminal can render OSC 8 hyperlinks on this stream.
	 *
	 * @remarks
	 * Decided in this order: a truthy `FORCE_HYPERLINK` turns links on, even on a stream that is not a terminal; a
	 * truthy `NO_HYPERLINK` or a non-empty `NO_COLOR` turns them off; then the stream must be a terminal, not inside a
	 * multiplexer that strips them (tmux, GNU screen), and a known terminal at a version that renders them.
	 *
	 * This is terminal capability only and does not consider the audience. Turning links off for an agent audience
	 * is applied by `@effected/cli`, where the audience is known.
	 */
	readonly hyperlinks: boolean;
	/**
	 * The terminal width in columns, or `None` when it is unknown.
	 *
	 * @remarks
	 * Core's `Terminal` exposes one width, so `stderr.columns` reports stdout's width.
	 */
	readonly columns: Option.Option<number>;
}

/**
 * The options {@link TerminalEnv.layer} takes.
 *
 * @public
 */
export interface TerminalEnvOptions {
	/**
	 * Overrides the stderr terminal check; omitted, `Stdio.stderrIsTerminal` answers.
	 *
	 * @remarks
	 * The platform `Stdio` layers answer from the host (`process.stderr.isTTY` on Node), and a `Stdio` built with
	 * `Stdio.make` without the field answers `false`. Pass this only for a host whose `Stdio` cannot say.
	 */
	readonly stderrIsTerminal?: Effect.Effect<boolean>;
}

/**
 * The options {@link TerminalEnv.layerTest} takes: fields to set over the quiet terminal.
 *
 * @public
 */
export interface TerminalEnvTestOptions {
	/** Whether standard input is a terminal. */
	readonly stdinIsTerminal?: boolean;
	/** Fields merged over the quiet stdout. */
	readonly stdout?: Partial<StreamEnv>;
	/** Fields merged over the quiet stderr. */
	readonly stderr?: Partial<StreamEnv>;
}

/**
 * The shape of the {@link TerminalEnv} service: a snapshot taken when the layer is built, not a live view.
 *
 * @public
 */
export interface TerminalEnvShape {
	/** Whether standard input is attached to a terminal. */
	readonly stdinIsTerminal: boolean;
	/** The capabilities of standard output. */
	readonly stdout: StreamEnv;
	/** The capabilities of standard error; its `columns` is stdout's width, since core's `Terminal` has one. */
	readonly stderr: StreamEnv;
	/**
	 * The width to lay output out at: the stdout columns, else the `COLUMNS` variable, else `fallback`.
	 *
	 * @param fallback - the width when nothing else is known; defaults to 80
	 */
	readonly width: (fallback?: number) => number;
}

const make = (
	env: Readonly<Record<string, string | undefined>>,
	isTTY: { readonly stdin: boolean; readonly stdout: boolean; readonly stderr: boolean },
	columns: Option.Option<number>,
): TerminalEnvShape => {
	const links = detectOsc8(env, isTTY.stdout, isTTY.stderr);
	// COLUMNS counts only as a positive integer: "-5", "0", "100abc" and "abc" all fall through to the fallback.
	const fromEnv = /^\d+$/.test(env.COLUMNS ?? "") ? Number(env.COLUMNS) : 0;
	return {
		stdinIsTerminal: isTTY.stdin,
		stdout: { isTerminal: isTTY.stdout, color: colorDepth(env, isTTY.stdout), hyperlinks: links.stdout, columns },
		stderr: { isTerminal: isTTY.stderr, color: colorDepth(env, isTTY.stderr), hyperlinks: links.stderr, columns },
		width: (fallback = 80) => Option.getOrElse(columns, () => fromEnv || fallback),
	};
};

/** Read the TTY facts from `Stdio` and the environment from `Config`, with the width the caller already knows. */
const snapshot = (
	options: TerminalEnvOptions | undefined,
	columns: Option.Option<number>,
): Effect.Effect<TerminalEnvShape, never, StdioModule.Stdio> =>
	Effect.gen(function* () {
		const stdio = yield* Stdio.Stdio;
		const stdin = yield* stdio.stdinIsTerminal;
		const stdout = yield* stdio.stdoutIsTerminal;
		const stderr = yield* options?.stderrIsTerminal ?? stdio.stderrIsTerminal;
		const env = yield* readEnv(terminalEnvKeys);
		return make(env, { stdin, stdout, stderr }, columns);
	});

/** The quiet terminal {@link TerminalEnv.layerTest} starts from: not a terminal, no colour, no links, no width. */
const quiet: StreamEnv = { isTerminal: false, color: "none", hyperlinks: false, columns: Option.none() };

/**
 * What the terminal can do: per-stream colour level, hyperlink support and columns, and the width to lay out at.
 *
 * @remarks
 * `layer` reads the environment through `Config` and the TTY state through `Stdio` and `Terminal` once, when it
 * is built. `layerTest` is the only way a test changes it, and defaults to a quiet terminal so a test opts into
 * colour. `colorLevel` needs `Stdio` alone, so a caller that only decides colour never requires `Terminal`.
 *
 * @example
 * ```ts
 * import { TerminalEnv } from "@effected/env"
 * import { Effect, Option } from "effect"
 *
 * const program = Effect.gen(function* () {
 * 	const terminal = yield* TerminalEnv
 * 	return { color: terminal.stdout.color, width: terminal.width() }
 * }).pipe(Effect.provide(TerminalEnv.layerTest({ stdout: { color: "256", columns: Option.some(100) } })))
 * ```
 *
 * @public
 */
export class TerminalEnv extends Context.Service<TerminalEnv, TerminalEnvShape>()("@effected/env/TerminalEnv") {
	/**
	 * Build the snapshot from `Stdio`, `Terminal` and the ambient `ConfigProvider`.
	 *
	 * @remarks
	 * Every stream's terminal check comes from `Stdio`; `options.stderrIsTerminal` replaces stderr's alone.
	 * A layer-returning function mints a fresh layer per call: call it once and bind the result to a constant.
	 *
	 * @param options - `stderrIsTerminal` overrides the stderr TTY check
	 */
	static layer(
		options?: TerminalEnvOptions,
	): Layer.Layer<TerminalEnv, never, StdioModule.Stdio | TerminalModule.Terminal> {
		return Layer.effect(
			TerminalEnv,
			Effect.gen(function* () {
				const terminal = yield* Terminal.Terminal;
				const width = yield* terminal.columns;
				return yield* snapshot(options, width > 0 ? Option.some(width) : Option.none());
			}),
		);
	}

	/**
	 * The snapshot from `Stdio` and the ambient `ConfigProvider` alone: it never requires or builds `Terminal`, and
	 * reports no columns.
	 *
	 * @remarks
	 * Everything else is what {@link TerminalEnv.layer} reports: the TTY facts come from `Stdio`, the colour and
	 * hyperlink decisions from the environment, and `width()` falls back to `COLUMNS`, then the fallback, since no
	 * terminal width is known. Use it where building the platform `Terminal` has a cost, for example a long-lived
	 * host, where `NodeTerminal` listens on `process.stdin`. A layer-returning function mints a fresh layer per
	 * call: call it once and bind the result to a constant.
	 *
	 * @param options - `stderrIsTerminal` overrides the stderr TTY check
	 */
	static layerStdio(options?: TerminalEnvOptions): Layer.Layer<TerminalEnv, never, StdioModule.Stdio> {
		return Layer.effect(TerminalEnv, snapshot(options, Option.none()));
	}

	/**
	 * A fixed snapshot that touches neither `Stdio`, `Terminal` nor `Config`. Everything is quiet unless a field of
	 * `partial` sets it.
	 *
	 * @param partial - the fields to set; `stdout` and `stderr` are merged over the quiet stream
	 */
	static readonly layerTest = (partial?: TerminalEnvTestOptions): Layer.Layer<TerminalEnv> => {
		const stdout: StreamEnv = { ...quiet, ...partial?.stdout };
		return Layer.succeed(TerminalEnv, {
			stdinIsTerminal: partial?.stdinIsTerminal ?? false,
			stdout,
			stderr: { ...quiet, ...partial?.stderr },
			width: (fallback = 80) => Option.getOrElse(stdout.columns, () => fallback),
		});
	};

	/**
	 * The colour level of a stream, as a pure function of an environment record and whether the stream is a terminal:
	 * no `Config`, no `Stdio`, no service.
	 *
	 * @remarks
	 * It is the rule {@link TerminalEnv.layer} applies to each stream, so the two agree on the same record. A
	 * `FORCE_COLOR` that is present decides alone and beats `NO_COLOR` (`1` or `true` is `basic`, `2` is `256`, `3` is
	 * `truecolor`, anything else is `none`); otherwise a stream that is not a terminal has none, and a terminal is
	 * decided by `NODE_DISABLE_COLORS`, `NO_COLOR`, `TERM=dumb` and the terminal table. An `undefined` or empty value
	 * reads as unset, as the layer reads it. Use it where a service is in the way: synchronous code that decides
	 * whether to colour a log, with the TTY fact it already holds.
	 *
	 * @example
	 * ```ts
	 * import { TerminalEnv } from "@effected/env"
	 *
	 * const level = TerminalEnv.colorLevelFrom({ TERM: "xterm-256color" }, true) // "256"
	 * ```
	 *
	 * @param env - variable name to value
	 * @param isTTY - whether the stream is attached to a terminal
	 */
	static colorLevelFrom(env: Readonly<Record<string, string | undefined>>, isTTY: boolean): ColorLevel {
		return colorDepth(normalizeEnv(env), isTTY);
	}

	/**
	 * Core's `TerminalCapabilities` value for a terminal snapshot, as a pure function.
	 *
	 * @remarks
	 * `canColor` is stdout's colour level under the kit's rule (see {@link TerminalEnv.colorLevelFrom}): it is not
	 * `none`. That rule differs from core's own detection in two places: a present `FORCE_COLOR` beats `NO_COLOR`, as in
	 * Node, and the terminal table can answer `none` for a terminal it does not know. `canAnimate` is stdout being a
	 * terminal, and `canPrompt` is stdin and stdout both being terminals. A `TERM` of `dumb` clears both, as it does in
	 * core: a terminal that cannot move the cursor can neither redraw a frame nor a prompt. It leaves `canColor` to the
	 * colour rule, where a `FORCE_COLOR` still wins.
	 *
	 * The snapshot does not carry `TERM`, so it is passed alongside. This package installs no layer for core's
	 * reference: `effect/cli` exports it only through its barrel, and a value import here would load that barrel for
	 * every consumer of this package. `@effected/cli`'s `CliEnv.layer` installs it, reading `TERM` through `Config`.
	 *
	 * @param terminal - the terminal snapshot
	 * @param term - the value of `TERM`, or `undefined` when it is unset
	 */
	static capabilities(
		terminal: TerminalEnvShape,
		term?: string | undefined,
	): TerminalCapabilities.TerminalCapabilities {
		const cursor = term !== "dumb";
		return {
			canColor: terminal.stdout.color !== "none",
			canAnimate: cursor && terminal.stdout.isTerminal,
			canPrompt: cursor && terminal.stdinIsTerminal && terminal.stdout.isTerminal,
		};
	}

	/**
	 * The colour level of a stream.
	 *
	 * @remarks
	 * An ambient `TerminalEnv`, when one is provided, answers with its stdout colour, so a test that fixes the
	 * terminal with `layerTest` also fixes this. Without one it is decided from `Config` and `Stdio` alone. It
	 * requires only `Stdio`, never `Terminal` or `TerminalEnv`, so a caller that only decides colour (a CLI's
	 * output formatter) keeps a `Stdio`-only requirement.
	 *
	 * @param _stream - the stream to decide for; only `stdout` is offered, the stream an output formatter paints
	 */
	static colorLevel(_stream: "stdout"): Effect.Effect<ColorLevel, never, StdioModule.Stdio> {
		return Effect.gen(function* () {
			const ambient = yield* Effect.serviceOption(TerminalEnv);
			if (Option.isSome(ambient)) return ambient.value.stdout.color;
			const stdio = yield* Stdio.Stdio;
			const isTTY = yield* stdio.stdoutIsTerminal;
			return colorDepth(yield* readEnv(colorKeys), isTTY);
		});
	}
}
