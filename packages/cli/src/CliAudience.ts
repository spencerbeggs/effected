import type { AudienceKind, AudienceShape } from "@effected/env";
import { Audience } from "@effected/env";
import type { Terminal } from "effect";
import { Effect, Stdio } from "effect";
import type { Command } from "effect/cli";
import { CliConfig, CliError, Command as CommandModule, Flag, GlobalFlag } from "effect/cli";
import { CliInteractive } from "./CliInteractive.js";
import { scanAudience, tallyAudience } from "./internal/scanAudience.js";

const KINDS: ReadonlyArray<AudienceKind> = ["human", "agent", "ci"];

/**
 * The four parsed audience flags a root command carries once {@link CliAudience.flags} is shared onto it.
 *
 * @public
 */
export interface AudienceFlagInput {
	/** Every `--audience <kind>` occurrence. */
	readonly audience: ReadonlyArray<AudienceKind>;
	/** Every `--human` occurrence. */
	readonly human: ReadonlyArray<boolean>;
	/** Every `--agent` occurrence. */
	readonly agent: ReadonlyArray<boolean>;
	/** Every `--ci` occurrence. */
	readonly ci: ReadonlyArray<boolean>;
}

/**
 * Options for {@link CliAudience.flags}.
 *
 * @public
 */
export interface CliAudienceFlagsOptions {
	/**
	 * Hide all four flags from every help screen. They still parse and resolve; describe them in the root
	 * command's description instead.
	 */
	readonly hidden?: boolean | undefined;
}

/**
 * Resolves to nothing for a command that carries the four audience flags, and to an unsatisfiable marker otherwise,
 * so `CliAudience.run` on a root that forgot `Command.withSharedFlags(CliAudience.flags())` does not compile. (A
 * plain `Input extends AudienceFlagInput` constraint does not do this: `Command` is contravariant in its input, so
 * a command with no flags still type-checks against it.)
 *
 * @public
 */
export type RequiresAudienceFlags<Input> = [Input] extends [AudienceFlagInput]
	? unknown
	: { readonly "missing shared flags": "pipe the root through Command.withSharedFlags(CliAudience.flags())" };

const CONFLICT = "Give at most one of --audience, --human, --agent, --ci (once).";

/** Resolve the four flags into the audience to provide, failing when more than one occurrence was given. */
const resolve = (input: AudienceFlagInput): Effect.Effect<AudienceShape, CliError.UserError, Audience> => {
	// The counting rule is shared with `scanAudience`, which reads argv before parsing, so the two cannot drift.
	const { given: named, conflict } = tallyAudience(input);
	if (conflict) {
		return Effect.fail(new CliError.UserError({ cause: new Error(CONFLICT), userMessage: CONFLICT }));
	}
	const [kind] = named;
	// No flag: the ambient audience, the override variable or detection, is read and provided back unchanged.
	return kind === undefined ? Audience : Effect.succeed({ kind, source: "flag" });
};

/**
 * The audience flags of a CLI: `--audience <human|agent|ci>` and the shorthands `--human`, `--agent`, `--ci`,
 * resolved into `@effected/env`'s `Audience`.
 *
 * @remarks
 * The one wiring: share the flags on the root command and hand the root to {@link CliAudience.run} (or
 * {@link CliAudience.runWith}), which resolves the flags from argv before core parses and applies
 * {@link CliAudience.provide} itself:
 *
 * ```ts
 * const root = Command.make("tool").pipe(
 *   Command.withSharedFlags(CliAudience.flags()),
 *   Command.withSubcommands([verify]),
 * )
 * NodeRuntime.runMain(
 *   CliRuntime.main(CliAudience.run(root, { version }), { platform: NodeServices.layer, env: {} }),
 * )
 * ```
 *
 * A root that forgot `Command.withSharedFlags(CliAudience.flags())` does not compile. Giving more than one
 * occurrence across the four flags is a usage error even when they agree; a boolean set to false (`--no-agent`,
 * `--agent=false`) counts as not given. A bad `--audience` value is core's own parse error. Both exit `64` under
 * `CliRuntime.main`. A conflicting audience together with `--help` exits `0` and prints help, because core handles
 * its action flags before the resolver runs.
 *
 * A non-human flag (`--agent`, `--ci`, `--audience agent|ci`) also turns `CliInteractive` off, drops `--wizard`,
 * and switches diagnostics to NDJSON, for the whole run including the parse step where a fallback prompt fires.
 * {@link CliAudience.provide} on its own, the path for a bare `Command.run`, acts only on the subcommand handler,
 * because core parses the root flags into a local context before any of it is visible.
 *
 * @public
 */
export class CliAudience {
	private constructor() {}

	/**
	 * The four flags, for `Command.withSharedFlags` on the root command.
	 *
	 * @remarks
	 * Each is repeatable, so every occurrence is counted; a boolean given as `false` (`--agent=false`,
	 * `--no-agent`) is not an occurrence. Core lists shared flags in every command's help; pass
	 * `hidden` to remove them from all of them.
	 */
	static readonly flags = (
		options?: CliAudienceFlagsOptions,
	): {
		readonly audience: Flag.Flag<ReadonlyArray<AudienceKind>>;
		readonly human: Flag.Flag<ReadonlyArray<boolean>>;
		readonly agent: Flag.Flag<ReadonlyArray<boolean>>;
		readonly ci: Flag.Flag<ReadonlyArray<boolean>>;
	} => {
		const hide = options?.hidden === true;
		const maybeHide = <A>(flag: Flag.Flag<A>): Flag.Flag<A> => (hide ? Flag.withHidden(flag) : flag);
		return {
			audience: maybeHide(
				Flag.Literals("audience", KINDS).pipe(Flag.atLeast(0), Flag.withDescription("Audience: human | agent | ci")),
			),
			human: maybeHide(
				Flag.Boolean("human").pipe(Flag.atLeast(0), Flag.withDescription("Shorthand for --audience human")),
			),
			agent: maybeHide(
				Flag.Boolean("agent").pipe(Flag.atLeast(0), Flag.withDescription("Shorthand for --audience agent")),
			),
			ci: maybeHide(Flag.Boolean("ci").pipe(Flag.atLeast(0), Flag.withDescription("Shorthand for --audience ci"))),
		};
	};

	/**
	 * Resolve the flags before every subcommand handler and re-provide `Audience`.
	 *
	 * @remarks
	 * `CliAudience.run` and `runWith` apply this themselves, so a program run through them never needs it. Use it
	 * directly only with a bare `Command.run`, which leaves a fallback prompt blind to the flags (see the class
	 * remarks).
	 *
	 * Pipe it onto the composite root, after `withSubcommands`, since a parent's handler does not run when a
	 * subcommand is selected. With exactly one flag the audience is `{ kind, source: "flag" }`; with none the
	 * ambient `Audience` is read and provided back unchanged, so `Audience` stays in the requirement a handler
	 * reading it already has, and is added to a program whose handlers do not read it.
	 */
	static readonly provide = <const Name extends string, Input extends AudienceFlagInput, ContextInput, E, R>(
		command: Command.Command<Name, Input, ContextInput, E, R>,
	): Command.Command<Name, Input, ContextInput, E | CliError.UserError, Exclude<R, Audience> | Audience> =>
		CommandModule.provideEffect(command, Audience, (input: Input) => resolve(input)).pipe(
			// A non-human flag narrows interactivity for the handler too: the env layer decided it from the DETECTED
			// audience, before the flag was read, so `--agent` on a terminal would otherwise stay interactive. Only
			// ever narrows, like `CliInteractive.unless`; `--human` never turns it on.
			CommandModule.provideEffect(CliInteractive, (input: Input) =>
				Effect.map(CliInteractive, (current) => {
					const [flagged] = tallyAudience(input).given;
					return flagged === undefined ? current : current && flagged === "human";
				}),
			),
		);

	/**
	 * Run a command the way `Command.runWith` does, with the audience flag resolved BEFORE core parses.
	 *
	 * @remarks
	 * It scans `argv` for the four audience flags first, then runs core around a provided `Audience` (when exactly
	 * one is given: `{ kind, source: "flag" }`) and a `CliInteractive` narrowed to match (a non-human flag, or a
	 * conflict, makes it false; it never turns it on). A fallback prompt fires while core parses, earlier than
	 * anything `CliAudience.provide` can reach, so `--agent init` on a terminal would otherwise still prompt. No
	 * flag leaves the ambient values untouched. A conflict still gets core's own usage error, exit `64`, from
	 * `CliAudience.provide`'s resolver.
	 *
	 * @param command - the composite root, with the flags shared and `CliAudience.provide` piped on
	 * @param config - the same `version` and `renderErrors` as core's
	 */
	static readonly runWith = <const Name extends string, Input, E, R, ContextInput>(
		command: Command.Command<Name, Input, ContextInput, E, R> & RequiresAudienceFlags<Input>,
		config: { readonly version: string; readonly renderErrors?: boolean | undefined },
	): ((
		input: ReadonlyArray<string>,
	) => Effect.Effect<
		void,
		Exclude<E | CliError.UserError, Terminal.QuitError> | CliError.CliError,
		Exclude<R, Audience> | Audience | Command.Environment
	>) => {
		// `provide` is applied here, so there is one wiring and conflict detection cannot be dropped by omission.
		const core = CommandModule.runWith(
			CliAudience.provide(command as unknown as Command.Command<Name, AudienceFlagInput & Input, ContextInput, E, R>),
			config,
		);
		return (argv) => {
			const run = core(argv);
			const { given, conflict } = scanAudience(argv);
			const [kind] = given;
			if (kind === undefined) return run;
			const withAudience = conflict
				? run
				: (Effect.provideService(run, Audience, { kind, source: "flag" }) as typeof run);
			return Effect.gen(function* () {
				const current = yield* CliInteractive;
				const ambient = yield* CliConfig.CliConfig;
				const interactive = current && !conflict && kind === "human";
				const narrowed = Effect.provideService(withAudience, CliInteractive, interactive);
				// The wizard prompts, so a non-human flag drops it too: the environment decided its gate from the
				// detected audience, before the flag was read.
				return yield* interactive
					? narrowed
					: Effect.provideService(
							narrowed,
							CliConfig.CliConfig,
							CliConfig.make({ builtIns: ambient.builtIns.filter((flag) => flag !== GlobalFlag.Wizard) }),
						);
			}) as typeof run;
		};
	};

	/**
	 * `Command.run` with the audience flag resolved before parsing: reads `Stdio.args` and calls
	 * {@link CliAudience.runWith}.
	 *
	 * @param command - the composite root
	 * @param config - the same `version` and `renderErrors` as core's
	 */
	static readonly run = <const Name extends string, Input, E, R, ContextInput>(
		command: Command.Command<Name, Input, ContextInput, E, R> & RequiresAudienceFlags<Input>,
		config: { readonly version: string; readonly renderErrors?: boolean | undefined },
	): Effect.Effect<
		void,
		Exclude<E | CliError.UserError, Terminal.QuitError> | CliError.CliError,
		Exclude<R, Audience> | Audience | Command.Environment
	> => Stdio.Stdio.use(({ args }) => Effect.flatMap(args, (argv) => CliAudience.runWith(command, config)(argv)));
}
