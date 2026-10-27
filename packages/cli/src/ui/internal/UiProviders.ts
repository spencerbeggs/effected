import type * as Cli from "@effected/cli";
import { Effect } from "effect";
import type { ReactElement, ReactNode } from "react";
import { underGithubActions } from "../../internal/autoFormat.js";
import type { DisplayPath } from "../../internal/displayPath.js";
import { CurrentDisplayPath } from "../../internal/displayPath.js";
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

/**
 * What every tree the kit mounts (a screen, a live view, `CliUi.context`'s value) shares.
 *
 * @internal
 */
export interface TreeBase {
	readonly theme: Cli.StreamTheme;
	readonly glyphs: Cli.GlyphSet;
	readonly neutralizeWorkflowCommands?: boolean;
	readonly displayPath: DisplayPath;
}

/**
 * The base of a kit tree drawn with `theme`: its glyphs, `neutralizeWorkflowCommands` under the GitHub Actions
 * runner, and the run's path display. Read once per mount, so a screen, a live view and `CliUi.context` agree.
 *
 * @internal
 */
export const treeBase = (theme: Cli.StreamTheme): Effect.Effect<TreeBase> =>
	Effect.gen(function* () {
		const neutralize = yield* underGithubActions;
		return {
			theme,
			glyphs: theme.glyphs,
			...(neutralize ? { neutralizeWorkflowCommands: true } : {}),
			displayPath: yield* CurrentDisplayPath,
		};
	});
