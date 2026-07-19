/**
 * CommonMark and GFM markdown parse, edit and transform schemas for Effect.
 *
 * @remarks
 * The parse surface covers CommonMark 0.31.2 and the GFM dialect (tables,
 * strikethrough, autolink literals, task-list items and footnotes; `gfm` is
 * the default dialect): {@link Markdown} (the `parseResult` primitive, the
 * `parse` Effect and the `MarkdownFromString` codec), {@link MarkdownDocument}
 * (source, tree, diagnostics, definitions), the mdast-shaped node classes, and
 * {@link MarkdownDiagnostic}. Edit/format, the mdast projection, the visitor
 * and frontmatter arrive in later phases.
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
	Delete,
	Emphasis,
	EmphasisChar,
	FenceChar,
	FlowContent,
	FootnoteDefinition,
	FootnoteReference,
	Frontmatter,
	FrontmatterContent,
	FrontmatterFormat,
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
	RowContent,
	Strong,
	Table,
	TableAlign,
	TableCell,
	TableContent,
	TableRow,
	Text,
	ThematicBreak,
	ThematicBreakChar,
} from "./MarkdownNode.js";
