// The frontmatter capture — an offset-0 pre-scan, deliberately NOT a
// registry construct.
//
// A registry entry would give this construct powers it must never have:
// block starts can fire on any line, and frontmatter exists only as the very
// first thing in a document. The scan runs once, before the line loop, and
// on success the block pass simply starts after the closing fence. The
// captured text is raw — it never enters the inline pass, and the engine
// never decodes it (the codec modules do, over the public node).
//
// Grammar and its authorities (the fence set is deliberately closed):
// - `---` opens yaml, closed by `---` — gray-matter@4.0.3's default
//   delimiters and default language, and remark-frontmatter's yaml preset.
// - `+++` opens toml, closed by `+++` — remark-frontmatter's toml preset
//   (the markdown-ecosystem standard; mdast-util-frontmatter names the
//   `toml` node the same way).
// - `---json` opens json, closed by `---` — gray-matter's language-hint
//   form (`---<language>` after the opening delimiter) with its built-in
//   JSON engine; the closing fence is the plain delimiter, as gray-matter
//   closes it.
// - No other language hint is recognized (`---yaml`, `---toml`, `---coffee`
//   are content, not fences) — gray-matter parity is capability parity at
//   the `Frontmatter.schema` seam, not convention-for-convention emulation.
// - A fence line is exactly the fence: no leading or trailing whitespace
//   (micromark-extension-frontmatter's posture). Line terminators are
//   already stripped by the preprocessor, so CRLF sources need no special
//   casing here.
// - No closing fence, no frontmatter: the scan returns null and the
//   document parses as if the toggle were off. That is remark-frontmatter's
//   behavior too, and it is not a diagnostic — an opening fence with no
//   close IS a thematic break followed by content.

import type { FrontmatterFormat } from "../../MarkdownNode.js";
import type { SourceLine } from "../preprocess.js";

/** What the fence's opening line commits the scan to. */
interface FenceRule {
	readonly format: FrontmatterFormat;
	readonly close: string;
}

const FENCES: ReadonlyMap<string, FenceRule> = new Map([
	["---", { format: "yaml", close: "---" }],
	["+++", { format: "toml", close: "+++" }],
	["---json", { format: "json", close: "---" }],
]);

/** A successful capture: everything the parser needs to skip and materialize. */
export interface FrontmatterCapture {
	readonly format: FrontmatterFormat;
	/** Raw text between the fences — original terminators, no fence lines. */
	readonly value: string;
	/** How many source lines the block spans, both fences included. */
	readonly lineCount: number;
	/** Absolute offset of the closing fence's last character, exclusive. */
	readonly endOffset: number;
}

/**
 * Scan the head of a preprocessed document for a frontmatter block.
 *
 * `lines` is the preprocessor's line table (U+0000 already replaced,
 * terminators stripped, absolute `start` offsets); `text` is the original
 * source, consulted only for the terminators between value lines — a
 * terminator can never contain U+0000, so slicing it from the source is
 * exact, and the value keeps CRLF interiors verbatim while the line content
 * keeps the preprocessor's U+FFFD replacement.
 *
 * Returns `null` when the document has no frontmatter — which is the common
 * case and never an error.
 */
export const scanFrontmatter = (lines: ReadonlyArray<SourceLine>, text: string): FrontmatterCapture | null => {
	const opening = lines[0];
	if (opening === undefined || opening.start !== 0) {
		return null;
	}
	const rule = FENCES.get(opening.text);
	if (rule === undefined) {
		return null;
	}

	for (let index = 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (line === undefined || line.text !== rule.close) {
			continue;
		}

		const parts: string[] = [];
		for (let inner = 1; inner < index; inner += 1) {
			const current = lines[inner];
			const next = lines[inner + 1];
			if (current === undefined || next === undefined) {
				break;
			}
			parts.push(current.text);
			if (inner + 1 < index) {
				parts.push(text.slice(current.start + current.text.length, next.start));
			}
		}

		return {
			format: rule.format,
			value: parts.join(""),
			lineCount: index + 1,
			endOffset: line.start + line.text.length,
		};
	}

	return null;
};
