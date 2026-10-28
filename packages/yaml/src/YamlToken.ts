// The public positioned token stream: promotes the internal lexer
// token to public surface for lint- and LSP-class consumers. The internal
// token spells two fields differently (`value`, `column`); promotion
// reconciles them to the positioned-diagnostic vocabulary the public surface
// already uses in `YamlDiagnostic` (`text`, `character`).
//
// Cycle firewall: this module imports the internal lexer and the `Yaml`
// facade's error type; nothing imports `YamlToken.ts` back except the lint
// layer above it.

import { LineIndex } from "@effected/source";
import { Result, Schema, Stream } from "effect";
import { lexAll } from "./internal/lexer.js";
import type { YamlParseError } from "./Yaml.js";

/**
 * The 22 lexical token kinds produced by the YAML tokenizer.
 *
 * @public
 */
export const YamlTokenKind = Schema.Literals([
	"document-start",
	"document-end",
	"directive",
	"tag",
	"anchor",
	"alias",
	"scalar",
	"block-map-start",
	"block-map-key",
	"block-map-value",
	"block-seq-start",
	"block-seq-entry",
	"flow-map-start",
	"flow-map-end",
	"flow-seq-start",
	"flow-seq-end",
	"flow-separator",
	"newline",
	"whitespace",
	"comment",
	"byte-order-mark",
	"error",
]);

/**
 * The union of all lexical token kind string literals.
 *
 * @public
 */
export type YamlTokenKind = typeof YamlTokenKind.Type;

/**
 * A single positioned YAML lexical token.
 *
 * - `kind` — the {@link (YamlTokenKind:type)}.
 * - `text` — the raw source slice the token covers; the position-fidelity
 *   invariant is `source.slice(offset, offset + length) === text`.
 * - `offset` / `length` — the token's span in UTF-16 code units.
 * - `line` / `character` — the zero-based position of the token's start,
 *   matching the `YamlDiagnostic` position vocabulary.
 *
 * @remarks
 * Satisfies `@effected/source`'s `SourceLocation`. `line` / `character` are
 * `LineIndex.make(source, { lineBreaks: "lf" }).positionAt(offset)`:
 * zero-based, UTF-16 code units, with `\n` and `\r\n` as line breaks and a
 * bare `\r` an ordinary character. That is where this package's composer
 * breaks lines, so a lint fix computed from token positions lands where the
 * parsed value expects it. YAML 1.2's `b-break` also counts a bare `\r`, and
 * so does `YamlDiagnostic`: on a document holding a bare `\r` a token and a
 * diagnostic at the same offset can disagree. Making the composer break at a
 * bare `\r` is tracked separately; until it does, tokens follow the
 * composer.
 *
 * @public
 */
export class YamlToken extends Schema.Class<YamlToken>("YamlToken")({
	kind: YamlTokenKind,
	text: Schema.String,
	offset: Schema.Number,
	length: Schema.Number,
	line: Schema.Number,
	character: Schema.Number,
}) {}

/**
 * Promote the internal lexer tokens to the public shape.
 *
 * `line`/`character` are DERIVED from each token's offset against the line
 * index rather than copied from the internal token: the internal `column` is
 * a CST-parser vocabulary that carries the construct's INDENT on the
 * synthetic `block-map-start`/`block-seq-start` markers, not the token's own
 * position — the public surface promises the position. `text` is the RAW
 * source slice for the same reason: the internal `value` is the PROCESSED
 * form on quoted scalars (content without the quotes), while the public
 * contract is byte fidelity — the corpus conformance suite pins the tokens
 * tiling the source exactly.
 *
 * Takes the caller's index so the lint context builds one index for its
 * tokens and its lines. The index must use `"lf"` line breaks, the
 * composer's rule (see {\link YamlToken}).
 *
 * @internal
 */
export const tokensOf = (index: LineIndex): ReadonlyArray<YamlToken> => {
	const text = index.text;
	return lexAll(text).map((token) => {
		const { line, character } = index.positionAt(token.offset);
		// Hot path: tokenizing a large document materializes thousands of
		// instances, so construction uses `new` (the engine's recorded
		// hot-path exception) rather than the validating `make`.
		return new YamlToken({
			kind: token.kind,
			text: text.slice(token.offset, token.offset + token.length),
			offset: token.offset,
			length: token.length,
			line,
			character,
		});
	});
};

/**
 * Tokenizes YAML text into positioned tokens, as a complete array or a lazy
 * `Stream`, for lint- and editor-class consumers. Never fails on malformed
 * input: lexical errors arrive as `"error"`-kind tokens. Not instantiable.
 *
 * @public
 */
export class YamlTokens {
	private constructor() {}

	/**
	 * Tokenize YAML text into the full positioned token array — the sync
	 * `Result` primitive (tokenizing is a pure batch transform; the
	 * {@link YamlTokens.stream} form is derived from this one).
	 *
	 * @remarks
	 * The failure channel is **reserved** for input-hardening guards and never
	 * fires today: the lexer is total, and lexical errors surface as
	 * `"error"`-kind tokens **in the success array** so that linting can run
	 * on malformed input — the `parse-validity` lint rule exists precisely for
	 * documents that do not parse. Do not "fix" this method to fail on
	 * `"error"` tokens; that would make malformed documents unlintable.
	 *
	 * @example
	 * ```ts
	 * import { YamlTokens } from "@effected/yaml";
	 * import { Result } from "effect";
	 *
	 * const result = YamlTokens.tokenize("a: 1\n");
	 * if (Result.isSuccess(result)) {
	 *   result.success.map((t) => t.kind); // ["scalar", "block-map-start", ...]
	 * }
	 * ```
	 *
	 * @param text - The YAML source to tokenize.
	 * @returns A `Result` succeeding with every token in source order.
	 */
	static tokenize(text: string): Result.Result<ReadonlyArray<YamlToken>, YamlParseError> {
		return Result.succeed(tokensOf(LineIndex.make(text, { lineBreaks: "lf" })));
	}

	/**
	 * Tokenize YAML text as a lazy `Stream` of tokens — the derived form of
	 * {@link YamlTokens.tokenize} for genuinely incremental (SAX-style)
	 * consumers, parallel to `YamlVisitor.visit`.
	 *
	 * @remarks
	 * Derived from the sync primitive, so it shares its contract: lexical
	 * errors arrive as `"error"`-kind tokens in the stream, never as a stream
	 * failure. (The primitive's reserved failure channel would surface as a
	 * defect here; it never fires today.)
	 */
	static stream(text: string): Stream.Stream<YamlToken> {
		return Stream.suspend(() =>
			Result.match(YamlTokens.tokenize(text), {
				onSuccess: (tokens) => Stream.fromIterable(tokens),
				onFailure: (error) => Stream.die(error),
			}),
		);
	}
}
