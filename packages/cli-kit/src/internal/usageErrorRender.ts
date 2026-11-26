import type { Context } from "effect";
import { Cause, Console, Effect, Exit, Option, Stdio } from "effect";
import { CliConfig, CliError, CliOutput, Command, CommandSpec, GlobalFlag } from "effect/cli";
import { guardConsumerLines } from "./failureTarget.js";

/**
 * Reads one global setting's value as core would provide it for the usage error's command path.
 *
 * @internal
 */
export type SettingLookup = <Id extends string, A>(setting: GlobalFlag.Setting<Id, A>) => Option.Option<A>;

/** @internal */
export interface UsageErrorRender {
	readonly command: Command.Command.Any;
	readonly render: (details: {
		readonly errors: ReadonlyArray<CliError.NonShowHelpErrors>;
		readonly commandPath: ReadonlyArray<string>;
		readonly setting: SettingLookup;
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
 * Every name and alias a setting's flag answers to, read through `CommandSpec` from a bare root declaring only it.
 */
// biome-ignore lint/suspicious/noExplicitAny: any setting's value type, as core's own `GlobalFlag<any>` lists.
const namesOf = (setting: GlobalFlag.GlobalFlag<any>): ReadonlySet<string> => {
	const spec = CommandSpec.resolve(Command.make("probe").pipe(Command.withGlobalFlags([setting])), ["probe"], {
		builtIns: [],
	});
	return new Set(
		Option.match(spec, {
			onNone: () => [],
			onSome: ({ flags }) => flags.flatMap((flag) => [flag.name, ...flag.aliases]),
		}),
	);
};

/**
 * A setting's value, read by core's own parser through public API only.
 *
 * @remarks
 * Scope comes from `CommandSpec.resolve`: the setting is active on `commandPath` when the path lists a `Global`
 * `Setting` flag under the setting's own name. A `Local` or `Inherited` flag on the path sharing one of its names
 * would take the token in the real parse, so that answers `none` rather than guess.
 *
 * The value comes from a probe: a bare root of the same name declaring the setting's flag as a `GlobalFlag.Action`,
 * run through `Command.runWith` over the same argv with no built-ins, `renderErrors: false` and a silent
 * `Presenter`. Core runs action flags before it raises parse errors, so the action sees the value core's lexer and
 * global-flag consumer read even when the rest of argv is invalid. The probe has no handler and its action only
 * records the value, so it writes nothing and runs nothing of the program's. When the action does not fire, an error
 * other than the probe's own remainder errors means the setting's value was rejected (`none`); otherwise the flag was
 * absent and its default is parsed exactly as core does (`flag.parse` over no tokens). Runs synchronously under the
 * captured context: a setting whose parse is asynchronous answers `none`.
 *
 * @internal
 */
export const makeSettingLookup = (
	command: Command.Command.Any,
	commandPath: ReadonlyArray<string>,
	argv: ReadonlyArray<string>,
	context: Context.Context<never>,
	// biome-ignore lint/suspicious/noExplicitAny: core types `CliConfig.builtIns` the same way.
	builtIns: ReadonlyArray<GlobalFlag.GlobalFlag<any>>,
): SettingLookup => {
	const spec = CommandSpec.resolve(command, commandPath, { builtIns });
	const cache = new Map<unknown, Option.Option<unknown>>();
	const runSync = Effect.runSyncExitWith(context);

	// biome-ignore lint/suspicious/noExplicitAny: a setting of any id; core's own `GlobalFlag<any>` lists are typed the same way.
	const resolve = <A>(setting: GlobalFlag.Setting<any, A>): Option.Option<A> => {
		if (Option.isNone(spec)) return Option.none();
		const names = namesOf(setting);
		const flags = spec.value.flags;
		const active = flags.some(
			(flag) => flag.scope._tag === "Global" && flag.scope.kind === "Setting" && names.has(flag.name),
		);
		if (!active) return Option.none();
		const collides = flags.some(
			(flag) =>
				flag.scope._tag !== "Global" && (names.has(flag.name) || flag.aliases.some((alias) => names.has(alias))),
		);
		if (collides) return Option.none();

		let captured: Option.Option<A> = Option.none();
		const probe = Command.make(command.name).pipe(
			Command.withGlobalFlags([
				GlobalFlag.Action({
					flag: setting.flag,
					run: (value) =>
						Effect.sync(() => {
							captured = Option.some(value);
						}),
				}),
			]),
		);
		const exit = runSync(
			Command.runWith(probe, { version: "", renderErrors: false })(argv).pipe(
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
		const fallback = runSync(setting.flag.parse({ flags: {}, arguments: [] }) as Effect.Effect<readonly [unknown, A]>);
		return Exit.isSuccess(fallback) ? Option.some(fallback.value[1]) : Option.none();
	};

	return <Id extends string, A>(setting: GlobalFlag.Setting<Id, A>): Option.Option<A> => {
		const hit = cache.get(setting);
		if (hit !== undefined) return hit as Option.Option<A>;
		const value = resolve(setting);
		cache.set(setting, value);
		return value;
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
				const setting = makeSettingLookup(hook.command, error.commandPath, argv, context, builtIns);
				return hook.render({ errors: error.errors, commandPath: error.commandPath, setting });
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
