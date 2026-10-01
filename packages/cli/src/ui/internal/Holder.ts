import type { FunctionComponent, ReactElement } from "react";
import { fromReact } from "./ink.js";

/**
 * Swaps the element a mounted {@link holder} shows; `committed`, when given, is called once React has committed it.
 *
 * @internal
 */
export type HolderSwap = (next: ReactElement, committed?: () => void) => void;

/** What the holder shows, and who is waiting for it to be committed. */
interface Shown {
	readonly element: ReactElement;
	readonly committed: (() => void) | undefined;
}

/**
 * Props of {@link holder}.
 *
 * @internal
 */
export interface HolderProps {
	/** The element to show first. */
	readonly initial: ReactElement;
	/**
	 * Receives the function that swaps the shown element once the holder has mounted, and `undefined` once it has
	 * unmounted, so its owner never swaps into a tree that is gone.
	 */
	readonly bind: (swap: HolderSwap | undefined) => void;
}

/**
 * A component that shows one element and lets its owner swap it in place.
 *
 * @remarks
 * Everything above the holder stays mounted across a swap: the screen's error boundary, its context, the root keys
 * and the colour hold. Only the held subtree changes, so the screen's `ScreenControl` keeps meaning the same screen.
 * The swap function is handed over in a layout effect, before the first frame is written, and taken back in that
 * effect's cleanup. A swap is a state update, which React commits in a microtask rather than at once, so a swap can
 * ask to be told when its element is committed: the live view waits for that before it draws on or unmounts. Built on
 * the loaded React, like every kit component; the screen harness's `rerender` and the live view's pushes use it.
 *
 * @internal
 */
export const holder: () => FunctionComponent<HolderProps> = fromReact((react) => {
	const Holder = (props: HolderProps): ReactElement => {
		const [shown, setShown] = react.useState<Shown>(() => ({ element: props.initial, committed: undefined }));
		react.useLayoutEffect(() => {
			props.bind((element, committed) => setShown({ element, committed }));
			return () => props.bind(undefined);
		}, [props.bind]);
		react.useLayoutEffect(() => shown.committed?.(), [shown]);
		return shown.element;
	};
	Holder.displayName = "CliUiHolder";
	return Holder;
});

/**
 * The owner's side of a {@link holder}: the `bind` to hand it, and the swap it bound.
 *
 * @internal
 */
export interface HolderSlot {
	/** Pass as the holder's `bind`. */
	readonly bind: HolderProps["bind"];
	/** Whether a holder is mounted and bound: the step an owner waits on before its first swap. */
	readonly isBound: () => boolean;
	/**
	 * Swap the shown element; `false`, and nothing done, when no holder is bound (not yet mounted, or unmounted).
	 * `committed` is called once React has committed the element, or at once when nothing was swapped.
	 */
	readonly swap: (next: ReactElement, committed?: () => void) => boolean;
}

/**
 * A fresh {@link HolderSlot}.
 *
 * @internal
 */
export const holderSlot = (): HolderSlot => {
	let bound: HolderSwap | undefined;
	// Waiters for a swap not yet committed: released when the holder unmounts first (a render that throws, a close).
	const pending = new Set<() => void>();
	return {
		bind: (swap) => {
			bound = swap;
			if (swap !== undefined) return;
			// Each waiter removes itself as it fires.
			for (const committed of [...pending]) committed();
		},
		isBound: () => bound !== undefined,
		swap: (next, committed) => {
			if (bound === undefined) {
				committed?.();
				return false;
			}
			if (committed === undefined) {
				bound(next);
				return true;
			}
			const once = (): void => {
				if (pending.delete(once)) committed();
			};
			pending.add(once);
			bound(next, once);
			return true;
		},
	};
};
