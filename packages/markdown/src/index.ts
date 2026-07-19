/**
 * CommonMark and GFM markdown parse, edit and transform schemas for Effect.
 *
 * @remarks
 * The parse surface covers CommonMark 0.31.2 and the GFM dialect (tables,
 * strikethrough, autolink literals, task-list items and footnotes; `gfm` is
 * the default dialect): {@link Markdown} (the `parseResult` primitive, the
 * `parse` Effect and the `MarkdownFromString` codec), {@link MarkdownDocument}
 * (source, tree, diagnostics, definitions), the mdast-shaped node classes, and
 * {@link MarkdownDiagnostic}. Frontmatter is captured raw behind a parse
 * toggle and decoded through the free-standing codecs — `YamlFrontmatter`,
 * `TomlFrontmatter`, `JsonFrontmatter` — each peering optionally on its
 * format package. Edit/format, the mdast projection and the visitor arrive
 * in later phases.
 *
 * @packageDocumentation
 */

export type { FrontmatterCodec } from "./Frontmatter.js";
export { FrontmatterDecodeError, FrontmatterFormatMismatchError } from "./Frontmatter.js";
export { JsonFrontmatter } from "./JsonFrontmatter.js";
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
export { TomlFrontmatter } from "./TomlFrontmatter.js";
export { YamlFrontmatter } from "./YamlFrontmatter.js";
