import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Option } from "effect";

/**
 * A chalk colour level: 0 none, 1 basic, 2 256 colours, 3 truecolor.
 *
 * @internal
 */
export type ChalkLevel = 0 | 1 | 2 | 3;

/**
 * The one member of Ink's chalk instance the kit touches. Every style getter reads it at call time, so setting it
 * is live.
 *
 * @internal
 */
export interface InkChalk {
	level: ChalkLevel;
}

const isInkChalk = (value: unknown): value is InkChalk =>
	(typeof value === "function" || (typeof value === "object" && value !== null)) &&
	typeof (value as { readonly level?: unknown }).level === "number";

/**
 * The chalk instance Ink itself imports, resolved from Ink's own location; `None` when it cannot be resolved.
 *
 * @remarks
 * One of the three files licensed to touch Node (`okf/decisions/ui-binds-process-streams.md`). Ink's `exports` has
 * only `"."` and chalk is its own dependency, so the kit cannot import Ink's chalk by name: a `chalk` of the kit's
 * own could be a different copy, and setting its level would silently change nothing. Resolving `chalk` from Ink's
 * entry and importing its realpath yields the very module Ink imports, because Node keys ES modules by realpath
 * (`okf/decisions/ink-colour-via-inks-own-chalk.md`). A consumer that bundles Ink leaves nothing to resolve, and the
 * answer is `None`; it never rejects.
 *
 * @internal
 */
export const inkChalk = async (): Promise<Option.Option<InkChalk>> => {
	try {
		const inkEntry = fileURLToPath(import.meta.resolve("ink"));
		const chalkPath = realpathSync(createRequire(inkEntry).resolve("chalk"));
		const chalk: { readonly default?: unknown } = await import(/* @vite-ignore */ pathToFileURL(chalkPath).href);
		return isInkChalk(chalk.default) ? Option.some(chalk.default) : Option.none();
	} catch {
		return Option.none();
	}
};
