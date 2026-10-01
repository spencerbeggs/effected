import type { ReactElement, ReactNode } from "react";
import { inkModules } from "./ink.js";
import type { ScreenContextValue } from "./ScreenContext.js";
import { screenContext } from "./ScreenContext.js";

/**
 * Wrap `children` in the kit's providers: the theme, the glyph set, the optional size override, and a screen's cancel
 * and defect route when it has them.
 *
 * @remarks
 * The one place a kit tree's context is built, for `CliUi.run`'s screens, a live view and the public `UiProvider`,
 * so every kit hook reads the same value under each.
 *
 * @internal
 */
export const uiProviders = (value: ScreenContextValue, children: ReactNode): ReactElement =>
	inkModules().react.createElement(screenContext().Provider, { value, children });
