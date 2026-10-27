// The path display a program chose through `CliEnv.layer`'s `displayPath`, as a reference `Render.context` reads, so
// `Doc.print`, a live view's `final` and the failure report all show a path the same way.

import { Context, Effect, Layer, Option, Path } from "effect";

/** Turns an absolute path into its display form. */
export type DisplayPath = (absolute: string) => string;

/** What `CliEnvOptions.displayPath` takes: a function, or a root to show paths under relative to. */
export type DisplayPathOption = DisplayPath | { readonly relativeTo: string };

/**
 * The display that shows every path as it is.
 *
 * @internal
 */
export const identity: DisplayPath = (absolute) => absolute;

/**
 * The path display in effect: the identity unless `CliEnv.layer` was given a `displayPath`.
 *
 * @internal
 */
export const CurrentDisplayPath = Context.Reference<DisplayPath>("@effected/cli/CurrentDisplayPath", {
	defaultValue: () => identity,
});

/**
 * A path relative to `root` when it lies under it, and the path unchanged when it is `root` itself or lies outside it
 * (a `../..` chain says less than the absolute path). With a `Path` service its `relative` decides; without one, a
 * plain prefix test on `/` and `\` does.
 *
 * @internal
 */
export const relativeTo = (root: string, path: Option.Option<Path.Path>): DisplayPath =>
	Option.match(path, {
		onSome:
			(p): DisplayPath =>
			(absolute) => {
				const rel = p.relative(root, absolute);
				return rel === "" || rel === ".." || rel.startsWith(`..${p.sep}`) || rel.startsWith("../") || p.isAbsolute(rel)
					? absolute
					: rel;
			},
		onNone: (): DisplayPath => {
			// A loop, not `/[\\/]+$/`: unanchored, that retries from every separator of a run inside `root`, quadratically.
			let end = root.length;
			while (end > 0 && (root[end - 1] === "/" || root[end - 1] === "\\")) end -= 1;
			const base = root.slice(0, end);
			return (absolute) => {
				const next = absolute.charAt(base.length);
				return absolute.startsWith(base) && (next === "/" || next === "\\") && absolute.length > base.length + 1
					? absolute.slice(base.length + 1)
					: absolute;
			};
		},
	});

/**
 * Sets {@link CurrentDisplayPath} from the option, reading `Path` from the context when it is there. No option sets
 * nothing.
 *
 * @internal
 */
export const displayPathLayer = (option: DisplayPathOption | undefined): Layer.Layer<never> =>
	option === undefined
		? Layer.empty
		: Layer.effect(CurrentDisplayPath)(
				typeof option === "function"
					? Effect.succeed(option)
					: Effect.map(Effect.serviceOption(Path.Path), (path) => relativeTo(option.relativeTo, path)),
			);
