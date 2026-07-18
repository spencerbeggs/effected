// The mdast-shaped syntax tree. Node `type` strings and field names match the
// mdast specification (https://github.com/syntax-tree/mdast) exactly — that
// shape is a contract, not an implementation detail, so a consumer can hand a
// tree to the remark ecosystem after the `Mdast` projection strips the
// fidelity extras this module carries alongside.
//
// Two deliberate departures from plain mdast:
//
// 1. Every node carries a required `position`. unist makes it optional because
//    synthesized trees have no source; here the parser is the only producer
//    and the offset-based edit layer depends on it, so the schema enforces it.
// 2. Fidelity fields (`headingStyle`, `fenceChar`, `bulletChar`, ...) ride
//    alongside the mdast fields as `optionalKey` extras. They record concrete
//    syntax mdast throws away, which lossless editing needs.
//
// All node classes live in this one module because the tree is mutually
// recursive (flow contains flow, phrasing contains phrasing) — splitting them
// per-file would close an import cycle. Recursion is broken with the
// `Schema.suspend` idiom and recursive references are typed `Schema.Codec<T>`
// (the `packages/toml/src/TomlNode.ts` precedent).
//
// Leaf module: imports only `effect`.

import { Schema } from "effect";

/**
 * A single point in a source document: 1-based `line` and `column`, 0-based
 * `offset`.
 *
 * `offset` is the index into the source string, which is what the edit layer
 * splices against; `line`/`column` are the human-facing coordinates unist
 * specifies.
 *
 * @public
 */
export class Point extends Schema.Class<Point>("Point")({
	line: Schema.Number,
	column: Schema.Number,
	offset: Schema.Number,
}) {}

/**
 * The source span of a node: `start` inclusive, `end` exclusive.
 *
 * @public
 */
export class Position extends Schema.Class<Position>("Position")({
	start: Point,
	end: Point,
}) {}

/**
 * The explicitness of a reference, per mdast's `referenceType` enum.
 *
 * - `shortcut` — implicit, identifier inferred from the content (`[foo]`).
 * - `collapsed` — explicit, identifier inferred from the content (`[foo][]`).
 * - `full` — explicit, identifier explicitly set (`[foo][bar]`).
 *
 * @public
 */
export const ReferenceType = Schema.Literals(["shortcut", "collapsed", "full"]);

/**
 * The union of all reference-type string literals.
 *
 * @public
 */
export type ReferenceType = typeof ReferenceType.Type;

/**
 * The two ways CommonMark spells a heading: `atx` (`# Title`) and `setext`
 * (a title underlined with `=` or `-`).
 *
 * @public
 */
export const HeadingStyle = Schema.Literals(["atx", "setext"]);

/**
 * The union of all heading-style string literals.
 *
 * @public
 */
export type HeadingStyle = typeof HeadingStyle.Type;

/**
 * The two ways CommonMark spells a hard line break: a trailing backslash or
 * two-or-more trailing spaces.
 *
 * @public
 */
export const BreakStyle = Schema.Literals(["backslash", "spaces"]);

/**
 * The union of all break-style string literals.
 *
 * @public
 */
export type BreakStyle = typeof BreakStyle.Type;

/**
 * The two fence characters a fenced code block may use.
 *
 * @public
 */
export const FenceChar = Schema.Literals(["`", "~"]);

/**
 * The union of all fence-character literals.
 *
 * @public
 */
export type FenceChar = typeof FenceChar.Type;

/**
 * The three bullet characters an unordered list may use.
 *
 * @public
 */
export const BulletChar = Schema.Literals(["-", "*", "+"]);

/**
 * The union of all bullet-character literals.
 *
 * @public
 */
export type BulletChar = typeof BulletChar.Type;

/**
 * The two delimiters an ordered list marker may use (`1.` or `1)`).
 *
 * @public
 */
export const ListDelimiter = Schema.Literals([".", ")"]);

/**
 * The union of all ordered-list delimiter literals.
 *
 * @public
 */
export type ListDelimiter = typeof ListDelimiter.Type;

/**
 * The three characters a thematic break may be drawn with.
 *
 * @public
 */
export const ThematicBreakChar = Schema.Literals(["-", "_", "*"]);

/**
 * The union of all thematic-break character literals.
 *
 * @public
 */
export type ThematicBreakChar = typeof ThematicBreakChar.Type;

/**
 * The two characters emphasis and strong emphasis may be marked with.
 *
 * @public
 */
export const EmphasisChar = Schema.Literals(["*", "_"]);

/**
 * The union of all emphasis-marker character literals.
 *
 * @public
 */
export type EmphasisChar = typeof EmphasisChar.Type;

/**
 * The six legal ATX/setext heading depths.
 *
 * @public
 */
export const HeadingDepth = Schema.Literals([1, 2, 3, 4, 5, 6]);

/**
 * The union of all legal heading depths.
 *
 * @public
 */
export type HeadingDepth = typeof HeadingDepth.Type;

// --- Phrasing content -------------------------------------------------------

/**
 * Text — a run of literal characters, with entity references and backslash
 * escapes already resolved into `value`.
 *
 * @public
 */
export class Text extends Schema.Class<Text>("Text")({
	type: Schema.tag("text"),
	value: Schema.String,
	position: Position,
}) {}

/**
 * InlineCode — a code span: `foo` written between backtick fences in the
 * source. `value` holds the span's content with the backtick fence stripped
 * and the spec's space-stripping applied.
 *
 * @public
 */
export class InlineCode extends Schema.Class<InlineCode>("InlineCode")({
	type: Schema.tag("inlineCode"),
	value: Schema.String,
	position: Position,
}) {}

/**
 * Html — a fragment of raw HTML, kept verbatim. Used for both HTML blocks
 * (flow) and inline raw HTML (phrasing); the same node type serves both, as
 * mdast specifies.
 *
 * @public
 */
export class Html extends Schema.Class<Html>("Html")({
	type: Schema.tag("html"),
	value: Schema.String,
	position: Position,
}) {}

/**
 * Break — a hard line break.
 *
 * `breakStyle` is a fidelity extra recording which of the two CommonMark
 * spellings produced it.
 *
 * @public
 */
export class Break extends Schema.Class<Break>("Break")({
	type: Schema.tag("break"),
	position: Position,
	breakStyle: Schema.optionalKey(BreakStyle),
}) {}

/**
 * Image — an inline image (`![alt](url "title")`).
 *
 * @public
 */
export class Image extends Schema.Class<Image>("Image")({
	type: Schema.tag("image"),
	url: Schema.String,
	title: Schema.optionalKey(Schema.String),
	alt: Schema.optionalKey(Schema.String),
	position: Position,
}) {}

/**
 * ImageReference — an image referring to a {@link Definition} by identifier
 * (`![alt][ref]`).
 *
 * The parser emits these unresolved, whether or not a matching definition
 * exists in the tree — resolution is the consumer's business.
 *
 * @public
 */
export class ImageReference extends Schema.Class<ImageReference>("ImageReference")({
	type: Schema.tag("imageReference"),
	identifier: Schema.String,
	label: Schema.optionalKey(Schema.String),
	referenceType: ReferenceType,
	alt: Schema.optionalKey(Schema.String),
	position: Position,
}) {}

/**
 * Emphasis — `*foo*` or `_foo_`.
 *
 * `markerChar` is a fidelity extra recording which marker produced it.
 *
 * @public
 */
export class Emphasis extends Schema.Class<Emphasis>("Emphasis")({
	type: Schema.tag("emphasis"),
	children: Schema.Array(Schema.suspend((): Schema.Codec<PhrasingContent> => PhrasingContent)),
	position: Position,
	markerChar: Schema.optionalKey(EmphasisChar),
}) {}

/**
 * Strong — `**foo**` or `__foo__`.
 *
 * `markerChar` is a fidelity extra recording which marker produced it.
 *
 * @public
 */
export class Strong extends Schema.Class<Strong>("Strong")({
	type: Schema.tag("strong"),
	children: Schema.Array(Schema.suspend((): Schema.Codec<PhrasingContent> => PhrasingContent)),
	position: Position,
	markerChar: Schema.optionalKey(EmphasisChar),
}) {}

/**
 * Link — an inline link (`[text](url "title")`), including autolinks.
 *
 * @public
 */
export class Link extends Schema.Class<Link>("Link")({
	type: Schema.tag("link"),
	url: Schema.String,
	title: Schema.optionalKey(Schema.String),
	children: Schema.Array(Schema.suspend((): Schema.Codec<PhrasingContent> => PhrasingContent)),
	position: Position,
}) {}

/**
 * LinkReference — a link referring to a {@link Definition} by identifier
 * (`[text][ref]`).
 *
 * Emitted unresolved, on the same terms as {@link ImageReference}.
 *
 * @public
 */
export class LinkReference extends Schema.Class<LinkReference>("LinkReference")({
	type: Schema.tag("linkReference"),
	identifier: Schema.String,
	label: Schema.optionalKey(Schema.String),
	referenceType: ReferenceType,
	children: Schema.Array(Schema.suspend((): Schema.Codec<PhrasingContent> => PhrasingContent)),
	position: Position,
}) {}

/**
 * The union of every node that may appear where mdast expects **phrasing**
 * content — the text of a document and its markup.
 *
 * Defined lazily via `Schema.suspend` to break the recursive reference chain
 * `PhrasingContent -> Emphasis/Strong/Link/LinkReference -> PhrasingContent`.
 *
 * @public
 */
export const PhrasingContent: Schema.Codec<PhrasingContent> = Schema.suspend(() =>
	Schema.Union([Break, Emphasis, Html, Image, ImageReference, InlineCode, Link, LinkReference, Strong, Text]),
);

/**
 * The union of all phrasing-content node types.
 *
 * @public
 */
export type PhrasingContent =
	| Break
	| Emphasis
	| Html
	| Image
	| ImageReference
	| InlineCode
	| Link
	| LinkReference
	| Strong
	| Text;

// --- Flow content -----------------------------------------------------------

/**
 * ThematicBreak — a horizontal rule (`---`, `***`, `___`).
 *
 * `markerChar` is a fidelity extra recording which character drew it.
 *
 * @public
 */
export class ThematicBreak extends Schema.Class<ThematicBreak>("ThematicBreak")({
	type: Schema.tag("thematicBreak"),
	position: Position,
	markerChar: Schema.optionalKey(ThematicBreakChar),
}) {}

/**
 * Code — a code block, fenced or indented.
 *
 * `lang` and `meta` split the fence's info string at the first run of
 * whitespace. The fidelity extras `fenceChar` and `fenceLength` are present
 * for fenced blocks and **absent for indented blocks** — their absence is how
 * the two are told apart on the way back out.
 *
 * @public
 */
export class Code extends Schema.Class<Code>("Code")({
	type: Schema.tag("code"),
	value: Schema.String,
	lang: Schema.optionalKey(Schema.String),
	meta: Schema.optionalKey(Schema.String),
	position: Position,
	fenceChar: Schema.optionalKey(FenceChar),
	fenceLength: Schema.optionalKey(Schema.Number),
}) {}

/**
 * Definition — a link reference definition (`[ref]: /url "title"`).
 *
 * Kept in the tree at its source position rather than stripped, which is the
 * deliberate departure from commonmark.js and the reason references can stay
 * unresolved.
 *
 * @public
 */
export class Definition extends Schema.Class<Definition>("Definition")({
	type: Schema.tag("definition"),
	identifier: Schema.String,
	label: Schema.optionalKey(Schema.String),
	url: Schema.String,
	title: Schema.optionalKey(Schema.String),
	position: Position,
}) {}

/**
 * Paragraph — a run of phrasing content.
 *
 * @public
 */
export class Paragraph extends Schema.Class<Paragraph>("Paragraph")({
	type: Schema.tag("paragraph"),
	children: Schema.Array(Schema.suspend((): Schema.Codec<PhrasingContent> => PhrasingContent)),
	position: Position,
}) {}

/**
 * Heading — an ATX or setext heading of depth 1 to 6.
 *
 * `headingStyle` is a fidelity extra recording which spelling produced it;
 * setext headings can only be depth 1 or 2.
 *
 * @public
 */
export class Heading extends Schema.Class<Heading>("Heading")({
	type: Schema.tag("heading"),
	depth: HeadingDepth,
	children: Schema.Array(Schema.suspend((): Schema.Codec<PhrasingContent> => PhrasingContent)),
	position: Position,
	headingStyle: Schema.optionalKey(HeadingStyle),
}) {}

/**
 * ListItem — one item of a {@link List}.
 *
 * `spread` follows mdast in being optional: absent means "not known", which a
 * hand-built tree may legitimately be. The parser always sets it.
 *
 * @public
 */
export class ListItem extends Schema.Class<ListItem>("ListItem")({
	type: Schema.tag("listItem"),
	spread: Schema.optionalKey(Schema.Boolean),
	children: Schema.Array(Schema.suspend((): Schema.Codec<FlowContent> => FlowContent)),
	position: Position,
}) {}

/**
 * List — an ordered or unordered list.
 *
 * `ordered`, `start` and `spread` are all optional per mdast (absent meaning
 * "not known"); the parser always sets `ordered` and `spread`, and sets
 * `start` only for ordered lists.
 *
 * The fidelity extras record the marker actually used: `bulletChar` for
 * unordered lists, `delimiter` for ordered ones.
 *
 * @public
 */
export class List extends Schema.Class<List>("List")({
	type: Schema.tag("list"),
	ordered: Schema.optionalKey(Schema.Boolean),
	start: Schema.optionalKey(Schema.Number),
	spread: Schema.optionalKey(Schema.Boolean),
	children: Schema.Array(Schema.suspend((): Schema.Codec<ListItem> => ListItem)),
	position: Position,
	bulletChar: Schema.optionalKey(BulletChar),
	delimiter: Schema.optionalKey(ListDelimiter),
}) {}

/**
 * Blockquote — a section quoted from somewhere else.
 *
 * @public
 */
export class Blockquote extends Schema.Class<Blockquote>("Blockquote")({
	type: Schema.tag("blockquote"),
	children: Schema.Array(Schema.suspend((): Schema.Codec<FlowContent> => FlowContent)),
	position: Position,
}) {}

/**
 * The union of every node that may appear where mdast expects **flow**
 * content — the sections of a document.
 *
 * Defined lazily via `Schema.suspend` to break the recursive reference chain
 * `FlowContent -> Blockquote/List -> FlowContent`.
 *
 * @public
 */
export const FlowContent: Schema.Codec<FlowContent> = Schema.suspend(() =>
	Schema.Union([Blockquote, Code, Definition, Heading, Html, List, Paragraph, ThematicBreak]),
);

/**
 * The union of all flow-content node types. Includes mdast's `Content`
 * category (`Definition | Paragraph`) inline, as the spec's `FlowContent`
 * definition does.
 *
 * @public
 */
export type FlowContent = Blockquote | Code | Definition | Heading | Html | List | Paragraph | ThematicBreak;

/**
 * The union of every node that may appear where mdast expects **list**
 * content. A one-member union, kept because mdast names the category and
 * later dialects widen it.
 *
 * @public
 */
export const ListContent: Schema.Codec<ListContent> = Schema.suspend(() => ListItem);

/**
 * The union of all list-content node types.
 *
 * @public
 */
export type ListContent = ListItem;

// --- Root -------------------------------------------------------------------

/**
 * Root — a whole document, and the only node that is never a child.
 *
 * mdast leaves a root's content model open; a parsed markdown document is
 * always flow content, which is what this schema requires.
 *
 * @public
 */
export class Root extends Schema.Class<Root>("Root")({
	type: Schema.tag("root"),
	children: Schema.Array(Schema.suspend((): Schema.Codec<FlowContent> => FlowContent)),
	position: Position,
}) {}

/**
 * The union of every mdast node type this package produces — the four content
 * categories plus {@link Root}.
 *
 * @public
 */
export type MarkdownNode = Root | FlowContent | ListContent | PhrasingContent;

/**
 * A schema matching any node in the tree.
 *
 * @public
 */
export const MarkdownNode: Schema.Codec<MarkdownNode> = Schema.suspend(() =>
	Schema.Union([Root, FlowContent, ListContent, PhrasingContent]),
);
