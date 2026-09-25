import type { JsonSchema } from "effect";
import type { ServedTool } from "./McpWire.js";

/**
 * The policy {@link McpToolAudit.check} enforces.
 *
 * @public
 */
export interface McpToolAuditPolicy {
	/** `"closed"`: every object node rejects unknown keys. `"open"`: none with properties does. `"any"`: not checked. */
	readonly input: "open" | "closed" | "any";
	/** Every tool must carry a non-empty `title`, top-level or in `annotations.title`. */
	readonly requireTitle?: boolean | undefined;
	/**
	 * Every tool must serve an `outputSchema`. The stateful revisions drop a
	 * non-object one, so check the revision you serve; the violation names
	 * the likely cause, a union success schema, and `ToolOutputSchema.objectRooted`.
	 */
	readonly requireOutputSchema?: boolean | undefined;
	/**
	 * A served `outputSchema` must be rooted at `type: "object"`. Defaults to
	 * `true` (D10). Only the stateless revision serves a non-object root, so
	 * only there does this fire; a union root (`anyOf` or `oneOf`) names
	 * `ToolOutputSchema.objectRooted` as the fix. On a stateful revision the
	 * same schema is dropped, and `requireOutputSchema` reports it instead.
	 */
	readonly objectRootedOutput?: boolean | undefined;
	/** The longest `description` allowed, in UTF-16 code units; a missing description counts as 0. */
	readonly maxDescription?: number | undefined;
	/** All four MCP annotation hints must be present as booleans. */
	readonly requireHints?: boolean | undefined;
}

interface Node {
	readonly [key: string]: unknown;
}

const isNode = (u: unknown): u is Node => typeof u === "object" && u !== null && !Array.isArray(u);
const HINTS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const;
/** Real branches whose members are separate object shapes, each worth its own report. `allOf` is not one of these: core emits it to merge keywords (declared `properties` plus a Record's `additionalProperties`) onto the SAME node, never to introduce a sibling shape. */
const BRANCHES = ["prefixItems", "anyOf", "oneOf"] as const;

interface ObjectNode {
	readonly path: string;
	/** Declared keys, folded in from every `allOf` member that carries a `properties` keyword. */
	readonly properties: Node | undefined;
	/**
	 * `true` iff this node — or any `allOf` member merged onto it — sets
	 * `additionalProperties: false`. Per JSON Schema, and matching
	 * `ToolInputSchema`'s documented rule: only an explicit `false` closes a
	 * node. Missing, `true`, or a schema value all leave it open.
	 */
	readonly closed: boolean;
}

const objectNodes = (schema: JsonSchema.JsonSchema): ReadonlyArray<ObjectNode> => {
	const out: Array<ObjectNode> = [];
	const join = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`);
	const visit = (node: unknown, path: string): void => {
		if (!isNode(node)) return;
		// `allOf` members from core are keyword-merge artifacts on THIS node, not a nested or sibling shape.
		const merged: ReadonlyArray<Node> = Array.isArray(node.allOf) ? [node, ...node.allOf.filter(isNode)] : [node];
		const declaredParts = merged.filter((part) => isNode(part.properties));
		// A null-prototype merge across EVERY part's `properties`, the same way `ToolInputSchema.ts`
		// folds `allOf` members: a single `.find` only sees the FIRST part's declared keys, so a
		// second allOf branch's properties (an ordinary hand-authored `allOf: [Base, Extension]`
		// idiom, even though core never emits it) go both unreported and unvisited.
		const properties: Node | undefined =
			declaredParts.length === 0
				? undefined
				: declaredParts.reduce<Record<string, unknown>>((acc, part) => {
						for (const [key, child] of Object.entries(part.properties as Node)) acc[key] = child;
						return acc;
					}, Object.create(null));
		const closed = merged.some((part) => part.additionalProperties === false);
		if (isNode(properties) || merged.some((part) => part.type === "object")) out.push({ path, properties, closed });

		if (isNode(properties)) {
			for (const [key, child] of Object.entries(properties)) visit(child, join(path, key));
		}
		visit(node.items, join(path, "items"));
		visit(node.additionalProperties, join(path, "additionalProperties"));
		for (const keyword of BRANCHES) {
			const list = node[keyword];
			if (Array.isArray(list)) {
				for (const [index, child] of list.entries()) visit(child, join(path, `${keyword}[${index}]`));
			}
		}
		if (isNode(node.$defs)) {
			for (const [key, child] of Object.entries(node.$defs)) visit(child, `$defs.${key}`);
		}
	};
	visit(schema, "");
	return out;
};

/**
 * A pure sweep over a served `tools/list` that returns every policy
 * violation, as `"<tool>: <what>"` strings.
 *
 * @remarks
 * Run it against what a real server serves (`McpHarness.listTools`), not
 * against your own schemas: the served document is what a client sees, and
 * it differs by protocol revision. The stateless `2026-07-28` adapter passes a
 * non-object output through, while the stateful adapters drop it — which is
 * why `objectRootedOutput` defaults to `true`.
 *
 * `"closed"` is only as sound as the walk. It follows `properties`,
 * `items`, a schema-valued `additionalProperties`, `prefixItems`, `anyOf`,
 * `oneOf` and `$defs`, and merges an `allOf` member's `properties` and
 * `additionalProperties: false` onto its node. It does not visit
 * `patternProperties` values, an `allOf` member's `items` or
 * `additionalProperties` schema, or an `allOf` nested inside another; and
 * a key declared in two `allOf` members is last-write-wins. A hand-authored
 * or `Tool.dynamic` schema can therefore pass `"closed"` with an open node
 * the walk never reached. Core-emitted strict schemas close every node, so
 * a strict `Tool.make` tool is reported faithfully.
 *
 * @public
 */
export class McpToolAudit {
	private constructor() {}

	/**
	 * Every violation of `policy` across `tools`, as `"<tool>: <what>"`, in
	 * tool order. Empty means the sweep passed. A duplicate tool name is
	 * reported under every policy, `input: "any"` included.
	 */
	static readonly check = (tools: ReadonlyArray<ServedTool>, policy: McpToolAuditPolicy): ReadonlyArray<string> => {
		const violations: Array<string> = [];
		const seen = new Set<string>();
		for (const tool of tools) {
			const report = (what: string): void => {
				violations.push(`${tool.name}: ${what}`);
			};
			if (seen.has(tool.name)) report("duplicate tool name");
			seen.add(tool.name);

			if (policy.input !== "any") {
				for (const { path, properties, closed } of objectNodes(tool.inputSchema)) {
					const where = path === "" ? "the root" : path;
					if (policy.input === "closed" && !closed) report(`input schema is open at ${where}`);
					if (policy.input === "open" && isNode(properties) && closed) report(`input schema is closed at ${where}`);
				}
			}

			const title = tool.title ?? tool.annotations?.title;
			if (policy.requireTitle === true && (typeof title !== "string" || title === "")) report("no title");
			if (policy.requireOutputSchema === true && tool.outputSchema === undefined)
				report(
					"no outputSchema (a union success schema is dropped on stateful revisions; see ToolOutputSchema.objectRooted)",
				);
			if (
				(policy.objectRootedOutput ?? true) &&
				tool.outputSchema !== undefined &&
				tool.outputSchema.type !== "object"
			) {
				const union = Array.isArray(tool.outputSchema.anyOf) || Array.isArray(tool.outputSchema.oneOf);
				report(
					`outputSchema is not object-rooted (root type: ${String(tool.outputSchema.type ?? "none")})${
						union ? "; wrap the union success schema in ToolOutputSchema.objectRooted" : ""
					}`,
				);
			}

			const length = (tool.description ?? "").length;
			if (policy.maxDescription !== undefined && length > policy.maxDescription) {
				report(`description is ${length} characters, over the ${policy.maxDescription} limit`);
			}

			if (policy.requireHints === true) {
				const missing = HINTS.filter((hint) => typeof tool.annotations?.[hint] !== "boolean");
				if (missing.length > 0) report(`missing annotation hints: ${missing.join(", ")}`);
			}
		}
		return violations;
	};
}
