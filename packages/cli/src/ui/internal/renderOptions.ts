import { Context } from "effect";

/**
 * Overrides of Ink's render options that only the screen harness sets.
 *
 * @internal
 */
export interface UiRenderOverrides {
	/** Render every frame in full, unthrottled, as Ink's `debug` mode does; the harness reads frames this way. */
	readonly debug?: boolean;
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
