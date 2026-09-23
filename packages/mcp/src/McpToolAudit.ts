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
	readonly requireTitle?: boolean | undefined;
	readonly requireOutputSchema?: boolean | undefined;
	/** A served `outputSchema` must be rooted at `type: "object"`. Defaults to `true` (D10). */
	readonly objectRootedOutput?: boolean | undefined;
	readonly maxDescription?: number | undefined;
	/** All four MCP annotation hints must be present as booleans. */
	readonly requireHints?: boolean | undefined;
}

interface Node {
	readonly [key: string]: unknown;
}

const isNode = (u: unknown): u is Node => typeof u === "object" && u !== null && !Array.isArray(u);
const HINTS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const;
const COMBINATORS = ["prefixItems", "anyOf", "oneOf", "allOf"] as const;

const objectNodes = (schema: JsonSchema.JsonSchema): ReadonlyArray<{ readonly path: string; readonly node: Node }> => {
	const out: Array<{ readonly path: string; readonly node: Node }> = [];
	const join = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`);
	const visit = (node: unknown, path: string): void => {
		if (!isNode(node)) return;
		if (isNode(node.properties) || node.type === "object") out.push({ path, node });
		if (isNode(node.properties)) {
			for (const [key, child] of Object.entries(node.properties)) visit(child, join(path, key));
		}
		visit(node.items, join(path, "items"));
		visit(node.additionalProperties, join(path, "additionalProperties"));
		for (const keyword of COMBINATORS) {
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

const hasCombinator = (node: Node): boolean => COMBINATORS.some((keyword) => Array.isArray(node[keyword]));

const isOpen = (node: Node): boolean =>
	node.additionalProperties !== false &&
	(isNode(node.properties) || (!hasCombinator(node) && node.type === "object" && !isNode(node.additionalProperties)));

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
 * @public
 */
export class McpToolAudit {
	private constructor() {}

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
				for (const { path, node } of objectNodes(tool.inputSchema)) {
					const where = path === "" ? "the root" : path;
					if (policy.input === "closed" && isOpen(node)) report(`input schema is open at ${where}`);
					if (policy.input === "open" && isNode(node.properties) && node.additionalProperties === false) {
						report(`input schema is closed at ${where}`);
					}
				}
			}

			const title = tool.title ?? tool.annotations?.title;
			if (policy.requireTitle === true && (typeof title !== "string" || title === "")) report("no title");
			if (policy.requireOutputSchema === true && tool.outputSchema === undefined) report("no outputSchema");
			if (
				(policy.objectRootedOutput ?? true) &&
				tool.outputSchema !== undefined &&
				tool.outputSchema.type !== "object"
			) {
				report(`outputSchema is not object-rooted (root type: ${String(tool.outputSchema.type ?? "none")})`);
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
