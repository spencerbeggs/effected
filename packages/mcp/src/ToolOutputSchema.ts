import { Schema, SchemaAST } from "effect";

const MARK = "~effected/mcp/objectRooted";

/** Always passes; contributes `type: "object"` beside whatever the node already emits. */
const objectRoot = Schema.makeFilter<unknown>(() => true, {
	[MARK]: true,
	toJsonSchema: () => ({ type: "object" }),
});

const isObjectRooted = (ast: SchemaAST.AST): boolean =>
	ast.checks?.some((check) => check.annotations?.[MARK] === true) === true;

/**
 * Shaping for a tool's `success` schema, so the `outputSchema` core serves
 * is one every client accepts.
 *
 * @remarks
 * MCP requires a tool's `outputSchema` to be rooted in an object, and a
 * top-level `Schema.Union` emits a bare `anyOf`. Core drops such an
 * `outputSchema` from `tools/list` on the stateful revisions and serves it
 * verbatim on the stateless one, where strict clients reject it.
 * `McpToolAudit`'s `objectRootedOutput` check reports it either way.
 *
 * {@link ToolOutputSchema.objectRooted} is the fix. It works on the Effect
 * schema, not on JSON Schema — unlike `ToolInputSchema.objectRooted`, which
 * rewrites the served input document of a `Tool.dynamic`.
 *
 * @public
 */
export class ToolOutputSchema {
	private constructor() {}

	/**
	 * `schema` with `type: "object"` added beside the `anyOf` at its JSON
	 * Schema root, through a check that always passes. Decoding, encoding and
	 * the schema's type are unchanged.
	 *
	 * @remarks
	 * Order against `.annotate({ identifier })` does not matter. A check added
	 * after an identifier starts a new node that would drop the definition
	 * name, so the identifier the schema already resolves is carried onto the
	 * new check, and the served documents are equal either way (key order
	 * can differ when the schema carries a title or description). Applying it
	 * twice is a no-op.
	 *
	 * Every union member must be an object shape: the added `type: "object"`
	 * is a claim about the whole union, and nothing checks it.
	 *
	 * @example
	 * ```ts
	 * const Result = ToolOutputSchema.objectRooted(Schema.Union([Found, Missing])).annotate({ identifier: "Result" })
	 * Tool.make("lookup", { parameters, success: Result })
	 * ```
	 */
	static readonly objectRooted = <S extends Schema.Top>(schema: S): S => {
		if (isObjectRooted(schema.ast)) return schema;
		const identifier = SchemaAST.resolveIdentifier(schema.ast);
		const checked = schema.check(objectRoot);
		return (identifier === undefined ? checked : checked.annotate({ identifier })) as S;
	};
}
