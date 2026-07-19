// The `Markdown` facade: the pure `parseResult` primitive, the `Effect`
// `parse` defined in terms of it, the parse options and the
// `MarkdownFromString` schema codec.
//
// Cycle firewall: the internal engine throws raw carriers (`GuardExceeded`
// from a hardening cap, `RawMarkdownError` for a fatal engine condition);
// this module materializes `MarkdownDiagnostic` instances (deriving
// `line`/`character` from `offset`) and constructs the tagged
// `MarkdownParseError`. Anything else that escapes the engine is a
// programmer error and is rethrown untouched — a defect, never a typed
// failure. The dependency edge runs facade -> engine only, so
// `noImportCycles` stays satisfied.

import { Effect, Option, Result, Schema, SchemaIssue, SchemaTransformation } from "effect";
import type { BlockPassResult } from "./internal/blockParser.js";
import { parseBlocks } from "./internal/blockParser.js";
import { isGuardExceeded, isRawMarkdownError } from "./internal/carriers.js";
import { MarkdownDiagnostic } from "./MarkdownDiagnostic.js";
import { Root } from "./MarkdownNode.js";

/**
 * The markdown dialects the parser can be pointed at. `"gfm"` — CommonMark
 * 0.31.2 plus the GitHub extensions (tables, strikethrough, autolink
 * literals, task-list items, footnotes, and the tagfilter's output contract)
 * — is the default; `"commonmark"` opts out of every extension. A dialect is
 * a registry composition in the engine, so widening this union is additive
 * and never changes an existing dialect's behavior.
 *
 * @public
 */
export const MarkdownDialect = Schema.Literals(["commonmark", "gfm"]);

/**
 * The union of all markdown dialect string literals.
 *
 * @public
 */
export type MarkdownDialect = typeof MarkdownDialect.Type;

/**
 * Options controlling parse behavior. The only knob is `dialect` — omitted,
 * it resolves to `"gfm"`.
 *
 * @public
 */
export class MarkdownParseOptions extends Schema.Class<MarkdownParseOptions>("MarkdownParseOptions")({
	dialect: Schema.optionalKey(MarkdownDialect),
}) {}

/**
 * Parse failure: the {@link MarkdownDiagnostic} describing why the document
 * was rejected.
 *
 * @remarks
 * CommonMark has no syntax errors — every string is a valid document — so
 * this error carries only hardening-guard trips (P1: `NestingDepthExceeded`).
 * Recoverable oddities are diagnostics on {@link MarkdownDocument}, not
 * failures. A malformed-looking document parses; a nesting bomb fails here
 * rather than crashing with a `RangeError`.
 *
 * @public
 */
export class MarkdownParseError extends Schema.TaggedErrorClass<MarkdownParseError>()("MarkdownParseError", {
	diagnostic: MarkdownDiagnostic,
}) {
	override get message(): string {
		const { code, line, character, message } = this.diagnostic;
		return `Markdown parse failed: ${code} at ${line}:${character} ${message}`;
	}
}

/**
 * The dialect an options object resolves to. The PUBLIC default — `"gfm"`,
 * a product decision — is spelled exactly once, here. The engine's own
 * `parseBlocks` default is `"commonmark"` and means something different: the
 * base dialect the registries compose on top of. The facade always passes
 * this resolved value explicitly, so the two defaults never interact.
 */
const dialectOf = (options?: MarkdownParseOptions): MarkdownDialect => options?.dialect ?? "gfm";

/**
 * Run the block pass, converting the engine's raw carriers into a typed
 * {@link MarkdownParseError} and letting everything else through as a defect.
 *
 * Shared by {@link Markdown.parseResult} and `MarkdownDocument.parseResult`
 * so the two entry points can never disagree about what is typed and what is
 * a defect.
 *
 * @internal
 */
export const parsePassResult = (
	text: string,
	options?: MarkdownParseOptions,
): Result.Result<BlockPassResult, MarkdownParseError> => {
	try {
		return Result.succeed(parseBlocks(text, dialectOf(options)));
	} catch (caught) {
		if (isGuardExceeded(caught)) {
			return Result.fail(
				new MarkdownParseError({
					diagnostic: MarkdownDiagnostic.fromRaw(text, {
						code: caught.reason,
						message: caught.message,
						offset: caught.offset,
						length: 0,
					}),
				}),
			);
		}
		if (isRawMarkdownError(caught)) {
			return Result.fail(new MarkdownParseError({ diagnostic: MarkdownDiagnostic.fromRaw(text, caught.diagnostic) }));
		}
		throw caught;
	}
};

/**
 * The markdown facade: parse markdown source — GFM by default, CommonMark by
 * option — into an mdast-shaped {@link Root} tree, as a pure `Result` or as
 * an `Effect`.
 *
 * @public
 */
export class Markdown {
	/**
	 * Parse markdown into a {@link Root} tree, synchronously, as a `Result`.
	 * The pure primitive: a non-Effect caller (a build script, a Vite plugin,
	 * a language-server tick) can call this directly instead of wrapping
	 * `Effect.runSync(Effect.result(Markdown.parse(text)))`.
	 *
	 * @remarks
	 * {@link Markdown.parse} is defined in terms of this function; the two
	 * never diverge. Reach for the `Effect` variant inside Effect code — it
	 * carries the `Markdown.parse` tracing span — and for this one at
	 * synchronous boundaries. This function carries no span: it is not an
	 * `Effect`.
	 *
	 * Failure is rare by design: every string is a valid markdown document in
	 * both dialects, so the only failures are hardening-guard trips such as
	 * nesting past the 256-container cap. Programmer errors are not converted
	 * — they propagate as thrown defects.
	 *
	 * @example
	 * ```ts
	 * import { Markdown } from "@effected/markdown";
	 * import { Result } from "effect";
	 *
	 * const ok = Markdown.parseResult("# Title\n\nBody *text*.\n");
	 * if (Result.isSuccess(ok)) {
	 *   console.log(ok.success.children.length); // => 2
	 * }
	 * ```
	 *
	 * @param text - The markdown source to parse.
	 * @param options - Optional {@link MarkdownParseOptions}; the dialect
	 *   defaults to `"gfm"`.
	 * @returns A `Result` succeeding with the document {@link Root}, or
	 *   failing with {@link MarkdownParseError}.
	 */
	static parseResult(text: string, options?: MarkdownParseOptions): Result.Result<Root, MarkdownParseError> {
		return Result.map(parsePassResult(text, options), (pass) => pass.root);
	}

	/**
	 * Parse markdown into a {@link Root} tree. Defined in terms of
	 * {@link Markdown.parseResult} — synchronous callers can use that variant
	 * directly.
	 *
	 * @param text - The markdown source to parse.
	 * @param options - Optional {@link MarkdownParseOptions}; the dialect
	 *   defaults to `"gfm"`.
	 * @returns An `Effect` that succeeds with the document {@link Root}, or
	 *   fails with {@link MarkdownParseError}.
	 */
	static readonly parse = Effect.fn("Markdown.parse")((text: string, options?: MarkdownParseOptions) =>
		Effect.fromResult(Markdown.parseResult(text, options)),
	);

	/**
	 * A `Schema<Root, string>` decoding markdown source into a {@link Root}
	 * tree.
	 *
	 * @remarks
	 * Decode-only in P1. The encode direction fails with a schema issue
	 * naming `Markdown.stringify` as the P4 deliverable that will implement
	 * it; the codec shape is chosen so P4 fills the encode slot without any
	 * signature change for consumers.
	 *
	 * Schema-producing: each call returns a fresh schema whose derivation
	 * caches are not shared across calls. Bind the result to a `const` on hot
	 * paths; the pre-bound {@link Markdown.MarkdownFromString} covers the
	 * common case.
	 *
	 * @param options - Optional {@link MarkdownParseOptions} applied on
	 *   decode.
	 * @returns A `Schema.Codec<Root, string>`.
	 */
	static fromString(options?: MarkdownParseOptions): Schema.Codec<Root, string> {
		return Schema.String.pipe(
			Schema.decodeTo(
				Root,
				SchemaTransformation.transformOrFail({
					decode: (input: string) =>
						Effect.mapError(
							Markdown.parse(input, options),
							(error) => new SchemaIssue.InvalidValue(Option.some(input), { message: error.message }),
						),
					encode: (value: Root) =>
						Effect.fail(
							new SchemaIssue.InvalidValue(Option.some(value), {
								message: "Markdown stringify is not implemented yet (arrives with Markdown.stringify in P4)",
							}),
						),
				}),
			),
		);
	}

	/**
	 * The zero-config `Schema<Root, string>` — `Markdown.fromString()`
	 * pre-bound so the common case needs no memoization discipline.
	 */
	static readonly MarkdownFromString: Schema.Codec<Root, string> = Markdown.fromString();
}
