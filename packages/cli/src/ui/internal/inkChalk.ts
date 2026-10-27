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
 * The runtime's `import.meta.resolve` for THIS module, when it has one. It resolves relative to the module that owns
 * it, so it has to be the kit's own: `ModuleResolution` cannot supply it.
 *
 * @internal
 */
export const esmResolve: ((specifier: string) => string) | undefined =
	typeof import.meta.resolve === "function" ? (specifier) => import.meta.resolve(specifier) : undefined;

/**
 * The chalk instance Ink itself imports, resolved from Ink's own location; `None` when it cannot be resolved.
 *
 * @remarks
 * Ink's `exports` has only `"."` and chalk is its own dependency, so the kit cannot import Ink's chalk by name: a
 * `chalk` of the kit's own could be a different copy, and setting its level would silently change nothing. So Ink's
 * entry is resolved from here (`esm` first, Node's CommonJS resolution where it is missing or throws, as under Vite's
 * module runner, which evaluates a Vitest reporter loaded by path), `chalk` is resolved from that entry to its
 * realpath, and that file is imported: Node keys ES modules by realpath, so it is the very module Ink imports. The
 * resolution is `@effected/commands/node-sync`'s `ModuleResolution`, loaded only when this runs, so importing `./ui`
 * loads none of it. A consumer that bundles Ink leaves nothing to resolve, and the answer is `None`; it never rejects.
 *
 * @param esm - an ESM resolver relative to this module; the runtime's `import.meta.resolve` by default, and a stand-in
 *   in a test
 *
 * @internal
 */
export const inkChalk = async (
	esm: ((specifier: string) => string) | undefined = esmResolve,
): Promise<Option.Option<InkChalk>> => {
	try {
		const { ModuleResolution } = await import("@effected/commands/node-sync");
		const chalkPath = Option.flatMap(ModuleResolution.resolve("ink", { from: import.meta.url, esm }), (entry) =>
			ModuleResolution.resolve("chalk", { from: entry, realPath: true }),
		);
		if (Option.isNone(chalkPath)) return Option.none();
		const chalk = (await ModuleResolution.load(chalkPath.value)) as { readonly default?: unknown };
		return isInkChalk(chalk.default) ? Option.some(chalk.default) : Option.none();
	} catch {
		return Option.none();
	}
};
