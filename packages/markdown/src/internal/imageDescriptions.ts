// An image's description — the inline content between its brackets — kept
// beside the tree, not in it.
//
// An mdast image has no children: its bracket content flattens to the `alt`
// string, and the node classes keep that shape. The inline pass still builds
// the content as nodes before it flattens them, so it hands each image's
// content here instead of discarding it, and the description is materialized
// on first request. A side table keyed by node identity, like the document's
// line index: it describes the source, so it is no part of any node's schema,
// equality or encoded form.
//
// Lazy on purpose. Materializing every image's description at parse time would
// cost every document with images, and would put an image's content under the
// nesting cap where today it only ever flattens: an input the parse accepts
// would start refusing. A description deeper than the cap reads as absent.

import type { PhrasingContent } from "../MarkdownNode.js";
import { isGuardExceeded } from "./carriers.js";

const descriptions = new WeakMap<object, () => ReadonlyArray<PhrasingContent>>();
const materialized = new WeakMap<object, ReadonlyArray<PhrasingContent> | undefined>();

/** Record how to materialize `image`'s description. Called by the inline pass. */
export const registerImageDescription = (image: object, describe: () => ReadonlyArray<PhrasingContent>): void => {
	descriptions.set(image, describe);
};

/**
 * `image`'s description as phrasing content, materialized once; `undefined`
 * for a node the parse did not produce, or a description nesting past the
 * hardening cap.
 */
export const imageDescriptionOf = (image: object): ReadonlyArray<PhrasingContent> | undefined => {
	if (materialized.has(image)) return materialized.get(image);
	const describe = descriptions.get(image);
	if (describe === undefined) return undefined;
	let content: ReadonlyArray<PhrasingContent> | undefined;
	try {
		content = describe();
	} catch (caught) {
		if (!isGuardExceeded(caught)) throw caught;
		content = undefined;
	}
	materialized.set(image, content);
	descriptions.delete(image);
	return content;
};
