/**
 * The one owner of the declared non-standard keyword families, in two
 * groups.
 *
 * **Upstream language-server families** — mirrored from SchemaStore's
 * CONTRIBUTING, the keyword sets legitimately consumed by editor
 * toolchains that ajv strict mode would otherwise reject:
 *
 * - **vscode-json-languageservice** (exact names): `allowTrailingCommas`,
 *   `defaultSnippets`, `enumDescriptions`, `markdownDescription`,
 *   `markdownEnumDescriptions`.
 * - **taplo**: the `x-taplo` prefix (`x-taplo`, `x-taplo-info`, ...).
 * - **tombi**: the `x-tombi-` prefix (`x-tombi-toml-version`,
 *   `x-tombi-array-values-order`, `x-tombi-array-values-order-by`,
 *   `x-tombi-table-keys-order`, `x-tombi-string-formats`,
 *   `x-tombi-additional-key-label`).
 * - **IntelliJ**: the `x-intellij-` prefix (`x-intellij-language-injection`,
 *   `x-intellij-html-description`, `x-intellij-enum-metadata`).
 *
 * **The house machine-annotation family** — `x-ai-` (WITH the trailing
 * dash; bare `x-ai` and a look-alike prefix like `x-aida-foo` are NOT
 * declared), owned by this package rather than mirrored from anywhere:
 *
 * - It is a NAMESPACE, not a vocabulary — any `x-ai-*` key is declared, and
 *   this package does not enumerate specific keys.
 * - The key itself must be one ajv can register: after the prefix, only
 *   `[A-Za-z0-9_$:-]` (ajv holds a keyword name to
 *   `/^[a-z_$][a-z0-9_$:-]*$/i`). A dot, a space, a slash, an `@`, a `+` or
 *   any non-ASCII character makes the engine gate reject the whole document
 *   — as a root-pathed `ValidationFinding`, not an error.
 * - A value under a declared `x-ai-*` key must be JSON — `CanonicalJson`
 *   fails typed (`NonJsonValueError`) on anything else, the same as
 *   every other emitted value.
 * - The one recommended, non-binding key is `x-ai-hint`: a string carrying
 *   an instruction to a machine reader about the annotated value.
 * - `x-ai-example` is deliberately NOT recommended. Draft-07's own
 *   `examples` keyword already exists, is carried by the assembly, and
 *   classifies as a CONTRACT change in `DocumentDiff`; an `x-ai-*`
 *   key classifies as ANNOTATIONS. The two would be two example channels
 *   with opposite version semantics.
 * - A declared-family value must not contain an `$id` — or a repeated
 *   `$anchor` — at ANY depth, not merely as its own top-level key: ajv's
 *   reference collection walks unknown keywords looking for them, so a
 *   colliding one buried anywhere inside an annotation payload fails the
 *   compile, surfacing as a blocking root-pathed `ValidationFinding` rather
 *   than a silent no-op. An empty-string `$id` collides too — it resolves
 *   to the root id.
 * - No upstream tool sanctions `x-ai-`: a document carrying it that is
 *   submitted to schemastore.org needs the corresponding entry added to
 *   that repo's own validation config. Until then it is intended for
 *   self-hosted publication.
 * - `DocumentDiff` classifies a delta confined to `x-ai-*` keys as
 *   `"annotations"`, so adopting the family on an already-published
 *   versioned document rewrites that file in place — correct, because
 *   annotations are transparently replaceable.
 *
 * Both consumers of the registry route through {@link KeywordFamilies.isDeclared}:
 * `DocumentLint`'s `UnknownKeyword` check (a declared key is not flagged) and
 * `AnnotationCarriers` (only declared keys are re-grafted after the Draft-07
 * lowering). One predicate, so the lint and the carriers cannot drift.
 */

// The vscode-json-languageservice extension set (exact names).
const VSCODE_KEYWORDS = new Set([
	"allowTrailingCommas",
	"defaultSnippets",
	"enumDescriptions",
	"markdownDescription",
	"markdownEnumDescriptions",
]);

/**
 * The declared non-standard keyword families as one predicate: the
 * vscode-json-languageservice set by exact name, plus the `x-taplo`,
 * `x-tombi-`, `x-intellij-` and `x-ai-` prefixes.
 *
 * @public
 */
export class KeywordFamilies {
	private constructor() {}

	/**
	 * Whether `key` belongs to a declared non-standard keyword family.
	 * Draft-07's own keywords are a separate vocabulary — this predicate
	 * answers only for the language-server extension families and the
	 * house `x-ai-` machine-annotation namespace.
	 */
	static isDeclared(key: string): boolean {
		return (
			VSCODE_KEYWORDS.has(key) ||
			key.startsWith("x-taplo") ||
			key.startsWith("x-tombi-") ||
			key.startsWith("x-intellij-") ||
			key.startsWith("x-ai-")
		);
	}
}
