import { Context } from "effect";

/**
 * Overrides of Ink's render options that only the screen harness sets.
 *
 * @internal
 */
export interface UiRenderOverrides {
	/** Render every frame in full, unthrottled, as Ink's `debug` mode does; the harness reads frames this way. */
	readonly debug?: boolean;
	/** Called after each render, just before Ink writes the frame; the harness counts frames with it. */
	readonly onRender?: () => void;
	/**
	 * Called as a screen's run starts mounting, before Ink is loaded and before the screen's thunk is called, so a run
	 * that crashes before Ink draws still has a capture; the harness starts that screen's capture.
	 */
	readonly onMount?: () => void;
	/**
	 * Called once a screen has unmounted, Ink has exited and the colour level is restored, with the defect the run died
	 * of, if it died (a thunk or a component that threw); the harness marks that screen's capture ended, and crashed.
	 */
	readonly onUnmount?: (crash: { readonly defect: unknown } | undefined) => void;
}

/**
 * The render-option overrides in force: none by default. Internal, so `CliUi.run`'s public signature stays as
 * specified; `CliUiTest` sets it.
 *
 * @internal
 */
export class UiRenderOptions extends Context.Reference<UiRenderOverrides>("@effected/cli/ui/UiRenderOptions", {
	defaultValue: () => ({}),
}) {}
