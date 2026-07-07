/**
 * The mutually-recursive YAML AST: {@link YamlScalar}, {@link YamlMap},
 * {@link YamlSeq}, {@link YamlPair}, {@link YamlAlias} and the
 * {@link (YamlNode:type)} union, co-located in one module to break the import
 * cycle inherent in the recursive node types.
 *
 * Nodes deliberately carry no parent pointers (circular references would break
 * structural equality, serialization and Schema encode/decode). Child
 * relationships are expressed via `items`/`key`/`value`, and the recursive
 * types are handled with `Schema.suspend`.
 *
 * Construct via `YamlScalar.make(...)` etc., never `new YamlScalar(...)` —
 * the internal composer's hot-path `new` construction is the one recorded
 * exception.
 *
 * @packageDocumentation
 */

import { Option, Schema } from "effect";
import type { YamlPath } from "./YamlEdit.js";

/**
 * YAML scalar presentation styles.
 *
 * @public
 */
export const ScalarStyle = Schema.Literals([
	"plain",
	"single-quoted",
	"double-quoted",
	"block-literal",
	"block-folded",
]);

/**
 * The union of all scalar style string literals.
 *
 * @public
 */
export type ScalarStyle = typeof ScalarStyle.Type;

/**
 * YAML collection presentation styles.
 *
 * @public
 */
export const CollectionStyle = Schema.Literals(["block", "flow"]);

/**
 * The union of all collection style string literals.
 *
 * @public
 */
export type CollectionStyle = typeof CollectionStyle.Type;

/**
 * Block-scalar chomping indicators (`-` strip, default clip, `+` keep).
 * Referenced by the {@link YamlScalar} field schema; exported only so the
 * `@public` base annotations can name it. Not meant to be referenced directly.
 *
 * @public
 */
export const ScalarChomp = Schema.Literals(["strip", "clip", "keep"]);

/**
 * The union of all block-scalar chomping indicator string literals.
 *
 * @public
 */
export type ScalarChomp = typeof ScalarChomp.Type;

/**
 * Schema-generated base class backing {@link YamlScalar}. Not meant to be
 * referenced directly — named and exported only so API Extractor can resolve
 * the heritage clause of the class it backs.
 *
 * @public
 */
export const YamlScalar_base: Schema.Class<
	YamlScalar,
	Schema.TaggedStruct<
		"YamlScalar",
		{
			readonly value: typeof Schema.Unknown;
			readonly tag: Schema.optionalKey<typeof Schema.String>;
			readonly style: typeof ScalarStyle;
			readonly anchor: Schema.optionalKey<typeof Schema.String>;
			readonly comment: Schema.optionalKey<typeof Schema.String>;
			readonly chomp: Schema.optionalKey<typeof ScalarChomp>;
			readonly raw: Schema.optionalKey<typeof Schema.String>;
			readonly sourceMultiline: Schema.optionalKey<typeof Schema.Boolean>;
			readonly offset: typeof Schema.Number;
			readonly length: typeof Schema.Number;
		}
	>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.TaggedClass's own `Brand = {}` default
	{}
> = Schema.TaggedClass<YamlScalar>()("YamlScalar", {
	value: Schema.Unknown,
	tag: Schema.optionalKey(Schema.String),
	style: ScalarStyle,
	anchor: Schema.optionalKey(Schema.String),
	comment: Schema.optionalKey(Schema.String),
	chomp: Schema.optionalKey(ScalarChomp),
	raw: Schema.optionalKey(Schema.String),
	sourceMultiline: Schema.optionalKey(Schema.Boolean),
	offset: Schema.Number,
	length: Schema.Number,
});

/**
 * A YAML scalar AST node, representing a leaf value such as a string,
 * number, boolean, or null.
 *
 * - `value` — the resolved JavaScript value (null, boolean, number, bigint or
 *   string).
 * - `style` — the scalar presentation style in the source document.
 * - `tag` — optional explicit YAML tag (e.g. `!!str`, `!!int`).
 * - `anchor` — optional anchor name for aliasing.
 * - `comment` — optional trailing or leading comment text.
 * - `chomp` — block-scalar chomping indicator, when the scalar is a block
 *   scalar.
 * - `raw` — the raw source text, preserved when it differs from the resolved
 *   value in a way stringification needs to know about.
 * - `sourceMultiline` — `true` when the source span covers two or more lines;
 *   absent on synthetic nodes.
 * - `offset` / `length` — the node's span in the source.
 *
 * @public
 */
export class YamlScalar extends YamlScalar_base {
	/**
	 * Navigate to a descendant by path (string segments for mapping keys,
	 * numbers for sequence indices). `Option.none()` when any segment cannot
	 * be resolved. Pure.
	 */
	find(path: YamlPath): Option.Option<YamlNode> {
		return findByPath(this, path);
	}

	/**
	 * Find the deepest node whose span contains `offset` (half-open interval),
	 * or `Option.none()` when the offset falls outside this subtree. Pure.
	 */
	findAtOffset(offset: number): Option.Option<YamlNode> {
		return findDeepestAtOffset(this, offset);
	}

	/**
	 * Return the path from this node to the given descendant node (matched by
	 * reference identity), or `Option.none()` when it is not in this subtree.
	 * The inverse of {@link YamlScalar.find}. Pure.
	 */
	pathOf(node: YamlNode): Option.Option<YamlPath> {
		return pathToNode(this, node);
	}

	/**
	 * Reconstruct the plain JavaScript value of this subtree. Aliases resolve
	 * through `anchors` (anchors encountered during the walk register
	 * incrementally, so an alias sees the most recent definition at its point
	 * of use); unresolvable aliases yield `null`. Pure and total.
	 */
	toValue(anchors?: Map<string, YamlNode>): unknown {
		return nodeToValue(this, anchors);
	}
}

/**
 * Schema-generated base class backing {@link YamlAlias}. Not meant to be
 * referenced directly — named and exported only so API Extractor can resolve
 * the heritage clause of the class it backs.
 *
 * @public
 */
export const YamlAlias_base: Schema.Class<
	YamlAlias,
	Schema.TaggedStruct<
		"YamlAlias",
		{
			readonly name: typeof Schema.String;
			readonly offset: typeof Schema.Number;
			readonly length: typeof Schema.Number;
		}
	>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.TaggedClass's own `Brand = {}` default
	{}
> = Schema.TaggedClass<YamlAlias>()("YamlAlias", {
	name: Schema.String,
	offset: Schema.Number,
	length: Schema.Number,
});

/**
 * A YAML alias AST node, referencing a previously defined anchor by name
 * (without the leading `*`).
 *
 * @public
 */
export class YamlAlias extends YamlAlias_base {
	/** See `YamlScalar.find`. Pure. */
	find(path: YamlPath): Option.Option<YamlNode> {
		return findByPath(this, path);
	}

	/** See `YamlScalar.findAtOffset`. Pure. */
	findAtOffset(offset: number): Option.Option<YamlNode> {
		return findDeepestAtOffset(this, offset);
	}

	/** See `YamlScalar.pathOf`. Pure. */
	pathOf(node: YamlNode): Option.Option<YamlPath> {
		return pathToNode(this, node);
	}

	/** See `YamlScalar.toValue`. Pure and total. */
	toValue(anchors?: Map<string, YamlNode>): unknown {
		return nodeToValue(this, anchors);
	}
}

/**
 * A discriminated-union schema covering all four YAML AST value node types:
 * {@link YamlScalar}, {@link YamlMap}, {@link YamlSeq} and {@link YamlAlias}.
 * Defined lazily via `Schema.suspend` to break the recursive reference chain
 * `YamlNode → YamlMap → YamlPair → YamlNode`.
 *
 * @public
 */
export const YamlNode: Schema.Schema<YamlScalar | YamlMap | YamlSeq | YamlAlias> = Schema.suspend(() =>
	Schema.Union([YamlScalar, YamlMap, YamlSeq, YamlAlias]),
);

/**
 * The union of all YAML AST value node types.
 *
 * @public
 */
export type YamlNode = YamlScalar | YamlMap | YamlSeq | YamlAlias;

/**
 * Schema-generated base class backing {@link YamlPair}. Not meant to be
 * referenced directly — named and exported only so API Extractor can resolve
 * the heritage clause of the class it backs. The recursive `key`/`value`
 * fields are annotated as `Schema.Schema<YamlNode>` (not `typeof YamlNode`)
 * to keep the mutual references resolvable without a circular type error.
 *
 * @public
 */
export const YamlPair_base: Schema.Class<
	YamlPair,
	Schema.TaggedStruct<
		"YamlPair",
		{
			readonly key: Schema.suspend<Schema.Schema<YamlNode>>;
			readonly value: Schema.NullOr<Schema.suspend<Schema.Schema<YamlNode>>>;
			readonly comment: Schema.optionalKey<typeof Schema.String>;
		}
	>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.TaggedClass's own `Brand = {}` default
	{}
> = Schema.TaggedClass<YamlPair>()("YamlPair", {
	key: Schema.suspend((): Schema.Schema<YamlNode> => YamlNode),
	value: Schema.NullOr(Schema.suspend((): Schema.Schema<YamlNode> => YamlNode)),
	comment: Schema.optionalKey(Schema.String),
});

/**
 * A YAML key-value pair AST node, representing one entry within a mapping.
 * `value` is `null` when absent (e.g. `key:` with no value).
 *
 * @public
 */
export class YamlPair extends YamlPair_base {}

/**
 * Schema-generated base class backing {@link YamlMap}. Not meant to be
 * referenced directly — named and exported only so API Extractor can resolve
 * the heritage clause of the class it backs.
 *
 * @public
 */
export const YamlMap_base: Schema.Class<
	YamlMap,
	Schema.TaggedStruct<
		"YamlMap",
		{
			readonly items: Schema.$Array<Schema.suspend<Schema.Schema<YamlPair>>>;
			readonly tag: Schema.optionalKey<typeof Schema.String>;
			readonly anchor: Schema.optionalKey<typeof Schema.String>;
			readonly style: typeof CollectionStyle;
			readonly comment: Schema.optionalKey<typeof Schema.String>;
			readonly sourceMultiline: Schema.optionalKey<typeof Schema.Boolean>;
			readonly offset: typeof Schema.Number;
			readonly length: typeof Schema.Number;
		}
	>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.TaggedClass's own `Brand = {}` default
	{}
> = Schema.TaggedClass<YamlMap>()("YamlMap", {
	items: Schema.Array(Schema.suspend((): Schema.Schema<YamlPair> => YamlPair)),
	tag: Schema.optionalKey(Schema.String),
	anchor: Schema.optionalKey(Schema.String),
	style: CollectionStyle,
	comment: Schema.optionalKey(Schema.String),
	sourceMultiline: Schema.optionalKey(Schema.Boolean),
	offset: Schema.Number,
	length: Schema.Number,
});

/**
 * A YAML mapping AST node, representing a collection of {@link YamlPair}
 * entries.
 *
 * - `style` — the presentation style: `"block"` or `"flow"`.
 * - `sourceMultiline` — `true` when the source span covers two or more lines;
 *   used by the canonical stringifier. Absent on synthetic nodes.
 *
 * @public
 */
export class YamlMap extends YamlMap_base {
	/** See `YamlScalar.find`. Pure. */
	find(path: YamlPath): Option.Option<YamlNode> {
		return findByPath(this, path);
	}

	/** See `YamlScalar.findAtOffset`. Pure. */
	findAtOffset(offset: number): Option.Option<YamlNode> {
		return findDeepestAtOffset(this, offset);
	}

	/** See `YamlScalar.pathOf`. Pure. */
	pathOf(node: YamlNode): Option.Option<YamlPath> {
		return pathToNode(this, node);
	}

	/** See `YamlScalar.toValue`. Pure and total. */
	toValue(anchors?: Map<string, YamlNode>): unknown {
		return nodeToValue(this, anchors);
	}
}

/**
 * Schema-generated base class backing {@link YamlSeq}. Not meant to be
 * referenced directly — named and exported only so API Extractor can resolve
 * the heritage clause of the class it backs.
 *
 * @public
 */
export const YamlSeq_base: Schema.Class<
	YamlSeq,
	Schema.TaggedStruct<
		"YamlSeq",
		{
			readonly items: Schema.$Array<Schema.suspend<Schema.Schema<YamlNode>>>;
			readonly tag: Schema.optionalKey<typeof Schema.String>;
			readonly anchor: Schema.optionalKey<typeof Schema.String>;
			readonly style: typeof CollectionStyle;
			readonly comment: Schema.optionalKey<typeof Schema.String>;
			readonly sourceMultiline: Schema.optionalKey<typeof Schema.Boolean>;
			readonly offset: typeof Schema.Number;
			readonly length: typeof Schema.Number;
		}
	>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.TaggedClass's own `Brand = {}` default
	{}
> = Schema.TaggedClass<YamlSeq>()("YamlSeq", {
	items: Schema.Array(Schema.suspend((): Schema.Schema<YamlNode> => YamlNode)),
	tag: Schema.optionalKey(Schema.String),
	anchor: Schema.optionalKey(Schema.String),
	style: CollectionStyle,
	comment: Schema.optionalKey(Schema.String),
	sourceMultiline: Schema.optionalKey(Schema.Boolean),
	offset: Schema.Number,
	length: Schema.Number,
});

/**
 * A YAML sequence AST node, representing an ordered list of
 * {@link (YamlNode:type)} values.
 *
 * @public
 */
export class YamlSeq extends YamlSeq_base {
	/** See `YamlScalar.find`. Pure. */
	find(path: YamlPath): Option.Option<YamlNode> {
		return findByPath(this, path);
	}

	/** See `YamlScalar.findAtOffset`. Pure. */
	findAtOffset(offset: number): Option.Option<YamlNode> {
		return findDeepestAtOffset(this, offset);
	}

	/** See `YamlScalar.pathOf`. Pure. */
	pathOf(node: YamlNode): Option.Option<YamlPath> {
		return pathToNode(this, node);
	}

	/** See `YamlScalar.toValue`. Pure and total. */
	toValue(anchors?: Map<string, YamlNode>): unknown {
		return nodeToValue(this, anchors);
	}
}

// ── Shared method implementations ───────────────────────────────────────────
// Module-level so the four union classes share one body each. Declared after
// the classes; function declarations hoist.

function findByPath(root: YamlNode, path: YamlPath): Option.Option<YamlNode> {
	let current: YamlNode | null = root;

	for (const segment of path) {
		if (current === null) {
			return Option.none();
		}

		if (typeof segment === "string") {
			// Navigate by key — requires a YamlMap
			if (!(current instanceof YamlMap)) {
				return Option.none();
			}
			const pair: YamlPair | undefined = current.items.find(
				(p: YamlPair) => p.key instanceof YamlScalar && typeof p.key.value === "string" && p.key.value === segment,
			);
			if (!pair || pair.value === null) {
				return Option.none();
			}
			current = pair.value;
		} else {
			// Navigate by index — requires a YamlSeq
			if (!(current instanceof YamlSeq)) {
				return Option.none();
			}
			const item: YamlNode | undefined = current.items[segment];
			if (item === undefined) {
				return Option.none();
			}
			current = item;
		}
	}

	return current === null ? Option.none() : Option.some(current);
}

/**
 * Half-open interval test `[offset, offset + length)` so a cursor positioned
 * immediately after a node is NOT considered inside it.
 */
function containsOffset(node: YamlNode, offset: number): boolean {
	return offset >= node.offset && offset < node.offset + node.length;
}

function findDeepestAtOffset(node: YamlNode, offset: number): Option.Option<YamlNode> {
	if (!containsOffset(node, offset)) {
		return Option.none();
	}

	if (node instanceof YamlMap) {
		for (const pair of node.items) {
			const keyResult = findDeepestAtOffset(pair.key, offset);
			if (Option.isSome(keyResult)) return keyResult;
			if (pair.value !== null) {
				const valResult = findDeepestAtOffset(pair.value, offset);
				if (Option.isSome(valResult)) return valResult;
			}
		}
	}

	if (node instanceof YamlSeq) {
		for (const item of node.items) {
			const itemResult = findDeepestAtOffset(item, offset);
			if (Option.isSome(itemResult)) return itemResult;
		}
	}

	// This node contains the offset but no child does — this is the deepest
	return Option.some(node);
}

function pathToNode(root: YamlNode, target: YamlNode): Option.Option<YamlPath> {
	const path: Array<string | number> = [];
	return descendToNode(root, target, path) ? Option.some(path) : Option.none();
}

/**
 * Depth-first identity search accumulating mapping-key/sequence-index
 * segments. Only scalar string keys produce navigable segments (matching
 * `find`); descendants reachable only through complex keys are not
 * addressable by path.
 */
function descendToNode(node: YamlNode, target: YamlNode, path: Array<string | number>): boolean {
	if (node === target) {
		return true;
	}

	if (node instanceof YamlMap) {
		for (const pair of node.items) {
			if (pair.key instanceof YamlScalar && typeof pair.key.value === "string") {
				if (pair.key === target) {
					path.push(pair.key.value);
					return true;
				}
				if (pair.value !== null) {
					path.push(pair.key.value);
					if (descendToNode(pair.value, target, path)) {
						return true;
					}
					path.pop();
				}
			}
		}
	}

	if (node instanceof YamlSeq) {
		for (let i = 0; i < node.items.length; i++) {
			const item = node.items[i] as YamlNode;
			path.push(i);
			if (descendToNode(item, target, path)) {
				return true;
			}
			path.pop();
		}
	}

	return false;
}

/** Set a mapping key as an own data property — `__proto__` included. */
function setOwnProperty(obj: Record<string, unknown>, key: string, value: unknown): void {
	if (key === "__proto__") {
		// Own data property, not a prototype mutation — matches JSON.parse
		// semantics and the jsonc precedent.
		Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
	} else {
		obj[key] = value;
	}
}

function nodeToValue(node: YamlNode | null, anchors?: Map<string, YamlNode>): unknown {
	if (node === null) return null;
	// Register this node's anchor incrementally so aliases resolve to the most
	// recent anchor at the point of reference (not the last definition in the
	// entire document).
	if (anchors !== undefined && !(node instanceof YamlAlias) && node.anchor !== undefined) {
		anchors.set(node.anchor, node);
	}
	if (node instanceof YamlScalar) return node.value;
	if (node instanceof YamlMap) {
		const result: Record<string, unknown> = {};
		for (const pair of node.items) {
			let key: string;
			if (pair.key instanceof YamlScalar) {
				// Register key anchor before resolving value
				if (anchors !== undefined && pair.key.anchor !== undefined) {
					anchors.set(pair.key.anchor, pair.key);
				}
				key = String(pair.key.value ?? "");
			} else if (pair.key instanceof YamlAlias) {
				const resolved = anchors?.get(pair.key.name);
				key = resolved !== undefined ? String(nodeToValue(resolved, anchors) ?? "") : "";
			} else {
				key = "";
			}
			setOwnProperty(result, key, nodeToValue(pair.value, anchors));
		}
		return result;
	}
	if (node instanceof YamlSeq) return node.items.map((item) => nodeToValue(item, anchors));
	if (node instanceof YamlAlias) {
		const resolved = anchors?.get(node.name);
		return resolved !== undefined ? nodeToValue(resolved, anchors) : null;
	}
	return null;
}
