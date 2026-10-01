import type { FunctionComponent, ReactElement } from "react";
import { fromReact } from "./ink.js";

/**
 * Props of {@link holder}.
 *
 * @internal
 */
export interface HolderProps {
	/** The element to show first. */
	readonly initial: ReactElement;
	/** Receives the function that swaps the shown element, once the holder has mounted. */
	readonly bind: (swap: (next: ReactElement) => void) => void;
}

/**
 * A component that shows one element and lets its owner swap it in place.
 *
 * @remarks
 * Everything above the holder stays mounted across a swap: the screen's error boundary, its context, the root keys
 * and the colour hold. Only the held subtree changes, so the screen's `ScreenControl` keeps meaning the same screen.
 * The swap function is handed over in a layout effect, before the first frame is written. Built on the loaded React,
 * like every kit component; the screen harness's `rerender` uses it, and a live view can swap frames the same way.
 *
 * @internal
 */
export const holder: () => FunctionComponent<HolderProps> = fromReact((react) => {
	const Holder = (props: HolderProps): ReactElement => {
		const [element, setElement] = react.useState<ReactElement>(props.initial);
		react.useLayoutEffect(() => props.bind(setElement), [props.bind]);
		return element;
	};
	Holder.displayName = "CliUiHolder";
	return Holder;
});
