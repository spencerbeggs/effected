// The offset -> unist Point mapping. A Point is one-based (`line`, `column`)
// where `@effected/source`'s `LineIndex` is zero-based, so a Point's line is
// the index's line plus one and its column is the offset's distance from the
// line's start plus one, with the offset carried alongside. One index is
// built per parse (blockParser.ts, phrasing.ts) and every node's Point is a
// binary search over it.
//
// Imports only `@effected/source` and the leaf `Point` value class, the
// cycle firewall's sanctioned exception (the same import blockParser.ts and
// phrasing.ts already make).

import type { SourceIndex } from "@effected/source";
import { Point } from "../MarkdownNode.js";

/**
 * The unist `Point` of `offset` within `index`'s text: one-based `line` and
 * `column`, plus the offset itself.
 *
 * @remarks
 * The caller clamps `offset` into `[0, text.length]` first, so `offset` is
 * always the point's own offset.
 *
 * The column is `offset - lineStart(line) + 1`, NOT `positionAt(offset)`
 * plus one. The two differ at exactly one offset class, the `\n` of a
 * `\r\n`: `positionAt` reads it as the end of its line (LSP cannot name the
 * middle of a terminator), while a unist Point counts it as one column past
 * the `\r`, as `vfile-location` and `mdast-util-from-markdown` do. Node
 * positions DO land there: an empty list item before a CRLF ends at its `\n`
 * (`"*\r\na"` ends the item at offset 2, line 1, column 3), so the
 * `positionAt` form would change published positions.
 *
 * @internal
 */
export const pointAt = (index: SourceIndex, offset: number): Point => {
	const line = index.lineAt(offset);
	return Point.make({ line: line + 1, column: offset - index.lineStart(line) + 1, offset });
};
