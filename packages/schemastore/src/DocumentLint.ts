import { JsonPointer, Predicate, Schema } from "effect";
import { MAX_NESTING_DEPTH } from "./internal/limits.js";
import { KeywordFamilies } from "./KeywordFamilies.js";
import type { StoreDocument } from "./StoreDocument.js";

/**
 * A structural lint finding over an assembled document: a value in a
 * report, never an error channel — a document with findings is still a
 * document, and the consumer decides what a finding gates.
 *
 * @public
 */
export class DocumentLintFinding extends Schema.Class<DocumentLintFinding>("DocumentLintFinding")({
	/** Which check fired. */
	check: Schema.Literals(["UnresolvedRef", "UnknownKeyword", "DescriptionWithoutUrl", "DepthExceeded"]),
	/** `"warning"` for structural defects, `"advisory"` for best practices. */
	severity: Schema.Literals(["warning", "advisory"]),
	/** JSON pointer into the flat document (`""` is the root schema). */
	path: Schema.String,
	/** Human-readable explanation. */
	message: Schema.String,
}) {}

// Draft-07 keywords, plus `$defs` (the Draft-07-valid alias the SchemaStore
// document shape keeps its pool under).
const DRAFT_07_KEYWORDS = new Set([
	"$comment",
	"$defs",
	"$id",
	"$ref",
	"$schema",
	"additionalItems",
	"additionalProperties",
	"allOf",
	"anyOf",
	"const",
	"contains",
	"contentEncoding",
	"contentMediaType",
	"default",
	"definitions",
	"dependencies",
	"description",
	"else",
	"enum",
	"examples",
	"exclusiveMaximum",
	"exclusiveMinimum",
	"format",
	"if",
	"items",
	"maxItems",
	"maxLength",
	"maxProperties",
	"maximum",
	"minItems",
	"minLength",
	"minProperties",
	"minimum",
	"multipleOf",
	"not",
	"oneOf",
	"pattern",
	"patternProperties",
	"properties",
	"propertyNames",
	"readOnly",
	"required",
	"then",
	"title",
	"type",
	"uniqueItems",
	"writeOnly",
]);

const URL_LINE = /^https?:\/\/\S+$/;

interface LintContext {
	readonly defs: Readonly<Record<string, unknown>>;
	readonly findings: Array<DocumentLintFinding>;
}

// The pointer a local `$ref` names, decoded exactly the way ajv resolves
// it: split on `/`, then percent-decode and pointer-unescape each token.
// That covers every token core emits (`encodeURI(escapeToken(name))`, e.g.
// `My%20Foo~1BarEncoded` for the class identifier `My Foo/BarEncoded`) and
// the unencoded shapes a hand-assembled or read-back document may carry
// (a raw space, non-ASCII, `#`, `|`, `{}`), refusing only malformed
// percent-encoding — which ajv refuses too. `JsonPointer.parseUriFragment`
// is deliberately not used here: it rejects those unencoded shapes, and it
// percent-decodes before splitting, so `a%2Fb` tokenizes as two segments
// where the engine sees one.
const localPointer = (ref: string): ReadonlyArray<string> | undefined => {
	if (!ref.startsWith("#/")) {
		return undefined;
	}
	try {
		return ref
			.slice(2)
			.split("/")
			.map((token) => JsonPointer.unescapeToken(decodeURIComponent(token)));
	} catch {
		return undefined;
	}
};

// Subpath refs (`#/$defs/Thing/properties/inner`) resolve on their first
// pool segment.
const checkRef = (value: unknown, path: string, context: LintContext): void => {
	if (typeof value !== "string") {
		return;
	}
	if (value === "#") {
		return;
	}
	const pointer = localPointer(value);
	if (
		pointer !== undefined &&
		pointer.length >= 2 &&
		pointer[0] === "$defs" &&
		Object.hasOwn(context.defs, pointer[1])
	) {
		return;
	}
	context.findings.push(
		DocumentLintFinding.make({
			check: "UnresolvedRef",
			severity: "warning",
			path,
			message: `$ref "${value}" does not resolve against the document's $defs pool`,
		}),
	);
};

// The node whose `description` is the document's: the root, or — when the
// root is exactly a bare local `$ref` into the pool (the `Schema.Class`
// shape) — the `$defs` entry it names, because that is where assembly
// places a root annotation (`StoreDocumentOptions.rootAnnotations`). The
// `$ref` token is decoded the same way `checkRef` resolves it, so a
// pointer-escaped, percent-encoded or unencoded name resolves.
const describedNode = (
	document: StoreDocument,
): { readonly node: Readonly<Record<string, unknown>>; readonly path: string } | undefined => {
	const keys = Object.keys(document.root);
	if (keys.length !== 1 || keys[0] !== "$ref" || typeof document.root.$ref !== "string") {
		return { node: document.root, path: "" };
	}
	const pointer = localPointer(document.root.$ref);
	if (pointer === undefined || pointer.length !== 2 || pointer[0] !== "$defs") {
		return { node: document.root, path: "" };
	}
	const name = pointer[1] as string;
	const entry = Object.hasOwn(document.defs, name) ? document.defs[name] : undefined;
	return Predicate.isObject(entry) ? { node: entry, path: `/$defs/${JsonPointer.escapeToken(name)}` } : undefined;
};

// Walks one schema node, keyword-position aware: descends only into
// positions the Draft-07 grammar defines as schemas (or schema maps /
// schema arrays), so property NAMES and data-position values (`enum`,
// `const`, `default`, `examples`) are never mistaken for keywords.
const lintSchema = (node: unknown, path: string, depth: number, context: LintContext): void => {
	if (!Predicate.isObject(node)) {
		// Draft-07 boolean schemas (`true`/`false`) are legal leaves.
		return;
	}
	if (depth >= MAX_NESTING_DEPTH) {
		context.findings.push(
			DocumentLintFinding.make({
				check: "DepthExceeded",
				severity: "warning",
				path,
				message: `schema nests deeper than ${MAX_NESTING_DEPTH} levels; lint did not descend further`,
			}),
		);
		return;
	}
	for (const [key, value] of Object.entries(node)) {
		const keyPath = `${path}/${JsonPointer.escapeToken(key)}`;
		if (!DRAFT_07_KEYWORDS.has(key) && !KeywordFamilies.isDeclared(key)) {
			context.findings.push(
				DocumentLintFinding.make({
					check: "UnknownKeyword",
					severity: "warning",
					path: keyPath,
					message: `"${key}" is not a Draft-07 keyword or a declared non-standard family (x-taplo*, x-tombi-*, x-intellij-*, x-ai-*, vscode); ajv strict mode rejects it`,
				}),
			);
			continue;
		}
		switch (key) {
			case "$ref":
				checkRef(value, keyPath, context);
				break;
			case "properties":
			case "patternProperties":
			case "$defs":
			case "definitions": {
				if (Predicate.isObject(value)) {
					for (const [name, subschema] of Object.entries(value)) {
						lintSchema(subschema, `${keyPath}/${JsonPointer.escapeToken(name)}`, depth + 1, context);
					}
				}
				break;
			}
			case "dependencies": {
				// Values are either schemas or arrays of property names.
				if (Predicate.isObject(value)) {
					for (const [name, dependency] of Object.entries(value)) {
						if (!Array.isArray(dependency)) {
							lintSchema(dependency, `${keyPath}/${JsonPointer.escapeToken(name)}`, depth + 1, context);
						}
					}
				}
				break;
			}
			case "items": {
				if (Array.isArray(value)) {
					value.forEach((subschema, index) => {
						lintSchema(subschema, `${keyPath}/${index}`, depth + 1, context);
					});
				} else {
					lintSchema(value, keyPath, depth + 1, context);
				}
				break;
			}
			case "additionalItems":
			case "additionalProperties":
			case "propertyNames":
			case "contains":
			case "if":
			case "then":
			case "else":
			case "not":
				lintSchema(value, keyPath, depth + 1, context);
				break;
			case "allOf":
			case "anyOf":
			case "oneOf": {
				if (Array.isArray(value)) {
					value.forEach((subschema, index) => {
						lintSchema(subschema, `${keyPath}/${index}`, depth + 1, context);
					});
				}
				break;
			}
			default:
				// Leaf keywords (`enum`, `const`, `default`, `examples`,
				// `type`, ...) carry data, not schemas: never descended.
				break;
		}
	}
};

/**
 * Owned structural checks over an assembled {@link StoreDocument} — the
 * always-available half of the validation story (a real-engine gate like
 * ajv strict mode stays at the consumer's edge):
 *
 * - `UnresolvedRef` — every `$ref` resolves against the `$defs` pool
 *   (`#` self-refs allowed; anything else, including a surviving
 *   `#/definitions/...` pointer, is a warning).
 * - `UnknownKeyword` — no keyword outside Draft-07 plus the declared
 *   non-standard families ({@link KeywordFamilies}: `x-taplo*`, `x-tombi-*`,
 *   `x-intellij-*`, `x-ai-*` and the vscode set), which ajv strict mode would reject.
 * - `DescriptionWithoutUrl` — advisory: SchemaStore's description
 *   convention ends the root description with a docs URL line. Read from
 *   the root, or from the `$defs` entry a bare local `$ref` root names —
 *   where assembly places a root annotation.
 *
 * Tractable because the input is the bounded {@link StoreDocument} shape,
 * not because assembly built it: the warning checks earn their keep on a
 * document the pipeline did not build — hand-assembled through
 * `StoreDocument.draft07`, or read back off disk. A local `$defs` pointer
 * is decoded the way ajv decodes it, so no `$ref` into the pool that the
 * engine gate resolves is reported `UnresolvedRef`; a `#/definitions/...`
 * pointer stays a warning on purpose, since the pool lives under `$defs`.
 * This is not a general JSON Schema validator.
 *
 * @public
 */
export class DocumentLint {
	private constructor() {}

	/**
	 * Runs every check; total — hostile nesting degrades to a
	 * `DepthExceeded` finding rather than an error.
	 */
	static lint(document: StoreDocument): ReadonlyArray<DocumentLintFinding> {
		const context: LintContext = { defs: document.defs, findings: [] };
		lintSchema(document.root, "", 0, context);
		for (const [name, definition] of Object.entries(document.defs)) {
			lintSchema(definition, `/$defs/${JsonPointer.escapeToken(name)}`, 1, context);
		}
		const described = describedNode(document);
		const description = described?.node.description;
		if (typeof description === "string") {
			const lines = description.split("\n");
			const last = lines[lines.length - 1] ?? "";
			if (!URL_LINE.test(last.trim())) {
				context.findings.push(
					DocumentLintFinding.make({
						check: "DescriptionWithoutUrl",
						severity: "advisory",
						path: `${described?.path ?? ""}/description`,
						message:
							"SchemaStore's description convention ends with a documentation URL on its own line (<description>\\n<docs-url>)",
					}),
				);
			}
		}
		return context.findings;
	}
}
