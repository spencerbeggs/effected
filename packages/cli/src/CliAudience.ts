import type { AudienceKind, AudienceShape } from "@effected/env";
import { Audience } from "@effected/env";
import { Effect } from "effect";
import type { Command } from "effect/cli";
import { CliError, Command as CommandModule, Flag } from "effect/cli";

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

const CONFLICT = "Give at most one of --audience, --human, --agent, --ci (once).";

/** Resolve the four flags into the audience to provide, failing when more than one occurrence was given. */
const resolve = (input: AudienceFlagInput): Effect.Effect<AudienceShape, CliError.UserError, Audience> => {
	const given: ReadonlyArray<AudienceKind> = [
		...input.audience,
		// Only a true occurrence counts: `--agent=false` and `--no-agent` mean "not given".
		...input.human.filter(Boolean).map((): AudienceKind => "human"),
		...input.agent.filter(Boolean).map((): AudienceKind => "agent"),
		...input.ci.filter(Boolean).map((): AudienceKind => "ci"),
	];
	if (given.length > 1) {
		return Effect.fail(new CliError.UserError({ cause: new Error(CONFLICT), userMessage: CONFLICT }));
	}
	const [kind] = given;
	// No flag: the ambient audience, the override variable or detection, is read and provided back unchanged.
	return kind === undefined ? Audience : Effect.succeed({ kind, source: "flag" });
};

/**
 * The audience flags of a CLI: `--audience <human|agent|ci>` and the shorthands `--human`, `--agent`, `--ci`,
 * resolved into `@effected/env`'s `Audience`.
 *
 * @remarks
 * Declare {@link CliAudience.flags} as shared flags on the root command, then pipe the composite root through
 * {@link CliAudience.provide}. Giving more than one occurrence across the four flags is a usage error even when
 * they agree; a boolean set to false (`--no-agent`, `--agent=false`) counts as not given. A bad `--audience` value is core's own parse error. Both exit `64` under `CliRuntime.main`. A
 * conflicting audience together with `--help` exits `0` and prints help, because core handles its action flags
 * before the resolver runs.
 *
 * @example
 * ```ts
 * const root = Command.make("tool").pipe(
 *   Command.withSharedFlags(CliAudience.flags()),
 *   Command.withSubcommands([verify]),
 *   CliAudience.provide,
 * )
 * ```
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
	 * Pipe it onto the composite root, after `withSubcommands`, since a parent's handler does not run when a
	 * subcommand is selected. With exactly one flag the audience is `{ kind, source: "flag" }`; with none the
	 * ambient `Audience` is read and provided back unchanged, so `Audience` stays in the requirement a handler
	 * reading it already has, and is added to a program whose handlers do not read it.
	 */
	static readonly provide = <const Name extends string, Input extends AudienceFlagInput, ContextInput, E, R>(
		command: Command.Command<Name, Input, ContextInput, E, R>,
	): Command.Command<Name, Input, ContextInput, E | CliError.UserError, Exclude<R, Audience> | Audience> =>
		CommandModule.provideEffect(command, Audience, (input: Input) => resolve(input));
}
