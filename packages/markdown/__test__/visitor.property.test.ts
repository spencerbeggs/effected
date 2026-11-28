// The visitor walk against an independent recursive pre-order on generated
// markdown. The fixed cases and the corpus walk are in `visitor.test.ts`.

import { describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Arbitrary, Result, Schema } from "effect";
import { Markdown } from "../src/Markdown.js";
import { assertMatchesOracle } from "./walkOracle.js";

describe("MarkdownVisitor.walk — property", () => {
	/** Markdown-ish lines drawn from the construct vocabulary, so the trees are not all one paragraph. */
	const markdownish = Arbitrary.schema(
		Schema.Array(
			Schema.Union([
				Schema.Literals([
					"# heading",
					"setext",
					"-------",
					"- item",
					"1. item",
					"> quote",
					">> deep",
					"    indented code",
					"```js",
					"```",
					"| a | b |",
					"| - | - |",
					"- [x] task",
					"*em* and **strong**",
					"[link](/url) and ![img](/src)",
					"[^f] and ~~gone~~",
					"[^f]: note",
					"",
				]),
				Schema.String.check(Schema.isMaxLength(12)),
			]),
		).check(Schema.isMaxLength(12)),
	).pipe(Arbitrary.map((lines) => `${lines.join("\n")}\n`));

	it.prop(
		"matches an independent recursive pre-order on generated markdown",
		[markdownish],
		([markdown]) => {
			const result = Markdown.parseResult(markdown);
			if (Result.isFailure(result)) {
				// A hardening-guard trip has no tree to walk.
				return true;
			}
			assertMatchesOracle(result.success, JSON.stringify(markdown));
			return true;
		},
		{ arbitrary: { runs: Depth.pick({ sample: 20, full: 200 }), size: 12 } },
	);
});
