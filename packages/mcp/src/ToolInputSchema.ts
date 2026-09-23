import type { JsonSchema } from "effect";
import { Result } from "effect";
import { ToolFailure } from "./ToolFailure.js";

/**
 * The unknown keys found at one object level of a tool-call payload.
 *
 * @public
 */
export interface UnknownKeysLevel {
	/** Keys from the payload root to this object; empty at the root. Array positions are decimal strings. */
	readonly path: ReadonlyArray<string>;
	/** Keys the payload carries that this level does not accept, in payload order. */
	readonly unknown: ReadonlyArray<string>;
	/** Keys this level declares, in schema order. */
	readonly accepted: ReadonlyArray<string>;
}

/**
 * Options for {@link ToolInputSchema.formatUnknownKeys}.
 *
 * @public
 */
export interface FormatUnknownKeysOptions {
	/** The cap on each echoed key path, in UTF-16 code units. Defaults to `ToolFailure.ECHO_LIMIT`. */
	readonly echoLimit?: number | undefined;
}

interface Node {
	readonly [key: string]: unknown;
}

const MAX_DEPTH = 256;
const MAX_ECHOED = 20;
const DISCRIMINANTS = ["action", "kind"] as const;
const REF_PREFIX = "#/$defs/";

const isNode = (u: unknown): u is Node => typeof u === "object" && u !== null && !Array.isArray(u);

const resolveRef = (node: Node, root: Node, seen: ReadonlySet<string> = new Set()): Node => {
	const ref = node.$ref;
	if (typeof ref !== "string" || !ref.startsWith(REF_PREFIX) || seen.has(ref)) return node;
	const defs = root.$defs;
	const target = isNode(defs) ? defs[ref.slice(REF_PREFIX.length)] : undefined;
	if (!isNode(target)) return node;
	const { $ref: _ref, ...siblings } = node;
	return resolveRef({ ...target, ...siblings }, root, new Set([...seen, ref]));
};

const literalValues = (node: unknown): ReadonlyArray<unknown> | undefined => {
	if (!isNode(node)) return undefined;
	if (Array.isArray(node.enum)) return node.enum;
	return "const" in node ? [node.const] : undefined;
};

const discriminantOf = (members: ReadonlyArray<Node>): (typeof DISCRIMINANTS)[number] | undefined =>
	members.length === 0
		? undefined
		: DISCRIMINANTS.find((key) =>
				members.every((member) => isNode(member.properties) && literalValues(member.properties[key]) !== undefined),
			);

const selectMember = (members: ReadonlyArray<unknown>, value: Node, root: Node): Node | undefined => {
	const resolved = members.filter(isNode).map((member) => resolveRef(member, root));
	const key = discriminantOf(resolved);
	if (key !== undefined) {
		return resolved.find((member) => literalValues((member.properties as Node)[key])?.includes(value[key]) === true);
	}
	const objects = resolved.filter((member) => isNode(member.properties) || member.type === "object");
	return objects.length === 1 ? objects[0] : undefined;
};

const matchesPattern = (pattern: string, key: string): boolean =>
	Result.getOrUndefined(Result.try(() => new RegExp(pattern, "u").test(key))) === true;

const collect = (payload: unknown, root: Node): ReadonlyArray<UnknownKeysLevel> => {
	const out: Array<UnknownKeysLevel> = [];
	const walk = (value: unknown, raw: unknown, path: ReadonlyArray<string>, depth: number): void => {
		if (depth > MAX_DEPTH || !isNode(raw)) return;
		const node = resolveRef(raw, root);
		const parts = [
			node,
			...(Array.isArray(node.allOf) ? node.allOf.filter(isNode).map((m) => resolveRef(m, root)) : []),
		];
		const members = Array.isArray(node.oneOf) ? node.oneOf : Array.isArray(node.anyOf) ? node.anyOf : undefined;
		const additional = parts.map((part) => part.additionalProperties).find(isNode);
		const isClosed = parts.some((part) => part.additionalProperties === false);

		if (Array.isArray(value)) {
			const prefix = Array.isArray(node.prefixItems) ? node.prefixItems : [];
			if (prefix.length === 0 && !isNode(node.items) && members !== undefined) {
				const arrays = members
					.filter(isNode)
					.map((member) => resolveRef(member, root))
					.filter((member) => member.type === "array");
				if (arrays.length === 1) walk(value, arrays[0], path, depth + 1);
				return;
			}
			for (const [index, item] of value.entries()) {
				walk(item, index < prefix.length ? prefix[index] : node.items, [...path, String(index)], depth + 1);
			}
			return;
		}

		if (!isNode(value)) return;
		const declared = parts.filter((part) => isNode(part.properties));
		if (declared.length === 0) {
			if (members !== undefined) {
				const member = selectMember(members, value, root);
				if (member !== undefined) walk(value, member, path, depth + 1);
				return;
			}
			if (isClosed) {
				const unknown = Object.keys(value);
				if (unknown.length > 0) out.push({ path, unknown, accepted: [] });
				return;
			}
			if (additional !== undefined) {
				for (const key of Object.keys(value)) walk(value[key], additional, [...path, key], depth + 1);
			}
			return;
		}

		const properties = Object.assign({}, ...declared.map((part) => part.properties)) as Node;
		const patterns = parts.flatMap((part) =>
			isNode(part.patternProperties) ? Object.keys(part.patternProperties) : [],
		);
		const accepted = Object.keys(properties);
		const extra = Object.keys(value).filter(
			(key) => !Object.hasOwn(properties, key) && !patterns.some((pattern) => matchesPattern(pattern, key)),
		);
		if (extra.length > 0 && isClosed) out.push({ path, unknown: extra, accepted });
		for (const key of accepted) {
			if (Object.hasOwn(value, key)) walk(value[key], properties[key], [...path, key], depth + 1);
		}
		if (additional !== undefined) {
			for (const key of extra) walk(value[key], additional, [...path, key], depth + 1);
		}
	};
	walk(payload, root, [], 0);
	return out;
};

/**
 * Pure walkers over a tool's served JSON Schema: every unknown key at every
 * depth, a message naming them all, and an object-rooted form of a union.
 *
 * @remarks
 * Core's `Tool.Strict` rejects unknown keys but reports only the first
 * (effect `unstable/ai/McpServer.ts` decodes without `errors: "all"`), so an
 * agent fixes one typo per round trip. These walkers run over the schema core
 * actually serves, so what they accept matches what the tool advertises:
 *
 * - Only `additionalProperties: false` closes a node, as in JSON Schema; core
 *   emits it on every object node of a strict tool and `true` otherwise.
 * - `allOf` members' properties merge; `oneOf`/`anyOf` members are chosen by an
 *   `action` or `kind` literal, or by being the only object member.
 * - `items`, `prefixItems`, `$ref` into `$defs`, and `patternProperties` are
 *   followed.
 * - The payload is untrusted: the walk stops descending at depth 256 rather
 *   than overflowing the stack, so a deeper unknown key goes unreported and
 *   is left for decoding.
 *
 * @public
 */
export class ToolInputSchema {
	private constructor() {}

	/** Every level of `payload` that carries a key `schema` does not accept. */
	static readonly unknownKeys = (payload: unknown, schema: JsonSchema.JsonSchema): ReadonlyArray<UnknownKeysLevel> =>
		collect(payload, schema);

	/**
	 * `Unrecognized parameter(s): a, b.c. Accepted params: x, y.` per level. Each
	 * echoed key is truncated, and at most 20 keys and 20 levels are named.
	 */
	static readonly formatUnknownKeys = (
		levels: ReadonlyArray<UnknownKeysLevel>,
		options: FormatUnknownKeysOptions = {},
	): string => {
		const limit = options.echoLimit ?? ToolFailure.ECHO_LIMIT;
		const sentences = levels.slice(0, MAX_ECHOED).map((level) => {
			const shown = level.unknown
				.slice(0, MAX_ECHOED)
				.map((key) => ToolFailure.truncate([...level.path, key].join("."), limit));
			const more = level.unknown.length > MAX_ECHOED ? ` (and ${level.unknown.length - MAX_ECHOED} more)` : "";
			const accepted = level.accepted.length === 0 ? "(none)" : level.accepted.join(", ");
			return `Unrecognized parameter(s): ${shown.join(", ")}${more}. Accepted params: ${accepted}.`;
		});
		const hidden = levels.length > MAX_ECHOED ? ` (and ${levels.length - MAX_ECHOED} more levels)` : "";
		return `${sentences.join(" ")}${hidden}`;
	};

	/**
	 * `schema` with a root `$ref` inlined and a top-level union of objects
	 * sharing an `action`/`kind` literal rewritten to an object root carrying
	 * `type: "object"`, `oneOf` and `"x-discriminator"` — MCP requires an
	 * object root, and core dies at boot on a union root. Returned as the same value when nothing changes.
	 */
	static readonly objectRooted = (schema: JsonSchema.JsonSchema): JsonSchema.JsonSchema => {
		const root = resolveRef(schema, schema);
		const members = Array.isArray(root.anyOf) ? root.anyOf : Array.isArray(root.oneOf) ? root.oneOf : undefined;
		if (root.type === undefined && members !== undefined) {
			const resolved = members.filter(isNode).map((member) => resolveRef(member, schema));
			const key = resolved.length === members.length ? discriminantOf(resolved) : undefined;
			if (key !== undefined) {
				const { anyOf: _anyOf, oneOf: _oneOf, ...rest } = root;
				return { type: "object", ...rest, oneOf: resolved, "x-discriminator": key };
			}
		}
		return root;
	};
}
