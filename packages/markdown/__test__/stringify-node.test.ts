// Single-node stringify: a FlowContent node serializes EXACTLY as its
// one-child document, by definition. Pinned over every root-level flow child
// of both conformance corpora plus constructed MDX flow nodes.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { Markdown } from "../src/Markdown.js";
import type { FlowContent } from "../src/MarkdownNode.js";
import { MdxFlowExpression, MdxJsxFlowElement, Paragraph, Root, Text } from "../src/MarkdownNode.js";
import { loadGfmSpecExtensionExamples, loadSpecExamples } from "./e2e/support/corpus.js";

const wrapped = (node: FlowContent) => Markdown.stringifyResult(Root.make({ children: [node] }));

const assertSame = (node: FlowContent, label: string): void => {
	const alone = Markdown.stringifyResult(node);
	const asDocument = wrapped(node);
	assert.isTrue(Result.isSuccess(alone), label);
	assert.deepStrictEqual(alone, asDocument, label);
};

describe("Markdown.stringify on a single flow node", () => {
	it("equals the one-child document for every root-level flow node in the corpora", () => {
		const kinds = new Set<string>();
		for (const example of [...loadSpecExamples(), ...loadGfmSpecExtensionExamples()]) {
			const root = Result.getOrThrow(Markdown.parseResult(example.markdown));
			for (const child of root.children) {
				if (child.type === "frontmatter" || child.type === "mdxjsEsm") continue;
				kinds.add(child.type);
				assertSame(child, `example ${example.example} ${child.type}`);
			}
		}
		for (const kind of ["table", "definition", "list", "code", "blockquote", "heading", "html", "thematicBreak"]) {
			assert.isTrue(kinds.has(kind), kind);
		}
	});

	it("equals the one-child document for MDX flow nodes", () => {
		assertSame(
			MdxJsxFlowElement.make({
				name: "Note",
				attributes: [],
				children: [Paragraph.make({ children: [Text.make({ value: "hi" })] })],
			}),
			"mdxJsxFlowElement",
		);
		assertSame(MdxFlowExpression.make({ value: "1 + 1" }), "mdxFlowExpression");
	});

	it("applies the MDX escaping flag on the single-node path", () => {
		// The flag is computed over the block list: a tree holding any MDX node
		// escapes `{` in text. This element's text depends on it, so a flag that
		// is dropped or forced false on the single-node path changes the bytes.
		const element = MdxJsxFlowElement.make({
			name: "Note",
			attributes: [],
			children: [Paragraph.make({ children: [Text.make({ value: "a < b {c}" })] })],
		});
		const alone = Result.getOrThrow(Markdown.stringifyResult(element));
		assert.include(alone, "\\{c}");
		assert.strictEqual(alone, Result.getOrThrow(wrapped(element)));
		// Without MDX in the tree the same text keeps its brace unescaped.
		const plain = Result.getOrThrow(
			Markdown.stringifyResult(Paragraph.make({ children: [Text.make({ value: "a < b {c}" })] })),
		);
		assert.notInclude(plain, "\\{");
		// The flag scans every block, not only the first: MDX in the second
		// block still escapes the first block's text.
		const mixed = Result.getOrThrow(
			Markdown.stringifyResult(
				Root.make({
					children: [
						Paragraph.make({ children: [Text.make({ value: "x {y}" })] }),
						MdxFlowExpression.make({ value: "1" }),
					],
				}),
			),
		);
		assert.include(mixed, "x \\{y}");
	});

	it("never throws building a wrapper for a cast-forged node: it behaves as that node inside a Root", () => {
		// A Root built by the class constructor would refuse this child (even
		// with disableChecks the structural parse runs), so a wrapping
		// implementation would throw here. The single block-list path builds no
		// wrapper, so the lone node and the same node in a forged Root agree.
		const forged = Text.make({ value: "x" }) as unknown as FlowContent;
		assert.throws(() => Root.make({ children: [forged] }));
		const alone = Markdown.stringifyResult(forged);
		assert.deepStrictEqual(alone, Markdown.stringifyResult({ type: "root", children: [forged] } as unknown as Root));
	});

	it.effect("the Effect form accepts a flow node and keeps the trailing newline", () =>
		Effect.gen(function* () {
			const output = yield* Markdown.stringify(Paragraph.make({ children: [Text.make({ value: "one" })] }));
			assert.strictEqual(output, "one\n");
		}),
	);
});
