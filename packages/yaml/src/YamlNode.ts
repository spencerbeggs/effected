// The mutually-recursive YAML AST: YamlScalar, YamlMap, YamlSeq, YamlPair,
// YamlAlias and the YamlNode union, co-located in one module to break the
// import cycle inherent in the recursive node types.
//
// Nodes deliberately carry no parent pointers (circular references would
// break structural equality, serialization and Schema encode/decode). Child
// relationships are expressed via `items`/`key`/`value`, and the recursive
// types are handled with `Schema.suspend`.

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
 * Referenced by the {@link YamlScalar} `chomp` field schema.
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
export class YamlScalar extends Schema.TaggedClass<YamlScalar>()("YamlScalar", {
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
}) {
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
		return nodeToValue(this, anchors, defaultBudget());
	}
}

/**
 * A YAML alias AST node, referencing a previously defined anchor by name
 * (without the leading `*`).
 *
 * @public
 */
export class YamlAlias extends Schema.TaggedClass<YamlAlias>()("YamlAlias", {
	name: Schema.String,
	offset: Schema.Number,
	length: Schema.Number,
}) {
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
		return nodeToValue(this, anchors, defaultBudget());
	}
}

/**
 * A discriminated-union schema covering all four YAML AST value node types:
 * {@link YamlScalar}, {@link YamlMap}, {@link YamlSeq} and {@link YamlAlias}.
 * Defined lazily via `Schema.suspend` to break the recursive reference chain
 * `YamlNode → YamlMap → YamlPair → YamlNode`.
 *
 * @remarks
 * Construct member nodes via their `.make(...)` static (e.g.
 * `YamlScalar.make(...)`), never `new YamlScalar(...)` — the internal
 * composer's hot-path `new` construction is the one recorded exception, kept
 * internal to the engine for its allocation-sensitive walk.
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
 * A YAML key-value pair AST node, representing one entry within a mapping.
 * `value` is `null` when absent (e.g. `key:` with no value).
 *
 * @public
 */
export class YamlPair extends Schema.TaggedClass<YamlPair>()("YamlPair", {
	key: Schema.suspend((): Schema.Schema<YamlNode> => YamlNode),
	value: Schema.NullOr(Schema.suspend((): Schema.Schema<YamlNode> => YamlNode)),
	comment: Schema.optionalKey(Schema.String),
}) {}

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
export class YamlMap extends Schema.TaggedClass<YamlMap>()("YamlMap", {
	items: Schema.Array(Schema.suspend((): Schema.Schema<YamlPair> => YamlPair)),
	tag: Schema.optionalKey(Schema.String),
	anchor: Schema.optionalKey(Schema.String),
	style: CollectionStyle,
	comment: Schema.optionalKey(Schema.String),
	sourceMultiline: Schema.optionalKey(Schema.Boolean),
	offset: Schema.Number,
	length: Schema.Number,
}) {
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
		return nodeToValue(this, anchors, defaultBudget());
	}
}

/**
 * A YAML sequence AST node, representing an ordered list of
 * {@link (YamlNode:type)} values.
 *
 * @public
 */
export class YamlSeq extends Schema.TaggedClass<YamlSeq>()("YamlSeq", {
	items: Schema.Array(Schema.suspend((): Schema.Schema<YamlNode> => YamlNode)),
	tag: Schema.optionalKey(Schema.String),
	anchor: Schema.optionalKey(Schema.String),
	style: CollectionStyle,
	comment: Schema.optionalKey(Schema.String),
	sourceMultiline: Schema.optionalKey(Schema.Boolean),
	offset: Schema.Number,
	length: Schema.Number,
}) {
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
		return nodeToValue(this, anchors, defaultBudget());
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

/**
 * Thrown by the value-extraction walk when alias expansion materializes more
 * output nodes than the budget allows — the YAML "billion laughs" guard. A
 * chain of aliases each referencing the previous (`a2: [*a1×10]`, `a3:
 * [*a2×10]`, …) multiplies output size exponentially while the alias-*token*
 * count stays small, so the composer's per-token `maxAliasCount` limit does
 * not catch it; only bounding the expanded node count does.
 *
 * Not re-exported from the package entry point (`index.ts`) — the facade
 * catches it and materializes a fatal `AliasCountExceeded` `YamlParseError`
 * (or, for `Yaml.equals`, treats the input as malformed).
 */
export class AliasExpansionBudgetExceeded extends Error {
	constructor(limit: number) {
		super(`Alias expansion exceeded budget of ${limit} nodes`);
		this.name = "AliasExpansionBudgetExceeded";
	}
}

/**
 * Multiplier converting a `maxAliasCount` budget into a cap on the number of
 * output nodes materialized *through alias expansion*. Deliberately generous:
 * alias-free content never ticks the counter (see {@link nodeToValue}), so a
 * large but benign document — or a single alias referencing a large alias-free
 * block — stays far under the cap, while an exponential alias chain accumulates
 * across the shared budget and trips it long before the heap is exhausted.
 */
const ALIAS_EXPANSION_FACTOR = 10_000;

/** The output-node cap for a given `maxAliasCount`. */
export function aliasExpansionLimit(maxAliasCount: number): number {
	return (maxAliasCount + 1) * ALIAS_EXPANSION_FACTOR;
}

/** Default cap for a direct `toValue()` call, matching the default `maxAliasCount` of 100. */
const DEFAULT_ALIAS_EXPANSION_LIMIT = aliasExpansionLimit(100);

/** Mutable counter carried through one value-extraction walk. */
interface ExpansionBudget {
	count: number;
	readonly limit: number;
}

/** A fresh default budget for a direct `toValue()` call. */
function defaultBudget(): ExpansionBudget {
	return { count: 0, limit: DEFAULT_ALIAS_EXPANSION_LIMIT };
}

/**
 * Value extraction with an explicit alias-expansion budget derived from
 * `maxAliasCount`. The facade drives this so a `maxAliasCount` from parse
 * options bounds the "billion laughs" expansion; throws
 * {@link AliasExpansionBudgetExceeded} when the cap is exceeded. Not
 * re-exported from the package entry point.
 */
export function nodeToJsValue(node: YamlNode | null, anchors: Map<string, YamlNode>, maxAliasCount: number): unknown {
	return nodeToValue(node, anchors, { count: 0, limit: aliasExpansionLimit(maxAliasCount) });
}

function nodeToValue(
	node: YamlNode | null,
	anchors?: Map<string, YamlNode>,
	budget?: ExpansionBudget,
	counting = false,
): unknown {
	if (node === null) return null;
	// Count only nodes materialized *through* an alias expansion (counting=true).
	// Alias-free content never ticks the counter, so large but benign documents
	// are not falsely rejected; an exponential alias chain accumulates across the
	// shared budget and trips the cap before the heap is exhausted.
	if (counting && budget !== undefined) {
		budget.count++;
		if (budget.count > budget.limit) {
			throw new AliasExpansionBudgetExceeded(budget.limit);
		}
	}
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
				// Resolving an alias key enters alias expansion → count its subtree.
				key = resolved !== undefined ? String(nodeToValue(resolved, anchors, budget, true) ?? "") : "";
			} else {
				key = "";
			}
			setOwnProperty(result, key, nodeToValue(pair.value, anchors, budget, counting));
		}
		return result;
	}
	if (node instanceof YamlSeq) return node.items.map((item) => nodeToValue(item, anchors, budget, counting));
	if (node instanceof YamlAlias) {
		const resolved = anchors?.get(node.name);
		// Resolving an alias enters alias expansion → count the resolved subtree.
		return resolved !== undefined ? nodeToValue(resolved, anchors, budget, true) : null;
	}
	return null;
}
