/**
 * CommonMark and GFM markdown parse, edit and transform schemas for Effect.
 *
 * @remarks
 * P1 ships the CommonMark 0.31.2 parse surface: {@link Markdown} (the
 * `parseResult` primitive, the `parse` Effect and the `MarkdownFromString`
 * codec), {@link MarkdownDocument} (source, tree, diagnostics, definitions),
 * the mdast-shaped node classes, and {@link MarkdownDiagnostic}. Edit/format,
 * the mdast projection, the visitor and frontmatter arrive in later phases.
 *
 * @packageDocumentation
 */

export { Markdown, MarkdownDialect, MarkdownParseError, MarkdownParseOptions } from "./Markdown.js";
export { MarkdownDiagnostic, MarkdownParseErrorCode } from "./MarkdownDiagnostic.js";
export { MarkdownDocument } from "./MarkdownDocument.js";
export {
	Blockquote,
	Break,
	BreakStyle,
	BulletChar,
	Code,
	Definition,
	Emphasis,
	EmphasisChar,
	FenceChar,
	FlowContent,
	Heading,
	HeadingDepth,
	HeadingStyle,
	Html,
	Image,
	ImageReference,
	InlineCode,
	Link,
	LinkReference,
	List,
	ListContent,
	ListDelimiter,
	ListItem,
	MarkdownNode,
	Paragraph,
	PhrasingContent,
	Point,
	Position,
	ReferenceType,
	Root,
	Strong,
	Text,
	ThematicBreak,
	ThematicBreakChar,
} from "./MarkdownNode.js";
