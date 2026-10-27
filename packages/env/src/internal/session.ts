// Terminal / multiplexer session identity and the raw TERM_PROGRAM pair, from a pure env record.
import { Option } from "effect";
import type { Env } from "./types.js";

/**
 * The session sources, in priority order, each with the one variable that carries its id. A multiplexer comes first:
 * its pane outlives the terminal window it is attached to.
 *
 * @internal
 */
export const SESSION_RULES = [
	["tmux", "TMUX_PANE"],
	["screen", "STY"],
	["windows-terminal", "WT_SESSION"],
	["wezterm", "WEZTERM_PANE"],
	["kitty", "KITTY_WINDOW_ID"],
	["term-session", "TERM_SESSION_ID"],
] as const;

/**
 * The multiplexer the process runs inside, with its variable's raw value: `TMUX` (socket path, server pid and session
 * index, unparsed) before `STY`.
 *
 * @internal
 */
export const detectMultiplexer = (
	env: Env,
): Option.Option<{ readonly name: "tmux" | "screen"; readonly value: string }> => {
	if (env.TMUX !== undefined) return Option.some({ name: "tmux", value: env.TMUX });
	if (env.STY !== undefined) return Option.some({ name: "screen", value: env.STY });
	return Option.none();
};

/**
 * The first session source in {@link SESSION_RULES} whose variable is set, with the variable's name and raw value.
 *
 * @internal
 */
export const detectSession = (env: Env) => {
	for (const [source, variable] of SESSION_RULES) {
		const id = env[variable];
		if (id !== undefined) return Option.some({ source, variable, id, multiplexer: detectMultiplexer(env) });
	}
	return Option.none();
};

/** No `TERM_PROGRAM` pair: both halves unset. */
export const noTermProgram = { name: Option.none<string>(), version: Option.none<string>() };

/**
 * `TERM_PROGRAM` and `TERM_PROGRAM_VERSION`, verbatim and independent of each other.
 *
 * @internal
 */
export const detectTermProgram = (env: Env): typeof noTermProgram => ({
	name: Option.fromNullishOr(env.TERM_PROGRAM),
	version: Option.fromNullishOr(env.TERM_PROGRAM_VERSION),
});

/**
 * Every environment variable name the session and term-program detectors read.
 *
 * @internal
 */
export const sessionKeys: ReadonlyArray<string> = [
	...SESSION_RULES.map(([, variable]) => variable),
	"TMUX",
	"TERM_PROGRAM",
	"TERM_PROGRAM_VERSION",
];
