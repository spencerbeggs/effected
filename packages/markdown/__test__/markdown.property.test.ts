// The two invariants of the `Markdown` facade that hold for EVERY input —
// parse never throws, and every position is inside the source — over
// generated Unicode-hostile text. The fixed-input cases are in
// `markdown.test.ts`.

import { describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Arbitrary, Result, Schema } from "effect";
import { Markdown } from "../src/Markdown.js";
import type { MarkdownNode } from "../src/MarkdownNode.js";

/** Walk every node of a tree, children-first-agnostic, yielding each node. */
const walk = (node: MarkdownNode, visit: (n: MarkdownNode) => void): void => {
	visit(node);
	const children = (node as { readonly children?: ReadonlyArray<MarkdownNode> }).children;
	if (children !== undefined) {
		for (const child of children) {
			walk(child, visit);
		}
	}
};

describe("Markdown parse invariants — properties", () => {
	/**
	 * Unicode-hostile text: lone surrogates (unpaired halves that break naive
	 * code-point scanning), U+0000 (preprocessed to U+FFFD), every line
	 * terminator form, the markdown punctuation set, and full-plane unicode
	 * as runs of scalar values (the whole plane minus the surrogate block),
	 * which reach the astral code points the ASCII string generator never
	 * emits. `size` lifts the length scale to the 40-part cap.
	 */
	const ScalarValue = Schema.Union([
		Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xd7ff })),
		Schema.Int.check(Schema.isBetween({ minimum: 0xe000, maximum: 0x10ffff })),
	]);
	const HostilePart = Schema.Union([
		Schema.Literals(["\u0000", "\uD800", "\uDFFF", "\uFFFD", "\r\n", "\r", "\n", "\t", " "]),
		Schema.Literals(["#", "*", "_", "`", ">", "-", "[", "]", "(", ")", "!", "\\", "~", "<", "&", "|"]),
		Schema.String.check(Schema.isMaxLength(8)),
		Schema.Array(ScalarValue).check(Schema.isMaxLength(8)),
	]);
	const hostileText = Arbitrary.schema(Schema.Array(HostilePart).check(Schema.isMaxLength(40))).pipe(
		Arbitrary.map((parts) =>
			parts
				.map((part) =>
					typeof part === "string" ? part : part.map((codePoint) => String.fromCodePoint(codePoint)).join(""),
				)
				.join(""),
		),
	);

	it.prop(
		"never throws, whatever the input",
		[hostileText],
		([text]) => {
			const result = Markdown.parseResult(text);
			// Failure is legal (a guard trip); a throw is not.
			return Result.isSuccess(result) || Result.isFailure(result);
		},
		{ arbitrary: { runs: Depth.pick({ sample: 250, full: 2_500 }), size: 40 } },
	);

	it.prop(
		"keeps every node position inside the source",
		[hostileText],
		([text]) => {
			const result = Markdown.parseResult(text);
			if (Result.isFailure(result)) return true;
			let ok = true;
			walk(result.success, (node) => {
				const { start, end } = node.position;
				if (!(start.offset >= 0 && start.offset <= end.offset && end.offset <= text.length)) {
					ok = false;
				}
			});
			return ok;
		},
		{ arbitrary: { runs: Depth.pick({ sample: 250, full: 2_500 }), size: 40 } },
	);
});
