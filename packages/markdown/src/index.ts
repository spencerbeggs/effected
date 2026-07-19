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
 * format package. The edit vocabulary (`MarkdownEdit`, `MarkdownRange` and
 * `MarkdownEdit.applyAll`) carries the cross-package offset-splice parity
 * contract; `Markdown.stringify` serializes trees canonically, and
 * `MarkdownFormat` computes marker-normalization and surgical-replacement
 * edits over it. {@link Mdast} is the remark-ecosystem interop boundary:
 * projection to plain mdast JSON and checked decoding back;
 * {@link MarkdownVisitor} streams a tree walk; and the document's navigation
 * accessors (headings, sections, links) serve outline and link extraction.
 *
 * @packageDocumentation
 */

export type { FrontmatterCodec, FrontmatterSchemaError, FrontmatterWriteError } from "./Frontmatter.js";
export {
	FrontmatterDecodeError,
	FrontmatterEncodeError,
	FrontmatterFormatMismatchError,
	FrontmatterMissingError,
	FrontmatterValidationError,
	MarkdownFrontmatter,
} from "./Frontmatter.js";
export type { FrontmatterResolveError, FrontmatterSchemaResolver } from "./FrontmatterResolver.js";
export {
	SchemaDeclaration,
	SchemaDeclarationByName,
	SchemaDeclarationByPath,
	SchemaDeclarationByUrl,
	SchemaDeclarationInline,
	SchemaDeclarationInvalidError,
	SchemaDeclarationMissingError,
	SchemaNameUnknownError,
	SchemaResolver,
	SchemaVersionUnresolvableError,
} from "./FrontmatterResolver.js";
export { JsonFrontmatter } from "./JsonFrontmatter.js";
export {
	Markdown,
	MarkdownDialect,
	MarkdownParseError,
	MarkdownParseOptions,
	MarkdownStringifyError,
} from "./Markdown.js";
export { MarkdownDiagnostic, MarkdownParseErrorCode } from "./MarkdownDiagnostic.js";
export type { DocumentHeading, DocumentLink, DocumentSection, LinkBearingNode } from "./MarkdownDocument.js";
export { MarkdownDocument } from "./MarkdownDocument.js";
export type { MarkdownPath, MarkdownSegment } from "./MarkdownEdit.js";
export { MarkdownEdit, MarkdownRange } from "./MarkdownEdit.js";
export type { MarkdownRangeLike } from "./MarkdownFormat.js";
export {
	MarkdownFormat,
	MarkdownFormattingOptions,
	MarkdownModificationError,
	MarkdownModificationErrorCode,
} from "./MarkdownFormat.js";
export type { MarkdownNodeOfType, MarkdownNodeType } from "./MarkdownNode.js";
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
export { MarkdownVisitor, MarkdownVisitorEvent } from "./MarkdownVisitor.js";
export type { MdastNode } from "./Mdast.js";
export { Mdast, MdastDecodeError } from "./Mdast.js";
export { TomlFrontmatter } from "./TomlFrontmatter.js";
export { YamlFrontmatter } from "./YamlFrontmatter.js";
