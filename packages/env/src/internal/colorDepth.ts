// Port of Node v26.10.0 lib/internal/tty.js getColorDepth (MIT). Differences: no win32 branch (no
// process.platform read), no warning side effect, TTY gate applied here.
import type { Env } from "./types.js";

/**
 * The colour support of one output stream: none, 16 colours, 256 colours or truecolor.
 *
 * @public
 */
export type ColorLevel = "none" | "basic" | "256" | "truecolor";

// Some entries were taken from `dircolors`. The corresponding terminals might
// support more than 16 colours, but this was not tested for.
const TERM_ENVS: ReadonlyMap<string, ColorLevel> = new Map<string, ColorLevel>([
	["eterm", "basic"],
	["cons25", "basic"],
	["console", "basic"],
	["cygwin", "basic"],
	["dtterm", "basic"],
	["gnome", "basic"],
	["hurd", "basic"],
	["jfbterm", "basic"],
	["konsole", "basic"],
	["kterm", "basic"],
	["mlterm", "basic"],
	["mosh", "truecolor"],
	["putty", "basic"],
	["st", "basic"],
	["rxvt-unicode-24bit", "truecolor"],
	["terminator", "truecolor"],
	["xterm-kitty", "truecolor"],
]);

// Iteration order is the precedence order, as in Node.
const CI_ENVS: ReadonlyArray<readonly [string, ColorLevel]> = [
	["APPVEYOR", "256"],
	["BUILDKITE", "256"],
	["CIRCLECI", "truecolor"],
	["DRONE", "256"],
	["GITEA_ACTIONS", "truecolor"],
	["GITHUB_ACTIONS", "truecolor"],
	["GITLAB_CI", "256"],
	["TRAVIS", "256"],
];

const TERM_ENVS_REG_EXP: ReadonlyArray<RegExp> = [
	/ansi/,
	/color/,
	/linux/,
	/direct/,
	/^con[0-9]*x[0-9]/,
	/^rxvt/,
	/^screen/,
	/^xterm/,
	/^vt100/,
	/^vt220/,
];

const isSet = (value: string | undefined): boolean => value !== undefined && value !== "";

/** The table: Node's getColorDepth with the FORCE_COLOR branch, win32 branch and warning removed. */
const fromTable = (env: Env): ColorLevel => {
	if (isSet(env.NODE_DISABLE_COLORS) || isSet(env.NO_COLOR) || env.TERM === "dumb") return "none";

	if (env.TMUX) return "truecolor";

	// Azure DevOps
	if (env.TF_BUILD !== undefined && env.AGENT_NAME !== undefined) return "basic";

	if (env.CI !== undefined) {
		for (const [name, level] of CI_ENVS) {
			if (env[name] !== undefined) return level;
		}
		if (env.CI_NAME === "codeship") return "256";
		return "none";
	}

	if (env.TEAMCITY_VERSION !== undefined) {
		return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? "basic" : "none";
	}

	switch (env.TERM_PROGRAM) {
		case "iTerm.app":
			if (!env.TERM_PROGRAM_VERSION || /^[0-2]\./.test(env.TERM_PROGRAM_VERSION)) return "256";
			return "truecolor";
		case "HyperTerm":
		case "MacTerm":
			return "truecolor";
		case "Apple_Terminal":
			return "256";
	}

	if (env.COLORTERM === "truecolor" || env.COLORTERM === "24bit") return "truecolor";

	if (env.TERM) {
		if (/truecolor/.test(env.TERM)) return "truecolor";
		if (/^xterm-256/.test(env.TERM)) return "256";

		const term = env.TERM.toLowerCase();
		// A Map lookup, so a TERM such as "constructor" cannot reach Object.prototype.
		const known = TERM_ENVS.get(term);
		if (known !== undefined) return known;
		if (TERM_ENVS_REG_EXP.some((re) => re.test(term))) return "basic";
	}
	// Move 16 colour COLORTERM below 16m and 256
	if (env.COLORTERM) return "basic";
	return "none";
};

/**
 * The colour level of one stream. `FORCE_COLOR`, when present, decides alone (it beats `NO_COLOR`, as in
 * Node); otherwise a stream that is not a TTY has none; otherwise the terminal table decides.
 *
 * @internal
 */
export const colorDepth = (env: Env, isTTY: boolean): ColorLevel => {
	if (env.FORCE_COLOR !== undefined) {
		switch (env.FORCE_COLOR) {
			case "":
			case "1":
			case "true":
				return "basic";
			case "2":
				return "256";
			case "3":
				return "truecolor";
			default:
				return "none";
		}
	}
	if (!isTTY) return "none";
	return fromTable(env);
};

/**
 * Every environment variable name {@link colorDepth} reads, including the CI provider table.
 *
 * @internal
 */
export const colorKeys: ReadonlyArray<string> = [
	"FORCE_COLOR",
	"NO_COLOR",
	"NODE_DISABLE_COLORS",
	"TERM",
	"TMUX",
	"TF_BUILD",
	"AGENT_NAME",
	"CI",
	"CI_NAME",
	"TEAMCITY_VERSION",
	"TERM_PROGRAM",
	"TERM_PROGRAM_VERSION",
	"COLORTERM",
	...CI_ENVS.map(([name]) => name),
];
