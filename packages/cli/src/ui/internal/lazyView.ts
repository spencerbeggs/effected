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

/**
 * `CliUi.lazyView`: a `render` that draws with the default export of a module loaded on first use. The loader runs
 * once (again after a failure), and calling the render before it has loaded is a defect, since only `CliUi.live`
 * knows to load it first.
 *
 * @internal
 */
export const lazyView = <S>(load: () => Promise<{ readonly default: LiveRender<S> }>): LiveRender<S> => {
	let loaded: LiveRender<S> | undefined;
	let pending: Promise<unknown> | undefined;
	const ensure = (): Promise<unknown> => {
		pending ??= load().then(
			(module) => {
				loaded = module.default;
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
