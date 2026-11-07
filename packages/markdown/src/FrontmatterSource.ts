// String-level frontmatter split and join — the raw-source surface, usable
// without parsing the body at all.
//
// The `MarkdownFrontmatter` seam requires a parsed `MarkdownDocument`; this
// module serves the consumer whose body the CommonMark engine cannot or
// should not parse (an MDX page, a template) and whose contract is
// byte-exact boundaries (a snapshot hash over the body). It runs the SAME
// closed fence grammar as the parser's offset-0 pre-scan — `---` yaml,
// `+++` toml, `---json` json, fence lines exactly the fence, an unclosed
// fence is not frontmatter (though `split` reports that it saw one) — over raw bytes, and never parses the
// frontmatter value or the body: string level only, decoding is the codec
// modules' business.

import { Effect, Schema } from "effect";
import { scanRawFence } from "./internal/blocks/frontmatter.js";
import { FrontmatterFormat } from "./MarkdownNode.js";

/**
 * The three line-terminator spellings a fence line may end with. Recorded by
 * {@link FrontmatterSource.split} as fidelity — what the source's fence
 * lines actually used — and consumed by {@link FrontmatterSource.join}.
 *
 * @public
 */
export const FrontmatterNewline = Schema.Literals(["\n", "\r\n", "\r"]);

/**
 * The union of all fence line-terminator literals.
 *
 * @public
 */
export type FrontmatterNewline = typeof FrontmatterNewline.Type;

/**
 * What the head of a source says about frontmatter: `"absent"` (offset 0 is
 * not an opening fence), `"unclosed"` (an opening fence with no closing
 * fence after it — per the grammar NOT frontmatter, so no block is
 * reported, but the fence was there), or `"closed"` (a complete block).
 *
 * @remarks
 * `"unclosed"` is what a linter needs to diagnose a document whose author
 * meant to write frontmatter: without it, an unclosed `---` reads exactly
 * like a document with no frontmatter at all. An opening fence line that
 * ends the source with no line terminator is `"unclosed"` too.
 *
 * @public
 */
export const FrontmatterFenceState = Schema.Literals(["absent", "unclosed", "closed"]);

/**
 * The union of all fence-state literals.
 *
 * @public
 */
export type FrontmatterFenceState = typeof FrontmatterFenceState.Type;

/**
 * A frontmatter block at string level: the format its fence declared, the
 * exact bytes between the fence lines, and the fence lines' terminator.
 *
 * @remarks
 * `value` is the exact source slice strictly between the opening fence line
 * (its terminator included) and the closing fence line: every value line
 * WITH its own terminator, verbatim — so a block whose value is one blank
 * line (`"\n"`) stays distinct from a block with no value lines (`""`), and
 * interior CRLF terminators survive untouched. This deliberately differs
 * from the parsed `Frontmatter` NODE's `value`, which drops the final
 * terminator; the node feeds codecs, this feeds byte-exact reconstruction.
 * {@link FrontmatterSource.join} accepts a value without a trailing
 * terminator too, appending `newline` so a hand-built block cannot fuse its
 * last line into the closing fence.
 *
 * `newline` is a fidelity field: `split` always records the terminator
 * following the opening fence; when absent (a hand-built block), `join`
 * uses `"\n"`.
 *
 * `valueStart` and `valueEnd` place `value` in the split source: UTF-16
 * code-unit offsets, `valueStart` immediately after the opening fence
 * line's terminator and `valueEnd` at the closing fence line's start, so
 * `source.slice(valueStart, valueEnd) === value`. Add `valueStart` to an
 * offset a YAML, TOML or JSON parser reports inside the value to get the
 * offset in the whole file — for a diagnostic range, say — with no fence
 * arithmetic of your own. `split` always records both; `join` never reads
 * them, so a hand-built block omits them.
 *
 * @public
 */
export class FrontmatterSourceBlock extends Schema.Class<FrontmatterSourceBlock>("FrontmatterSourceBlock")({
	format: FrontmatterFormat,
	value: Schema.String,
	newline: Schema.optionalKey(FrontmatterNewline),
	valueStart: Schema.optionalKey(Schema.Number),
	valueEnd: Schema.optionalKey(Schema.Number),
}) {}

/**
 * The result of {@link FrontmatterSource.split}: the frontmatter block when
 * one exists, the exact body remainder, and the body's byte offset.
 *
 * @remarks
 * `body` is exactly `source.slice(bodyOffset)` — the string and the offset
 * can never disagree. With no block, `body` is the whole source and
 * `bodyOffset` is `0`. With a block, `bodyOffset` sits immediately after
 * the closing fence line and its line terminator (the terminator belongs to
 * the fence line, as every line's terminator belongs to its line), which is
 * gray-matter's body boundary; when the closing fence ends the document
 * there is no terminator and the body is empty.
 *
 * `bodyOffset` is informational output of `split`; `join` never reads it,
 * and it constructor-defaults to `0` so a hand-built value for `join` can
 * omit it.
 *
 * `fence` is the {@link (FrontmatterFenceState:type)} `split` found, and
 * `fenceFormat` the format the opening fence declared whenever there was
 * one (`"unclosed"` or `"closed"`). They tell "no frontmatter" apart from
 * "an opening fence that never closes", which `frontmatter` alone cannot:
 * both leave it absent. Both are informational output of `split`, which
 * always records `fence`; `join` never reads either, so a hand-built value
 * omits them.
 *
 * @public
 */
export class FrontmatterSourceSplit extends Schema.Class<FrontmatterSourceSplit>("FrontmatterSourceSplit")({
	frontmatter: Schema.optionalKey(FrontmatterSourceBlock),
	body: Schema.String,
	bodyOffset: Schema.Number.pipe(Schema.withConstructorDefault(Effect.succeed(0))),
	fence: Schema.optionalKey(FrontmatterFenceState),
	fenceFormat: Schema.optionalKey(FrontmatterFormat),
}) {}

/** The opening fence line per format (the closed grammar's spellings). */
const OPEN_FENCE: Record<FrontmatterFormat, string> = {
	yaml: "---",
	toml: "+++",
	json: "---json",
};

/** The closing fence line per format. */
const CLOSE_FENCE: Record<FrontmatterFormat, string> = {
	yaml: "---",
	toml: "+++",
	json: "---",
};

/**
 * The string-level frontmatter facade: split raw source at the fence
 * boundaries and join it back, without parsing anything.
 *
 * @public
 */
export class FrontmatterSource {
	private constructor() {}

	/**
	 * Split raw source into its frontmatter block and body, at string level.
	 * Total: never fails, never parses — absence of a block (including an
	 * opening fence with no closing fence, which per the grammar is not
	 * frontmatter) is a representable result, not an error.
	 *
	 * @remarks
	 * The grammar is the parser's own offset-0 pre-scan, over raw bytes:
	 * the fence set is closed (`---` yaml, `+++` toml, `---json` json), a
	 * fence line is exactly the fence with no surrounding whitespace, and a
	 * leading BOM means offset 0 is not a fence — strip one before calling
	 * if the source may carry it. Unlike the parse path there is no capture
	 * toggle here: `frontmatter` is absent exactly when the source has no
	 * closed block, and `fence` says why — `"absent"` for no opening fence,
	 * `"unclosed"` for one that never closes.
	 *
	 * Byte exactness: `source.slice(0, result.bodyOffset) + result.body`
	 * reassembles `source` exactly, and {@link FrontmatterSource.join}
	 * reproduces the original bytes for an unmodified round-trip — see
	 * `join` for the two normalizations at the contract's edge.
	 *
	 * @example
	 * ```ts
	 * import { FrontmatterSource } from "@effected/markdown";
	 *
	 * const split = FrontmatterSource.split("---\ntitle: hi\n---\n\n# Body\n");
	 * console.log(split.frontmatter?.format); // => "yaml"
	 * console.log(split.frontmatter?.value); // => "title: hi\n"
	 * console.log(split.body); // => "\n# Body\n"
	 * console.log(split.frontmatter?.valueStart); // => 4
	 * console.log(FrontmatterSource.split("---\ntitle: hi\n").fence); // => "unclosed"
	 * ```
	 *
	 * @param source - The raw document source, body format irrelevant.
	 * @returns A {@link FrontmatterSourceSplit}; `frontmatter` is absent when
	 *   the source opens with no closed fence block, and `fence` says which.
	 */
	static split(source: string): FrontmatterSourceSplit {
		const fence = scanRawFence(source);
		if (fence.state === "absent") {
			return FrontmatterSourceSplit.make({ body: source, bodyOffset: 0, fence: "absent" });
		}
		if (fence.state === "unclosed") {
			return FrontmatterSourceSplit.make({
				body: source,
				bodyOffset: 0,
				fence: "unclosed",
				fenceFormat: fence.format,
			});
		}
		return FrontmatterSourceSplit.make({
			frontmatter: FrontmatterSourceBlock.make({
				format: fence.format,
				value: fence.value,
				newline: fence.newline,
				valueStart: fence.valueStart,
				valueEnd: fence.valueEnd,
			}),
			body: source.slice(fence.bodyOffset),
			bodyOffset: fence.bodyOffset,
			fence: "closed",
			fenceFormat: fence.format,
		});
	}

	/**
	 * Serialize a split back to one source string. Total and pure.
	 *
	 * @remarks
	 * With no block the body is returned verbatim. With a block the output
	 * is the opening fence, `newline` (default `"\n"`), the value — a
	 * non-empty value missing a final line terminator gets `newline`
	 * appended, so the closing fence always starts its own line — the
	 * closing fence, `newline`, then the body verbatim.
	 *
	 * **Round-trip contract:** `join(split(source)) === source`, byte for
	 * byte, for every source whose closing fence line ends with a line
	 * terminator matching the opening fence's. The two edges where join
	 * normalizes instead: a closing fence at end-of-document gains a final
	 * `newline` (the block's one unterminated spelling), and fence lines
	 * with MISMATCHED terminators (say `---\r\n … ---\n`) re-emit both with
	 * the opening one. Value and body bytes survive verbatim in every case.
	 *
	 * @param split - The parts to serialize, typically from
	 *   {@link FrontmatterSource.split} or built with
	 *   `FrontmatterSourceSplit.make`.
	 * @returns The combined source string.
	 */
	static join(split: FrontmatterSourceSplit): string {
		const block = split.frontmatter;
		if (block === undefined) {
			return split.body;
		}
		const newline = block.newline ?? "\n";
		const value =
			block.value === "" || block.value.endsWith("\n") || block.value.endsWith("\r")
				? block.value
				: `${block.value}${newline}`;
		return `${OPEN_FENCE[block.format]}${newline}${value}${CLOSE_FENCE[block.format]}${newline}${split.body}`;
	}
}
