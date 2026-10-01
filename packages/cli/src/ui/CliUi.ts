// Root types are named through the package's own name, so the emitted ui.d.ts imports them from "@effected/cli"
// (kept external by dtsExternals) instead of carrying copies a consumer's root layers cannot satisfy.
import type * as Cli from "@effected/cli";
import type { Scope } from "effect";
import { Deferred, Effect, Exit, Option, Semaphore } from "effect";
import type { Param } from "effect/cli";
import { Prompt } from "effect/cli";
import type { ReactElement, ReactNode } from "react";
import { Cancelled } from "../Cancelled.js";
import { CliInteractive } from "../CliInteractive.js";
import { CliTheme } from "../CliTheme.js";
import { answerWithoutPerson } from "../internal/fallbackAnswer.js";
import { NotInteractive } from "../NotInteractive.js";
import { errorBoundary } from "./internal/ErrorBoundary.js";
import { inkModules, loadInk, withInkColour } from "./internal/ink.js";
import { UiRenderOptions } from "./internal/renderOptions.js";
import type { ScreenContextValue } from "./internal/ScreenContext.js";
import { screenContext, useScreenGuard } from "./internal/ScreenContext.js";
import { KeyTable, useKeys } from "./KeyTable.js";
import { UiStreams } from "./UiStreams.js";

/**
 * How a screen ends: with a result, or cancelled for a reason.
 *
 * @remarks
 * Only the first call counts. Resolving with an empty value (`[]`, `""`) is a result, not a cancel.
 *
 * @public
 */
export interface ScreenControl<A> {
	/** End the screen with `value`. */
	readonly resolve: (value: A) => void;
	/** End the screen as cancelled: `"escape"` for Esc or a widget's quit key, `"interrupt"` for Ctrl-C. */
	readonly cancel: (reason: "escape" | "interrupt") => void;
}

/**
 * A screen: given its control, the React element to mount, or a promise of one.
 *
 * @public
 */
export type Screen<A> = (control: ScreenControl<A>) => ReactElement | Promise<ReactElement>;

/**
 * Options for {@link CliUi.run}.
 *
 * @public
 */
export interface CliUiRunOptions {
	/** The stream the screen draws on, which decides its colour level; `"stdout"` by default. */
	readonly stream?: "stdout" | "stderr";
}

/**
 * Options for {@link CliUi.prompt}.
 *
 * @public
 */
export interface CliUiPromptOptions<A> {
	/** The value to use when the run is not interactive. Without it a non-interactive run fails with `NotInteractive`. */
	readonly otherwise?: A;
}

/** The root keys: Esc cancels with `"escape"`, Ctrl-C with `"interrupt"`. `q` belongs to widgets, never here. */
const RootKeys = (props: {
	readonly cancel: ScreenContextValue["cancel"];
	readonly children: ReactNode;
}): ReactNode => {
	useKeys(KeyTable.root, props.cancel);
	// Registering a paste handler turns on bracketed paste and moves every paste onto Ink's paste channel, so pasted
	// text never reaches a `useInput` handler as keys: a pasted `q` or `yes\n` cannot cancel or answer a widget.
	// `TextInput` registers its own handler to read a paste as text.
	const guard = useScreenGuard();
	inkModules().ink.usePaste(guard(() => undefined));
	return props.children;
};

/**
 * One screen at a time, process-wide: Ink owns raw mode on the one terminal, so concurrent screens are meaningless,
 * and serializing them keeps each mount's save-and-restore of Ink's colour level well nested.
 */
const mounts = Semaphore.makeUnsafe(1);

const SCREEN_EXITED = "@effected/cli/ui: the screen exited without resolving or cancelling";

const mount = <A>(
	screen: Screen<A>,
	theme: Cli.StreamTheme,
	stream: "stdout" | "stderr",
): Effect.Effect<A, Cli.Cancelled, Scope.Scope> =>
	Effect.gen(function* () {
		const { ink, react } = yield* loadInk;
		const streams = yield* UiStreams;
		const overrides = yield* UiRenderOptions;
		yield* withInkColour(theme.color);
		const result = yield* Deferred.make<A, Cli.Cancelled>();
		const control: ScreenControl<A> = {
			resolve: (value) => {
				Deferred.doneUnsafe(result, Exit.succeed(value));
			},
			cancel: (reason) => {
				Deferred.doneUnsafe(result, Exit.fail(new Cancelled({ reason })));
			},
		};
		const element = yield* Effect.promise(async () => screen(control));
		const die = (error: unknown): void => {
			Deferred.doneUnsafe(result, Exit.die(error));
		};
		const tree = react.createElement(errorBoundary(), {
			onError: die,
			children: react.createElement(screenContext().Provider, {
				value: { cancel: control.cancel, die, theme, glyphs: theme.glyphs },
				children: react.createElement(RootKeys, { cancel: control.cancel, children: element }),
			}),
		});
		const instance = yield* Effect.acquireRelease(
			Effect.sync(() => {
				// Before render: Ink draws the first frame inside it, and the harness files frames under the mount.
				overrides.onMount?.();
				return ink.render(tree, {
					stdin: streams.stdin,
					// Ink draws its frames on what it calls stdout, so a screen on stderr hands it stderr there.
					stdout: stream === "stderr" ? streams.stderr : streams.stdout,
					stderr: streams.stderr,
					interactive: true,
					exitOnCtrlC: false,
					patchConsole: false,
					...(overrides.debug === true ? { debug: true } : {}),
					...(overrides.onRender === undefined ? {} : { onRender: overrides.onRender }),
				});
			}),
			(instance) =>
				Effect.promise(async () => {
					instance.unmount();
					await instance.waitUntilExit().catch(() => undefined);
					overrides.onUnmount?.();
				}),
		);
		const exited: Effect.Effect<A, Cli.Cancelled> = Effect.tryPromise({
			try: () => instance.waitUntilExit(),
			catch: (cause) => cause,
		}).pipe(
			Effect.orDie,
			Effect.flatMap(() =>
				Effect.flatMap(Deferred.isDone(result), (done) =>
					done ? Deferred.await(result) : Effect.die(new Error(SCREEN_EXITED)),
				),
			),
		);
		return yield* Effect.raceFirst(Deferred.await(result), exited);
	});

/**
 * Interactive screens drawn with Ink, mounted as scoped resources.
 *
 * @public
 */
export class CliUi {
	private constructor() {}

	/**
	 * Mount `screen` and wait for it to resolve or cancel.
	 *
	 * @remarks
	 * When `CliInteractive` is false it fails with `NotInteractive` and mounts nothing; Ink and React are not even
	 * loaded. Otherwise it loads them, holds Ink's colour level at the stream's level, and mounts the screen on
	 * `UiStreams` with Ink's own Ctrl-C exit off: Ctrl-C cancels with `"interrupt"` and Esc with `"escape"`.
	 *
	 * Mounting is one scoped resource. However the screen ends (resolved, cancelled, crashed, or the fiber
	 * interrupted), it is unmounted, raw mode is off, the cursor is shown, and the colour level is restored. A
	 * component that throws is a defect, never a hang or a typed failure, and nothing of Ink's crash screen reaches
	 * stdout. So is a `useKeys` handler that throws; a handler a consumer registers with Ink's own `useInput` or
	 * `usePaste` is outside the kit, and what it throws escapes as Ink leaves it.
	 *
	 * With `stream: "stderr"` the frames, like the colour level, follow stderr, so stdout carries only what the
	 * program itself writes.
	 *
	 * Screens run one at a time, process-wide: Ink owns raw mode on the one terminal, so a second `run` waits until
	 * the first is released. A screen that itself awaits another `CliUi.run` therefore deadlocks, and nothing guards
	 * against it.
	 *
	 * @param screen - builds the element to mount from its {@link ScreenControl}
	 * @param options - the stream to draw on
	 */
	static readonly run = <A>(
		screen: Screen<A>,
		options?: CliUiRunOptions,
	): Effect.Effect<A, Cli.Cancelled | Cli.NotInteractive, Cli.CliTheme> =>
		Effect.gen(function* () {
			if (!(yield* CliInteractive)) return yield* Effect.fail(new NotInteractive());
			const stream = options?.stream ?? "stdout";
			const theme = (yield* CliTheme).forStream(stream);
			return yield* Semaphore.withPermit(mounts, Effect.scoped(mount(screen, theme, stream)));
		});

	/**
	 * Run `screen` from a handler when the run is interactive; otherwise answer with `otherwise`, or fail with
	 * `NotInteractive` when there is none.
	 *
	 * @remarks
	 * `CliUi.run` with a default: not interactive, it returns `otherwise` and Ink and React are never loaded.
	 * Interactive, it mounts the screen, and a cancel is the typed `Cancelled` a handler can catch, which
	 * `CliRuntime.main` otherwise renders as one line with exit `130`. A missing Ink in an interactive run is a defect
	 * naming the peers, never a silent `otherwise`. Screens in sequence make a wizard: discover the defaults first,
	 * pass each as an `otherwise`, and a non-interactive run returns exactly them.
	 *
	 * @param screen - the screen to show
	 * @param options - the non-interactive default
	 */
	static readonly prompt = <A>(
		screen: Screen<A>,
		options?: CliUiPromptOptions<A>,
	): Effect.Effect<A, Cli.Cancelled | Cli.NotInteractive, Cli.CliTheme> =>
		CliUi.run(screen).pipe(
			Effect.catchTag("NotInteractive", (error) => {
				// `{ otherwise: undefined }` counts as not given.
				const otherwise = options?.otherwise;
				return otherwise === undefined ? Effect.fail(error) : Effect.succeed(otherwise);
			}),
		);

	/**
	 * A fallback for `Flag.withFallbackPrompt` or `Argument.withFallbackPrompt` that shows a screen when the run is
	 * interactive: `CliPrompt.fallback` for screens.
	 *
	 * @remarks
	 * Interactive, the screen mounts and its answer is the parameter's value. Not interactive, `otherwise` is used when
	 * given and Ink and React are never loaded; without it the parameter fails as missing, exactly as with no fallback,
	 * so core renders its own message and `CliRuntime.main` exits `64`. Name the parameter with `flag` (the name
	 * without dashes) or `argument` so that error can be built.
	 *
	 * The options are {@link @effected/cli!CliPromptFallbackOptions}, the same as `CliPrompt.fallback`'s.
	 *
	 * It runs during parsing, whose environment is core's alone, so it reads `CliTheme` if one is there: with
	 * `CliRuntime.main`'s `env` (`CliEnv.layer`), or provided around the program. With no theme it treats the run as
	 * not interactive, and when `CliInteractive` is on it says so once, at debug level. Interactivity is
	 * `CliInteractive`, which an audience flag can set before parsing under `CliAudience`.
	 *
	 * As with `CliPrompt.fallback`, the screen runs here rather than being handed to core, whose fallback runner
	 * turns a quit into the missing-parameter error, which would exit `64`. A cancel (Esc, Ctrl-C) is `Cancelled`,
	 * raised as a defect because core's parse step turns every typed failure into a usage error, so only
	 * `CliRuntime.main` (or `CliRuntime.reportFailures`) renders it, as one line with exit `130`. A missing Ink in an
	 * interactive run is a defect naming the peers, never a silent `otherwise`.
	 *
	 * After the screen has unmounted, core still runs the answered `Prompt.succeed` it is handed against the
	 * terminal, exactly as it does for `CliPrompt.fallback`: `Prompt.run` opens the terminal's input in a scope (on
	 * Node a readline over stdin, in raw mode) before looking at the prompt. That is harmless. The prompt is already
	 * answered, so nothing is read and no key is waited for; the scope closes at once, restoring the mode and closing
	 * the reader; and Ink has already let go of stdin, so the two never hold it together. Not interactive, the screen
	 * never mounts, and `CliPrompt.gateTerminal`, which `CliEnv.layer` installs, keeps that subscription off the real
	 * terminal altogether.
	 *
	 * @param screen - the screen to show
	 * @param options - the parameter it stands in for, and the non-interactive default
	 */
	static readonly fallback = <A>(
		screen: Screen<A>,
		options: Cli.CliPromptFallbackOptions<A>,
	): Param.FallbackPrompt<A> => {
		// Said once per fallback: a parse that retries must not repeat it.
		let explained = false;
		return Effect.gen(function* () {
			const theme = yield* Effect.serviceOption(CliTheme);
			if (Option.isNone(theme)) {
				if (!explained && (yield* CliInteractive)) {
					explained = true;
					const name = "flag" in options ? `--${options.flag}` : `<${options.argument}>`;
					yield* Effect.logDebug(
						`@effected/cli/ui: CliUi.fallback for ${name} answered without its screen: CliInteractive is on, but no CliTheme is provided around parsing (CliRuntime.main's env provides one)`,
					);
				}
				return yield* answerWithoutPerson(options);
			}
			return yield* CliUi.run(screen).pipe(
				Effect.provideService(CliTheme, theme.value),
				Effect.map((answer) => Prompt.succeed(answer)),
				Effect.catchTag("Cancelled", (cancelled) => Effect.die(cancelled)),
				Effect.catchTag("NotInteractive", () => answerWithoutPerson(options)),
			);
		});
	};

	/**
	 * A screen whose module is loaded only when it mounts, so importing the command that uses it loads neither the
	 * screen's own code nor React.
	 *
	 * @param load - imports the module whose default export is the screen
	 */
	static readonly lazy =
		<A>(load: () => Promise<{ readonly default: Screen<A> }>): Screen<A> =>
		async (control) =>
			(await load()).default(control);
}
