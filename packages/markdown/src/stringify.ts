/**
 * Markdown serialization without the parser: the mdast-shaped node classes,
 * `stringify` and `stringifyResult`, and the error they fail with.
 *
 * @remarks
 * For a bundle that only EMITS markdown — building a tree from the node
 * classes and serializing it, never parsing — import from this entry point.
 * Nothing it reaches loads the block pass, the inline pass or the HTML entity
 * table, so a bundler leaves all three out. The serialized bytes are exactly
 * `Markdown.stringify`'s: the root entry's statics delegate to these
 * functions, and the canonical form documented on `Markdown.stringifyResult`
 * is the same published commitment here.
 *
 * The node classes exported here are the root entry's, not copies: a tree
 * built from either import serializes and type-checks against both.
 *
 * @packageDocumentation
 */

// This module is an ENTRY POINT: API Extractor models it as its own surface,
// so every type its signatures name is re-exported here — the stringify
// functions name `Root` and `FlowContent`, which reach the whole node
// vocabulary, and `MarkdownStringifyError` carries a `MarkdownDiagnostic`.
// Its import graph must never reach the parser; `__test__/stringify-entry.test.ts`
// pins that.
export { MarkdownDiagnostic, MarkdownParseErrorCode } from "./MarkdownDiagnostic.js";
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
	MdxFlowExpression,
	MdxJsxAttribute,
	MdxJsxAttributeContent,
	MdxJsxAttributeValueExpression,
	MdxJsxExpressionAttribute,
	MdxJsxFlowElement,
	MdxJsxTextElement,
	MdxTextExpression,
	MdxjsEsm,
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
export type { MarkdownStringifyOptions } from "./MarkdownStringify.js";
export { MarkdownStringifyError, stringify, stringifyResult } from "./MarkdownStringify.js";
