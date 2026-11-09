import { Layout } from "@theme";
import { useMode } from "../../hooks/useMode.js";

/** A component the barrel exports. */
export function Shown(props: { readonly title: string }): unknown {
	return <div data-layout={String(Layout)} data-mode={useMode()}>{props.title}</div>;
}
