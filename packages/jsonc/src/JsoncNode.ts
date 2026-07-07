/**
 * The recursive JSONC AST node and the path vocabulary used to navigate it.
 *
 * `JsoncNode` is a `Schema.Class` with a `Schema.suspend` self-reference for
 * `children`; it deliberately carries no parent pointers (circular references
 * would break structural equality, serialization and Schema encode/decode).
 * Navigation methods (`find`, `findAtOffset`, `pathAt`) walk `children`
 * locally and return `Option`, never a `NotFound` error. Value extraction
 * (`toValue`) is a pure total function per the package Effect-wrapping policy.
 *
 * @packageDocumentation
 */

import { Option, Schema } from "effect";

/**
 * A single path segment: a `string` for object property keys or a `number`
 * for array indices.
 *
 * @public
 */
export type JsoncSegment = string | number;

/**
 * An ordered sequence of {@link JsoncSegment} values describing a location
 * within a JSONC document tree.
 *
 * @public
 */
export type JsoncPath = ReadonlyArray<JsoncSegment>;

/**
 * Discriminator values for JSONC AST node types: the JSON value types
 * (`string`/`number`/`boolean`/`null`), the structural types
 * (`object`/`array`) and the `property` key-value pair type.
 *
 * @public
 */
export const JsoncNodeType = Schema.Literals(["object", "array", "property", "string", "number", "boolean", "null"]);

/**
 * The union of all JSONC AST node type string literals.
 *
 * @public
 */
export type JsoncNodeType = typeof JsoncNodeType.Type;

/**
 * Schema-generated base class backing {@link JsoncNode}. Not meant to be
 * referenced directly — named and exported only so API Extractor can resolve
 * the heritage clause of the class it backs. The recursive `children` field is
 * annotated as `Schema.Schema<JsoncNode>` (not `typeof JsoncNode`) to keep the
 * self-reference resolvable without a circular type error.
 *
 * @public
 */
export const JsoncNode_base: Schema.Class<
	JsoncNode,
	Schema.Struct<{
		readonly type: typeof JsoncNodeType;
		readonly offset: typeof Schema.Number;
		readonly length: typeof Schema.Number;
		readonly value: Schema.optionalKey<typeof Schema.Unknown>;
		readonly colonOffset: Schema.optionalKey<typeof Schema.Number>;
		readonly children: Schema.optionalKey<Schema.$Array<Schema.suspend<Schema.Schema<JsoncNode>>>>;
	}>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.Class's own `Inherited = {}` default
	{}
> = Schema.Class<JsoncNode>("JsoncNode")({
	type: JsoncNodeType,
	offset: Schema.Number,
	length: Schema.Number,
	value: Schema.optionalKey(Schema.Unknown),
	colonOffset: Schema.optionalKey(Schema.Number),
	children: Schema.optionalKey(Schema.Array(Schema.suspend((): Schema.Schema<JsoncNode> => JsoncNode))),
});

/**
 * An immutable JSONC AST node produced by `Jsonc.parseTree`.
 *
 * The `parent` field present in Microsoft's `jsonc-parser` is intentionally
 * omitted: circular references would break structural equality, serialization
 * and Schema encode/decode. Child relationships are expressed via `children`,
 * and the recursive type is handled with `Schema.suspend`.
 *
 * - `type` — the `JsoncNodeType` discriminator.
 * - `offset` / `length` — the node's span in the source (tight token-end
 *   discipline: spans never swallow trailing whitespace or comments).
 * - `value` — the decoded JS value for leaf nodes; omitted for structural nodes.
 * - `colonOffset` — for `property` nodes, the offset of the `:` separator.
 * - `children` — child nodes for `object`, `array` and `property` nodes.
 *
 * Construct via `JsoncNode.make(...)`, never `new JsoncNode(...)`.
 *
 * @public
 */
export class JsoncNode extends JsoncNode_base {
	/**
	 * Find a descendant node by path. String segments navigate object
	 * properties; number segments navigate array indices. Returns
	 * `Option.none()` when any segment cannot be resolved. Pure.
	 */
	find(path: JsoncPath): Option.Option<JsoncNode> {
		let current: JsoncNode | undefined = this;

		for (const segment of path) {
			if (current?.children === undefined) {
				return Option.none();
			}
			if (typeof segment === "string") {
				if (current.type !== "object") return Option.none();
				const property: JsoncNode | undefined = current.children.find(
					(child) => child.type === "property" && child.children !== undefined && child.children[0]?.value === segment,
				);
				current = property?.children?.[1];
			} else {
				if (current.type !== "array") return Option.none();
				current = current.children[segment];
			}
		}

		return current !== undefined ? Option.some(current) : Option.none();
	}

	/**
	 * Find the innermost node whose span covers `offset`, or `Option.none()`
	 * if the offset is outside this subtree. Pure.
	 */
	findAtOffset(offset: number): Option.Option<JsoncNode> {
		if (offset < this.offset || offset >= this.offset + this.length) {
			return Option.none();
		}
		if (this.children === undefined) {
			return Option.some(this);
		}
		for (const child of this.children) {
			if (offset >= child.offset && offset < child.offset + child.length) {
				return child.findAtOffset(offset);
			}
		}
		return Option.some(this);
	}

	/**
	 * Return the JSON path to the innermost node covering `offset`, or
	 * `Option.none()` if the offset is outside this subtree. The inverse of
	 * {@link JsoncNode.find}. Pure.
	 */
	pathAt(offset: number): Option.Option<JsoncPath> {
		return buildPath(this, offset, []);
	}

	/**
	 * Reconstruct the plain JavaScript value represented by this subtree. Pure
	 * and total — never fails, so no `Effect` wrapper.
	 */
	toValue(): unknown {
		return evaluateNode(this);
	}
}

function buildPath(node: JsoncNode, targetOffset: number, currentPath: Array<JsoncSegment>): Option.Option<JsoncPath> {
	if (targetOffset < node.offset || targetOffset >= node.offset + node.length) {
		return Option.none();
	}
	if (node.children === undefined) {
		return Option.some(currentPath);
	}
	if (node.type === "object") {
		for (const prop of node.children) {
			if (
				prop.type === "property" &&
				prop.children !== undefined &&
				targetOffset >= prop.offset &&
				targetOffset < prop.offset + prop.length
			) {
				const key = prop.children[0]?.value as string;
				const valuePath = [...currentPath, key];
				const valueChild = prop.children[1];
				if (
					valueChild !== undefined &&
					targetOffset >= valueChild.offset &&
					targetOffset < valueChild.offset + valueChild.length
				) {
					return buildPath(valueChild, targetOffset, valuePath);
				}
				return Option.some(valuePath);
			}
		}
	} else if (node.type === "array") {
		for (let i = 0; i < node.children.length; i++) {
			const child = node.children[i];
			if (targetOffset >= child.offset && targetOffset < child.offset + child.length) {
				return buildPath(child, targetOffset, [...currentPath, i]);
			}
		}
	}
	return Option.some(currentPath);
}

function evaluateNode(node: JsoncNode): unknown {
	switch (node.type) {
		case "object": {
			const obj: Record<string, unknown> = {};
			if (node.children !== undefined) {
				for (const prop of node.children) {
					if (prop.type === "property" && prop.children !== undefined && prop.children.length === 2) {
						const key = prop.children[0].value as string;
						const value = evaluateNode(prop.children[1]);
						if (key === "__proto__") {
							// Own data property, not a prototype mutation — matches the value
							// parser and JSON.parse semantics.
							Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
						} else {
							obj[key] = value;
						}
					}
				}
			}
			return obj;
		}
		case "array":
			return (node.children ?? []).map(evaluateNode);
		case "property":
			return node.children?.[1] !== undefined ? evaluateNode(node.children[1]) : undefined;
		default:
			return node.value;
	}
}
