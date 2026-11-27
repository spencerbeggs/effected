import type { Context } from "effect";
import { Cause, Console, Effect, Exit, Option, Stdio } from "effect";
import type { Flag } from "effect/cli";
import { CliConfig, CliError, CliOutput, Command, CommandSpec, GlobalFlag } from "effect/cli";
import { guardConsumerLines } from "./failureTarget.js";

/**
 * Reads one global setting's value as core would provide it for the usage error's command path.
 *
 * @internal
 */
export type SettingLookup = <Id extends string, A>(setting: GlobalFlag.Setting<Id, A>) => Option.Option<A>;

/**
 * Reads one local flag's value as core would parse it for the usage error's command path.
 *
 * @internal
 */
export type FlagLookup = <A>(flag: Flag.Flag<A>) => Option.Option<A>;

/** @internal */
export interface UsageErrorLookups {
	readonly setting: SettingLookup;
	readonly flag: FlagLookup;
}

/** @internal */
export interface UsageErrorRender {
	readonly command: Command.Command.Any;
	readonly render: (details: {
		readonly errors: ReadonlyArray<CliError.NonShowHelpErrors>;
		readonly commandPath: ReadonlyArray<string>;
		readonly setting: SettingLookup;
		readonly flag: FlagLookup;
	}) => string | ReadonlyArray<string> | undefined;
}

/** The only errors the probe's own parse raises for tokens that are not the setting's (it has no arguments or subcommands). */
const REMAINDER_ERRORS: ReadonlySet<string> = new Set([
	"UnrecognizedOption",
	"UnknownSubcommand",
	"UnexpectedArgument",
]);

const silent: CliOutput.Presenter = { present: () => Effect.void };

const isShowHelp = (u: unknown): u is CliError.ShowHelp => CliError.isCliError(u) && u._tag === "ShowHelp";

/**
 * Every name and alias a flag answers to, read through `CommandSpec` from a bare root declaring only it.
 */
const namesOf = <A>(flag: Flag.Flag<A>): ReadonlySet<string> => {
	const spec = CommandSpec.resolve(
		Command.make("probe").pipe(Command.withGlobalFlags([GlobalFlag.Action({ flag, run: () => Effect.void })])),
		["probe"],
		{ builtIns: [] },
	);
	return new Set(
		Option.match(spec, {
			onNone: () => [],
			onSome: ({ flags }) => flags.flatMap((flag) => [flag.name, ...flag.aliases]),
		}),
	);
};

/**
 * A setting's or a local flag's value, read by core's own parser through public API only.
 *
 * @remarks
 * Scope comes from `CommandSpec.resolve`. A setting is active on `commandPath` when the path lists a `Global`
 * `Setting` flag under the setting's own name; a `Local` or `Inherited` flag on the path sharing one of its names
 * would take the token in the real parse, so that answers `none` rather than guess. A local flag is active when the
 * path lists a `Local` or `Inherited` flag under its name: that is the flag the real parse gives the token to, so no
 * collision check applies. Flag identity is not visible through `CommandSpec`, so a flag is matched by name: the
 * caller passes the flag the failing command declared.
 *
 * The value comes from a probe: a bare root of the same name declaring the flag as a `GlobalFlag.Action`, run
 * through `Command.runWith` over the same argv with no built-ins, `renderErrors: false` and a silent `Presenter`.
 * Core runs action flags before it raises parse errors, so the action sees the value core's lexer and global-flag
 * consumer read even when the rest of argv is invalid. The probe has no handler and its action only records the
 * value, so it writes nothing and runs nothing of the program's. When the action does not fire, an error other than
 * the probe's own remainder errors means the flag's value was rejected (`none`); otherwise the flag was absent and
 * its default is parsed exactly as core does (`flag.parse` over no tokens). Runs synchronously under the captured
 * context: a flag whose parse is asynchronous answers `none`.
 *
 * @internal
 */
export const makeUsageErrorLookups = (
	command: Command.Command.Any,
	commandPath: ReadonlyArray<string>,
	argv: ReadonlyArray<string>,
	context: Context.Context<never>,
	// biome-ignore lint/suspicious/noExplicitAny: core types `CliConfig.builtIns` the same way.
	builtIns: ReadonlyArray<GlobalFlag.GlobalFlag<any>>,
): UsageErrorLookups => {
	const spec = CommandSpec.resolve(command, commandPath, { builtIns });
	const flags = Option.match(spec, { onNone: () => [], onSome: ({ flags }) => flags });
	const runSync = Effect.runSyncExitWith(context);

	const probe = <A>(flag: Flag.Flag<A>): Option.Option<A> => {
		let captured: Option.Option<A> = Option.none();
		const root = Command.make(command.name).pipe(
			Command.withGlobalFlags([
				GlobalFlag.Action({
					flag,
					run: (value) =>
						Effect.sync(() => {
							captured = Option.some(value);
						}),
				}),
			]),
		);
		const exit = runSync(
			Command.runWith(root, { version: "", renderErrors: false })(argv).pipe(
				Effect.provideService(CliConfig.CliConfig, CliConfig.make({ builtIns: [] })),
				Effect.provideService(CliOutput.Presenter, silent),
			) as Effect.Effect<void, unknown>,
		);
		if (Option.isSome(captured)) return captured;
		if (Exit.isFailure(exit)) {
			const error = Cause.squash(exit.cause);
			if (!isShowHelp(error)) return Option.none();
			if (error.errors.some((e) => !REMAINDER_ERRORS.has(e._tag))) return Option.none();
		}
		const fallback = runSync(flag.parse({ flags: {}, arguments: [] }) as Effect.Effect<readonly [unknown, A]>);
		return Exit.isSuccess(fallback) ? Option.some(fallback.value[1]) : Option.none();
	};

	const answersTo = (names: ReadonlySet<string>, flag: (typeof flags)[number]) =>
		names.has(flag.name) || flag.aliases.some((alias) => names.has(alias));

	// biome-ignore lint/suspicious/noExplicitAny: a setting of any id; core's own `GlobalFlag<any>` lists are typed the same way.
	const resolveSetting = <A>(setting: GlobalFlag.Setting<any, A>): Option.Option<A> => {
		const names = namesOf(setting.flag);
		const active = flags.some(
			(flag) => flag.scope._tag === "Global" && flag.scope.kind === "Setting" && names.has(flag.name),
		);
		if (!active) return Option.none();
		if (flags.some((flag) => flag.scope._tag !== "Global" && answersTo(names, flag))) return Option.none();
		return probe(setting.flag);
	};

	const resolveFlag = <A>(flag: Flag.Flag<A>): Option.Option<A> => {
		const names = namesOf(flag);
		const active = flags.some((entry) => entry.scope._tag !== "Global" && names.has(entry.name));
		return active ? probe(flag) : Option.none();
	};

	const cached = <K, A>(resolve: (key: K) => Option.Option<A>) => {
		const cache = new Map<K, Option.Option<A>>();
		return (key: K): Option.Option<A> => {
			const hit = cache.get(key);
			if (hit !== undefined) return hit;
			const value = resolve(key);
			cache.set(key, value);
			return value;
		};
	};
	// biome-ignore lint/suspicious/noExplicitAny: the caches hold every setting's and flag's value type.
	const settingCache = cached<GlobalFlag.Setting<any, any>, any>(resolveSetting);
	// biome-ignore lint/suspicious/noExplicitAny: as above.
	const flagCache = cached<Flag.Flag<any>, any>(resolveFlag);

	return {
		setting: <Id extends string, A>(setting: GlobalFlag.Setting<Id, A>): Option.Option<A> => settingCache(setting),
		flag: <A>(flag: Flag.Flag<A>): Option.Option<A> => flagCache(flag),
	};
};

/**
 * Run `program` with an invalid invocation's help held back until the usage error reaches `main`, then either print
 * the consumer's document on stdout (the held help and errors written through `toStderr`) or present the held help
 * exactly as it would have been.
 *
 * @remarks
 * Only `InvalidInvocation` events are held, and each is replayed under the context it was presented in, so with
 * `render` answering `undefined` the output is the same bytes in the same order as without the hook. Any other event
 * (`--help`, a bare group, `--version`) goes straight to the Presenter in effect.
 *
 * @internal
 */
export const withUsageErrorRender = <A, E, R>(
	program: Effect.Effect<A, E, R>,
	hook: UsageErrorRender,
	toStderr: CliOutput.Presenter,
): Effect.Effect<A, E, R | Stdio.Stdio> =>
	Effect.gen(function* () {
		const outer = yield* CliOutput.Presenter;
		const held: Array<{ readonly event: CliOutput.Presenter.Event; readonly context: Context.Context<never> }> = [];
		const holding: CliOutput.Presenter = {
			present: (event) =>
				event._tag === "InvalidInvocation"
					? Effect.map(Effect.context<never>(), (context) => {
							held.push({ event, context });
						})
					: outer.present(event),
		};
		const flush = (presenter: CliOutput.Presenter) =>
			Effect.suspend(() =>
				Effect.forEach(
					held.splice(0),
					({ event, context }) => presenter.present(event).pipe(Effect.provideContext(context)),
					{ discard: true },
				),
			);

		const document = (error: CliError.ShowHelp) =>
			Effect.gen(function* () {
				const stdio = yield* Stdio.Stdio;
				const argv = yield* stdio.args;
				const context = yield* Effect.context<never>();
				const { builtIns } = yield* CliConfig.CliConfig;
				const { setting, flag } = makeUsageErrorLookups(hook.command, error.commandPath, argv, context, builtIns);
				return hook.render({ errors: error.errors, commandPath: error.commandPath, setting, flag });
			});

		return yield* Effect.provideService(program, CliOutput.Presenter, holding).pipe(
			Effect.onExit((exit) =>
				Effect.gen(function* () {
					const error =
						Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) ? Cause.squash(exit.cause) : undefined;
					if (!isShowHelp(error) || error.errors.length === 0) return yield* flush(outer);
					const rendered = yield* document(error).pipe(Effect.onError(() => flush(outer)));
					if (rendered === undefined) return yield* flush(outer);
					yield* flush(toStderr);
					const lines = yield* guardConsumerLines(typeof rendered === "string" ? [rendered] : rendered);
					for (const line of lines) yield* Console.log(line);
				}),
			),
		);
	});
