import type { Stdio as StdioModule, Terminal as TerminalModule } from "effect";
import { Context, Effect, Layer, Option, Stdio, Terminal } from "effect";
import type { ColorLevel } from "./ColorLevel.js";
import { colorDepth, colorKeys } from "./internal/colorDepth.js";
import { readEnv } from "./internal/envRecord.js";
import { allKeys } from "./internal/keys.js";
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
	 * Whether the terminal can render OSC 8 hyperlinks on this stream: a hyperlink-capable terminal, and the stream
	 * is a terminal.
	 *
	 * @remarks
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
	/** Overrides the stderr TTY check; `Stdio` reports only stdout, so stderr mirrors stdout when this is omitted. */
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

/** The quiet terminal {@link TerminalEnv.layerTest} starts from: not a terminal, no colour, no links, no width. */
const quiet: StreamEnv = { isTerminal: false, color: "none", hyperlinks: false, columns: Option.none() };

/**
 * What the terminal can do: per-stream colour level, hyperlink support and columns, and the width to lay out at.
 *
 * @remarks
 * `layer` reads the environment through `Config` and the TTY state through `Stdio` and `Terminal` once, when it
 * is built. `layerTest` is the only way a test changes it, and defaults to a quiet terminal so a test opts into
 * colour. `colorLevel` needs `Stdio` alone, so a caller that only decides colour never requires `Terminal`. See
 * `okf/modules/env.md`.
 *
 * @public
 */
export class TerminalEnv extends Context.Service<TerminalEnv, TerminalEnvShape>()("@effected/env/TerminalEnv") {
	/**
	 * Build the snapshot from `Stdio`, `Terminal` and the ambient `ConfigProvider`.
	 *
	 * @remarks
	 * `Stdio` reports only stdout, so stderr mirrors it unless `options.stderrIsTerminal` supplies its own answer.
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
				const stdio = yield* Stdio.Stdio;
				const terminal = yield* Terminal.Terminal;
				const stdin = yield* stdio.stdinIsTerminal;
				const stdout = yield* stdio.stdoutIsTerminal;
				const stderr = yield* options?.stderrIsTerminal ?? Effect.succeed(stdout);
				const env = yield* readEnv([...allKeys, "COLUMNS"]);
				const width = yield* terminal.columns;
				return make(env, { stdin, stdout, stderr }, width > 0 ? Option.some(width) : Option.none());
			}),
		);
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
	 * The colour level of a stream.
	 *
	 * @remarks
	 * An ambient `TerminalEnv`, when one is provided, answers with its stdout colour, so a test that fixes the
	 * terminal with `layerTest` also fixes this. Without one it is decided from `Config` and `Stdio` alone. It
	 * requires only `Stdio`, never `Terminal` or `TerminalEnv`, so a caller that only decides colour (a CLI's
	 * output formatter) keeps a `Stdio`-only requirement.
	 *
	 * @param _stream - the stream to decide for; only `stdout` is available, since `Stdio` reports no other
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
