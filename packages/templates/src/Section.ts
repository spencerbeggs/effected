import { Schema } from "effect";
import { CommentStyle } from "./CommentStyle.js";

/**
 * The name identifying a managed section, as it literally appears in the
 * file's markers.
 *
 * @remarks
 * Keys are **case-sensitive** and rendered verbatim: the key a consumer
 * declares is the key the marker carries. A file already containing
 * `SAVVY-LINT` markers is managed by declaring the key `"SAVVY-LINT"`.
 *
 * The character set is bounded so a key can always be read back out of a
 * marker unambiguously — whitespace in particular would make the scanner's
 * key capture ambiguous against the marker phrase that follows it.
 *
 * This is a checked string rather than a branded one **deliberately**: a
 * brand would force every call site through a decode step to spell
 * `SectionId.make({ key: "example-tool", … })`, and the validation a brand
 * would carry is already enforced by the check at construction.
 *
 * @public
 */
export const SectionKey = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/));

/**
 * What identifies a managed section inside a document: its key and the
 * comment style its markers are written in.
 *
 * @remarks
 * `commentStyle` is **required, with no default**. A defaulted style is how a
 * caller who forgets the argument writes `#` markers into a TypeScript file —
 * a syntax error in the user's own source, produced silently by an omission.
 *
 * @example
 * ```ts
 * import { CommentStyle, SectionId } from "@effected/templates";
 *
 * const ToolSection = SectionId.make({
 *   key: "example-tool",
 *   commentStyle: CommentStyle.hash,
 * });
 *
 * const block = ToolSection.section("echo hello");
 * ```
 *
 * @public
 */
export class SectionId extends Schema.Class<SectionId>("SectionId")({
	/** The section's name, exactly as it appears in the markers. */
	key: SectionKey,
	/** How this section's markers are commented out. */
	commentStyle: CommentStyle,
}) {
	/** Pair this identity with the content a tool wants inside it. */
	section(content: string): Section {
		return Section.make({ key: this.key, commentStyle: this.commentStyle, content });
	}
}

/**
 * A managed section: an identity plus the content its owner wants between the
 * markers.
 *
 * @remarks
 * Equality is **structural and whitespace-significant**. The v3 model this
 * replaces compared trimmed, whitespace-collapsed content, which silently
 * swallowed any template change that altered only indentation — the change
 * compared equal, reported `Unchanged`, and never reached the file. The one
 * normalization this package applies is to line endings, and it happens at
 * parse time rather than inside equality, so `Equal.equals` stays honest for
 * a consumer comparing two sections directly.
 *
 * @public
 */
export class Section extends Schema.Class<Section>("Section")({
	/** The section's name, exactly as it appears in the markers. */
	key: SectionKey,
	/** How this section's markers are commented out. */
	commentStyle: CommentStyle,
	/** Everything between the markers, exclusive of the boundary line breaks. */
	content: Schema.String,
}) {
	/** This section's identity, without its content. */
	get id(): SectionId {
		return SectionId.make({ key: this.key, commentStyle: this.commentStyle });
	}

	/** The same section carrying different content. */
	withContent(content: string): Section {
		return Section.make({ key: this.key, commentStyle: this.commentStyle, content });
	}
}

/**
 * A managed section as found in a document, carrying the span it occupies.
 *
 * @remarks
 * `start` and `end` bound the **whole** block, from the first character of
 * the begin marker to one past the last character of the end marker, so
 * `text.slice(start, end)` is exactly the block as written. `line` is 1-based
 * and points at the begin marker, which is what a diagnostic needs.
 *
 * @public
 */
export class PlacedSection extends Schema.Class<PlacedSection>("PlacedSection")({
	/** The section, with line endings already normalized to `\n`. */
	section: Section,
	/** Offset of the begin marker's first character. */
	start: Schema.Number,
	/** Offset one past the end marker's last character. */
	end: Schema.Number,
	/** 1-based line of the begin marker. */
	line: Schema.Number,
}) {}
