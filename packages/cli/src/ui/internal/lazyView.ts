import { Effect } from "effect";
import type { ReactElement } from "react";

/** Where a lazy view keeps its loader: a `Symbol.for` key, so two copies of the package agree on it. */
const LOAD = Symbol.for("@effected/cli/ui/lazyView");

const NOT_LOADED =
	"@effected/cli/ui: a CliUi.lazyView render was called before its module loaded; only CliUi.live loads it first";

/** A live view's drawing: the state and the frame index to a React element. */
type LiveRender<S> = (state: S, frame: number) => ReactElement;

interface Lazy {
	readonly [LOAD]?: () => Promise<unknown>;
}

/** What a `load` resolved to that is neither a view nor a module whose default export is one: a programming error. */
const NO_VIEW = (resolved: unknown): string => {
	const exports =
		typeof resolved === "object" && resolved !== null ? Object.keys(resolved).filter((key) => key !== "default") : [];
	const found =
		typeof resolved === "object" && resolved !== null
			? `a module with no default export that is a function${exports.length === 0 ? "" : ` (it exports ${exports.join(", ")})`}`
			: `${resolved === null ? "null" : typeof resolved}`;
	return `@effected/cli/ui: CliUi.lazyView's load resolved to ${found}; it must resolve to the view, (state, frame) => ReactElement, or to a module whose default export is the view`;
};

/**
 * `CliUi.lazyView`: a `render` that draws with what `load` resolves to, loaded on first use: the render itself, or a
 * module whose default export it is. The loader runs once: again after an import that failed, but never after one that
 * resolved to no view, which is a programming error that fails every run the same way. Calling the render before it
 * has loaded is a defect, since only `CliUi.live` knows to load it first.
 *
 * @internal
 */
export const lazyView = <S>(
	load: () => Promise<LiveRender<S> | { readonly default: LiveRender<S> }>,
): LiveRender<S> => {
	let loaded: LiveRender<S> | undefined;
	let pending: Promise<unknown> | undefined;
	const ensure = (): Promise<unknown> => {
		pending ??= load().then(
			(resolved: unknown) => {
				const view =
					typeof resolved === "function"
						? resolved
						: typeof resolved === "object" && resolved !== null
							? (resolved as { readonly default?: unknown }).default
							: undefined;
				// Not retried: the module is what it is, so the same clear error stands for every run.
				if (typeof view !== "function") throw new Error(NO_VIEW(resolved));
				loaded = view as LiveRender<S>;
			},
			(error: unknown) => {
				// A failed load is tried again by the next run, rather than failing every run after it.
				pending = undefined;
				throw error;
			},
		);
		return pending;
	};
	const render: LiveRender<S> = (state, frame) => {
		if (loaded === undefined) throw new Error(NOT_LOADED);
		return loaded(state, frame);
	};
	return Object.assign(render, { [LOAD]: ensure });
};

/**
 * Load a lazy view's module before its render is first called; nothing for a render that is not lazy. Fails with what
 * the import failed with.
 *
 * @internal
 */
export const loadView = (render: unknown): Effect.Effect<void, unknown> => {
	const ensure = (render as Lazy)[LOAD];
	return ensure === undefined
		? Effect.void
		: Effect.asVoid(Effect.tryPromise({ try: ensure, catch: (error) => error }));
};
