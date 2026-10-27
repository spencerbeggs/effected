import { Option } from "effect";

/**
 * The parameter shape {@link LaunchContext.resolve} takes: the process-derived
 * facts a front end resolves once, passed in as values.
 *
 * @remarks
 * Nothing here reads `process`: `argv` and `env` come from the front end's own
 * `main.ts`. That keeps the resolution rule shared and testable while the
 * process read stays at the one place allowed to make it.
 *
 * @public
 */
export interface ResolveInput {
	/**
	 * Positional candidates, checked in order. Pass positional arguments only —
	 * the parsed positionals of your command, never raw `process.argv.slice(2)`:
	 * every non-empty value counts as a candidate, so a `--flag` would become the
	 * project directory.
	 */
	readonly argv?: ReadonlyArray<string> | undefined;
	/** The environment, usually `process.env`. */
	readonly env: Readonly<Record<string, string | undefined>>;
	/** Env keys to try in order, for example `["OKFIT_PROJECT_DIR", "CLAUDE_PROJECT_DIR"]`. */
	readonly keys: ReadonlyArray<string>;
}

/**
 * The parameter shape {@link LaunchContext.projectDir} takes: {@link ResolveInput}
 * plus the `cwd` fallback.
 *
 * @public
 */
export interface ProjectDirInput extends ResolveInput {
	/** The fallback, usually `process.cwd()`. */
	readonly cwd: string;
}

/**
 * Resolves where a tool launched by an agent host should treat as its project.
 *
 * @example
 * ```ts
 * import { LaunchContext } from "@effected/engine"
 *
 * const dir = LaunchContext.projectDir({
 * 	argv: [],
 * 	env: { CLAUDE_PROJECT_DIR: "/work/app" },
 * 	keys: ["MYTOOL_PROJECT_DIR", "CLAUDE_PROJECT_DIR"],
 * 	cwd: "/home/me",
 * })
 * // => "/work/app"
 * ```
 *
 * @public
 */
export class LaunchContext {
	private constructor() {}

	/**
	 * Whether a value still carries a literal `${VAR}` placeholder.
	 *
	 * @remarks
	 * An agent host can pass `${CLAUDE_PROJECT_DIR}` through unsubstituted in
	 * some launch paths; a path containing a placeholder is never what was meant.
	 */
	static readonly isUnsubstituted = (value: string): boolean => {
		// A `${` with any `}` after it. The first `${` has the most text after it,
		// so it alone decides; two scans keep this linear, where the equivalent
		// unanchored regex rescans from every `${` and goes quadratic.
		const open = value.indexOf("${");
		return open !== -1 && value.indexOf("}", open + 2) !== -1;
	};

	/**
	 * `value` trimmed, when it names something: `Option.none()` for `undefined`,
	 * an empty or whitespace-only string, or a string still carrying a literal
	 * `${VAR}` placeholder ({@link LaunchContext.isUnsubstituted}).
	 *
	 * @remarks
	 * The guard every resolver here applies; use it directly for one positional
	 * argument, as in `LaunchContext.usable(argv[2])`. `??` would accept an empty
	 * string or a literal `${VAR}`, neither of which names a directory or an id.
	 */
	static readonly usable = (value: string | undefined): Option.Option<string> => {
		if (value === undefined) return Option.none();
		const trimmed = value.trim();
		return trimmed === "" || LaunchContext.isUnsubstituted(trimmed) ? Option.none() : Option.some(trimmed);
	};

	/**
	 * The first {@link LaunchContext.usable} `argv` value, then the first usable
	 * `env` value in `keys` order; `Option.none()` when none is usable.
	 *
	 * @remarks
	 * The resolver under {@link LaunchContext.projectDir}, without its `cwd`
	 * fallback, for any launch-supplied location: a host's plugin data
	 * directory, then an app override, with the caller's own fallback after
	 * it. Values are trimmed, so a value with surrounding whitespace resolves to
	 * the trimmed path.
	 *
	 * @example
	 * ```ts
	 * import { LaunchContext } from "@effected/engine"
	 * import { Option } from "effect"
	 *
	 * const dataDir = LaunchContext.resolve({ env, keys: ["CLAUDE_PLUGIN_DATA", "MYTOOL_DATA_DIR"] }).pipe(
	 * 	Option.getOrElse(() => `${home}/.mytool`),
	 * )
	 * ```
	 */
	static readonly resolve = (input: ResolveInput): Option.Option<string> => {
		for (const value of input.argv ?? []) {
			const found = LaunchContext.usable(value);
			if (Option.isSome(found)) return found;
		}
		for (const key of input.keys) {
			const found = LaunchContext.usable(input.env[key]);
			if (Option.isSome(found)) return found;
		}
		return Option.none();
	};

	/**
	 * The first usable argv value, then the first usable env value in `keys`
	 * order, then `cwd`: {@link LaunchContext.resolve} with `cwd` as the
	 * fallback.
	 */
	static readonly projectDir = (input: ProjectDirInput): string =>
		Option.getOrElse(LaunchContext.resolve(input), () => input.cwd);
}
