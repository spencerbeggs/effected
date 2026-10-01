// Root types are named through the package's own name, so the emitted ui.d.ts imports them from "@effected/cli"
// (kept external by dtsExternals) instead of carrying copies a consumer's root layers cannot satisfy.
import type * as Cli from "@effected/cli";
import type { Scope } from "effect";
import { Deferred, Effect, Exit, Semaphore } from "effect";
import type { Context as ReactContext, ReactElement, ReactNode } from "react";
import { Cancelled } from "../Cancelled.js";
import { CliInteractive } from "../CliInteractive.js";
import { CliTheme } from "../CliTheme.js";
import { NotInteractive } from "../NotInteractive.js";
import { errorBoundary } from "./internal/ErrorBoundary.js";
import { fromReact, inkModules, loadInk, withInkColour } from "./internal/ink.js";
import { UiRenderOptions } from "./internal/renderOptions.js";
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
 * What every kit widget reads from its screen.
 *
 * @internal
 */
export interface ScreenContextValue {
	/** Cancel the screen. */
	readonly cancel: ScreenControl<unknown>["cancel"];
	/** The theme of the stream the screen draws on. */
	readonly theme: Cli.StreamTheme;
	/** The glyph set in use. */
	readonly glyphs: Cli.GlyphSet;
}

/**
 * The React context carrying {@link ScreenContextValue}, built on the loaded React.
 *
 * @internal
 */
export const screenContext: () => ReactContext<ScreenContextValue | undefined> = fromReact((react) =>
	react.createContext<ScreenContextValue | undefined>(undefined),
);

/** The root keys: Ctrl-C cancels with `"interrupt"` and Esc with `"escape"`. `q` belongs to widgets, never here. */
const RootKeys = (props: {
	readonly cancel: ScreenContextValue["cancel"];
	readonly children: ReactNode;
}): ReactNode => {
	inkModules().ink.useInput((input, key) => {
		if (key.ctrl && input === "c") props.cancel("interrupt");
		else if (key.escape) props.cancel("escape");
	});
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
		const tree = react.createElement(errorBoundary(), {
			onError: (error) => {
				Deferred.doneUnsafe(result, Exit.die(error));
			},
			children: react.createElement(screenContext().Provider, {
				value: { cancel: control.cancel, theme, glyphs: theme.glyphs },
				children: react.createElement(RootKeys, { cancel: control.cancel, children: element }),
			}),
		});
		const instance = yield* Effect.acquireRelease(
			Effect.sync(() =>
				ink.render(tree, {
					stdin: streams.stdin,
					// Ink draws its frames on what it calls stdout, so a screen on stderr hands it stderr there.
					stdout: stream === "stderr" ? streams.stderr : streams.stdout,
					stderr: streams.stderr,
					interactive: true,
					exitOnCtrlC: false,
					patchConsole: false,
					...(overrides.debug === true ? { debug: true } : {}),
				}),
			),
			(instance) =>
				Effect.promise(async () => {
					instance.unmount();
					await instance.waitUntilExit().catch(() => undefined);
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
	 * stdout.
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
