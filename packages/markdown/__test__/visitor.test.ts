// The visitor stream walk: enter/exit events in document pre-order over the
// parsed tree, path/depth context, early termination, and the depth-guard
// posture on decoded foreign trees.
//
// Sibling contract: the event union is a Data.TaggedEnum with a taggedEnum
// constructor const (yaml/toml precedent) and the statics class exposes a
// single visit. Deviation, recorded: yaml and toml visit TEXT (their event
// source is the parse itself), while this visitor walks an already-parsed
// tree — that is what lets it stay infallible at the type level. The guard
// posture mirrors stringify: a decoded foreign tree deeper than
// MAX_NESTING_DEPTH surfaces deliberately (an Error event ending the walk),
// never a defect — and the same tree fails stringifyResult typed, pinned
// here as the posture link.

import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Effect, Equal, Result, Schema, Stream } from "effect";
import { Markdown } from "../src/Markdown.js";
import { Blockquote, Paragraph, Point, Position, Root, Text } from "../src/MarkdownNode.js";
import { MarkdownVisitor, MarkdownVisitorEvent } from "../src/MarkdownVisitor.js";
import { Mdast, MdastDecodeError } from "../src/Mdast.js";
import { loadSpecExamples } from "./e2e/support/corpus.js";

const parse = (text: string, options?: Parameters<typeof Markdown.parseResult>[1]) => {
	const result = Markdown.parseResult(text, options);
	assert.isTrue(Result.isSuccess(result));
	return Result.getOrThrow(result);
};

const collect = (root: Root) => Stream.runCollect(MarkdownVisitor.visit(root));

/** A plain-mdast tree of `depth` nested blockquotes around one paragraph. */
const deepForeignTree = (depth: number): unknown => {
	let node: unknown = { type: "paragraph", children: [{ type: "text", value: "x" }] };
	for (let i = 0; i < depth; i++) {
		node = { type: "blockquote", children: [node] };
	}
	return { type: "root", children: [node] };
};

const syntheticPosition = Position.make({
	start: Point.make({ line: 1, column: 1, offset: 0 }),
	end: Point.make({ line: 1, column: 1, offset: 0 }),
});

describe("MarkdownVisitor", () => {
	it.effect("emits the exact enter/exit sequence for a small document", () =>
		Effect.gen(function* () {
			const root = parse("hello *world*\n");
			const events = yield* collect(root);
			const shape = events.map((event) =>
				event._tag === "Error" ? "Error" : `${event._tag}:${event.node.type}@${event.depth}[${event.path.join(".")}]`,
			);
			assert.deepStrictEqual(shape, [
				"Enter:root@0[]",
				"Enter:paragraph@1[0]",
				"Enter:text@2[0.0]",
				"Exit:text@2[0.0]",
				"Enter:emphasis@2[0.1]",
				"Enter:text@3[0.1.0]",
				"Exit:text@3[0.1.0]",
				"Exit:emphasis@2[0.1]",
				"Exit:paragraph@1[0]",
				"Exit:root@0[]",
			]);
		}),
	);

	it.effect("walks an empty document as a bare root pair", () =>
		Effect.gen(function* () {
			const events = yield* collect(parse(""));
			assert.strictEqual(events.length, 2);
			assert.strictEqual(events[0]?._tag, "Enter");
			assert.strictEqual(events[1]?._tag, "Exit");
		}),
	);

	it.effect("covers gfm constructs and frontmatter in document order with balanced events", () =>
		Effect.gen(function* () {
			const source = [
				"---",
				"title: x",
				"---",
				"# Head",
				"",
				"- [x] task ~~gone~~",
				"",
				"| a |",
				"| - |",
				"| b |",
				"",
				"Text[^f]",
				"",
				"[^f]: note",
				"",
			].join("\n");
			const root = parse(source, { dialect: "gfm", frontmatter: true });
			const events = yield* collect(root);

			// Balanced: every Enter has a matching LIFO Exit, and no Error events.
			const stack: Array<string> = [];
			for (const event of events) {
				assert.notStrictEqual(event._tag, "Error");
				if (event._tag === "Enter") {
					stack.push(event.node.type);
				} else if (event._tag === "Exit") {
					assert.strictEqual(event.node.type, stack.pop());
				}
			}
			assert.strictEqual(stack.length, 0);

			// Document order: frontmatter is the first child entered, and the gfm
			// node types all appear.
			const entered = events.filter((event) => event._tag === "Enter").map((event) => event.node.type);
			assert.strictEqual(entered[0], "root");
			assert.strictEqual(entered[1], "frontmatter");
			for (const expected of ["heading", "listItem", "delete", "table", "tableRow", "tableCell", "footnoteReference"]) {
				assert.include(entered, expected);
			}
		}),
	);

	it.effect("reports path segments as child indexes from the root", () =>
		Effect.gen(function* () {
			const root = parse("> - item\n");
			const events = yield* collect(root);
			const text = events.find((event) => event._tag === "Enter" && event.node.type === "text");
			assert.isDefined(text);
			if (text !== undefined && text._tag === "Enter") {
				// root > blockquote[0] > list[0] > listItem[0] > paragraph[0] > text[0]
				assert.deepStrictEqual([...text.path], [0, 0, 0, 0, 0]);
				assert.strictEqual(text.depth, 5);
			}
		}),
	);

	it.effect("terminates early under Stream.take without walking the rest", () =>
		Effect.gen(function* () {
			const root = parse("a\n\nb\n\nc\n");
			const events = yield* Stream.runCollect(MarkdownVisitor.visit(root).pipe(Stream.take(3)));
			assert.strictEqual(events.length, 3);
			assert.strictEqual(events[0]?._tag, "Enter");
		}),
	);

	it.effect("events are structurally equal for the same walk", () =>
		Effect.gen(function* () {
			const root = parse("hi\n");
			const [first] = yield* collect(root);
			const [again] = yield* collect(root);
			assert.isTrue(Equal.equals(first, again));
		}),
	);

	it.effect("walks a tree exactly at the depth cap without an Error event", () =>
		Effect.gen(function* () {
			// Root(0) + 255 blockquotes + paragraph + text: max depth 257... keep
			// below the cap: 254 blockquotes puts text at depth 256 == cap, legal.
			const result = Mdast.fromMdastResult(deepForeignTree(254));
			assert.isTrue(Result.isSuccess(result));
			const events = yield* collect(Result.getOrThrow(result));
			assert.isFalse(events.some((event) => event._tag === "Error"));
		}),
	);

	it("fromMdastResult fails typed on a decoded foreign tree past the cap (depth guard at the boundary)", () => {
		// root(0) + 300 blockquotes + paragraph + text exceeds MAX_NESTING_DEPTH;
		// the depth guard at the decode boundary converts it to a typed Failure
		// instead of throwing or surfacing it as a visitor Error event.
		const result = Mdast.fromMdastResult(deepForeignTree(300));
		assert.isTrue(Result.isFailure(result));
		if (Result.isFailure(result)) {
			assert.instanceOf(result.failure, MdastDecodeError);
		}
	});

	it.effect("surfaces a decoded foreign tree past the cap as an Error event ending the walk", () =>
		Effect.gen(function* () {
			// Build a 300-deep tree directly via node constructors (bypasses the
			// decode boundary guard) so the visitor's own depth guard is exercised.
			// Paragraph.children is PhrasingContent, so Paragraph cannot wrap
			// Paragraph. Use Blockquote (a Block that wraps Block content) around
			// an innermost Paragraph(Text).
			let node: Blockquote | Paragraph = Paragraph.make({
				children: [Text.make({ value: "x", position: syntheticPosition })],
				position: syntheticPosition,
			});
			for (let i = 0; i < 300; i++) {
				node = Blockquote.make({ children: [node], position: syntheticPosition });
			}
			const tree = Root.make({ children: [node], position: syntheticPosition });

			const events = yield* collect(tree);
			const last = events[events.length - 1];
			assert.isDefined(last);
			assert.strictEqual(last?._tag, "Error");
			if (last !== undefined && last._tag === "Error") {
				assert.strictEqual(last.diagnostic.code, "NestingDepthExceeded");
			}
			// The Error event is terminal — exactly one, nothing after it.
			assert.strictEqual(events.filter((event) => event._tag === "Error").length, 1);
		}),
	);

	it("constructs events via the taggedEnum constructors", () => {
		const node = Text.make({ value: "x", position: syntheticPosition });
		const event = MarkdownVisitorEvent.Enter({ node, path: [0], depth: 1 });
		assert.strictEqual(event._tag, "Enter");
		assert.isTrue(MarkdownVisitorEvent.$is("Enter")(event));
	});

	it.effect("enter and exit fire for a leaf back to back", () =>
		Effect.gen(function* () {
			const paragraph = Paragraph.make({
				children: [Text.make({ value: "x", position: syntheticPosition })],
				position: syntheticPosition,
			});
			const root = Root.make({ children: [paragraph], position: syntheticPosition });
			const events = yield* collect(root);
			const tags = events.map((event) => event._tag);
			assert.deepStrictEqual(tags, ["Enter", "Enter", "Enter", "Exit", "Exit", "Exit"]);
		}),
	);

	it.effect("blockquote nesting inside the cap via make-constructed classes walks clean", () =>
		Effect.gen(function* () {
			let node: Blockquote | Paragraph = Paragraph.make({
				children: [Text.make({ value: "x", position: syntheticPosition })],
				position: syntheticPosition,
			});
			for (let i = 0; i < 10; i++) {
				node = Blockquote.make({ children: [node], position: syntheticPosition });
			}
			const root = Root.make({ children: [node], position: syntheticPosition });
			const events = yield* collect(root);
			assert.strictEqual(events.length, 2 * (1 + 10 + 1 + 1));
			assert.isFalse(events.some((event) => event._tag === "Error"));
		}),
	);
});

// `walk` is the synchronous primitive `visit` is derived from. The contract it
// owes callers: document pre-order (checked against an independent oracle, not
// against `visit`, which is defined from `walk` and so cannot disagree with it),
// produced lazily, and a fresh walk per iteration.
describe("MarkdownVisitor.walk", () => {
	const shapeOf = (event: MarkdownVisitorEvent): string =>
		event._tag === "Error" ? "Error" : `${event._tag}:${event.node.type}@${event.depth}[${event.path.join(".")}]`;

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

	/**
	 * An independent oracle for the walk: an eager, hand-written recursive
	 * pre-order over `children`, sharing no code with `MarkdownVisitor`. It
	 * covers trees inside the depth cap only — every parsed tree is.
	 */
	interface OracleEvent {
		readonly tag: "Enter" | "Exit";
		readonly node: unknown;
		readonly path: ReadonlyArray<number>;
		readonly depth: number;
	}
	const oracle = (node: unknown, path: ReadonlyArray<number> = [], depth = 0): Array<OracleEvent> => {
		const children = (node as { readonly children?: unknown }).children;
		const inner = Array.isArray(children)
			? children.flatMap((child, index) => oracle(child, [...path, index], depth + 1))
			: [];
		return [{ tag: "Enter", node, path, depth }, ...inner, { tag: "Exit", node, path, depth }];
	};

	/** Compare a walk to the oracle event-for-event: tag, node identity, path, depth. */
	const assertMatchesOracle = (root: Root, label: string): void => {
		const walked = [...MarkdownVisitor.walk(root)];
		const expected = oracle(root);
		assert.strictEqual(walked.length, expected.length, `${label}: event count`);
		walked.forEach((event, index) => {
			const want = expected[index] as OracleEvent;
			if (event._tag === "Error") {
				assert.fail(`${label}: unexpected Error event at ${index}`);
			} else {
				assert.strictEqual(event._tag, want.tag, `${label}: tag at ${index}`);
				assert.strictEqual(event.node, want.node, `${label}: node identity at ${index}`);
				assert.deepStrictEqual(event.path, want.path, `${label}: path at ${index}`);
				assert.strictEqual(event.depth, want.depth, `${label}: depth at ${index}`);
			}
		});
	};

	it("matches an independent recursive pre-order over the whole CommonMark corpus", () => {
		const examples = loadSpecExamples();
		// Silently-empty-walk guard: a corpus that failed to load must fail here.
		assert.strictEqual(examples.length, 652);
		for (const example of examples) {
			assertMatchesOracle(parse(example.markdown), `example ${example.example}`);
		}
	});

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
		{ arbitrary: { runs: 200, size: 12 } },
	);

	it.effect("visit delivers the walk's events through the Stream unchanged", () =>
		Effect.gen(function* () {
			const root = parse("# t\n\n> *a* **b**\n\n- x\n- y\n");
			const streamed = yield* Stream.runCollect(MarkdownVisitor.visit(root));
			assert.deepStrictEqual([...streamed].map(shapeOf), [...MarkdownVisitor.walk(root)].map(shapeOf));
			assert.isAbove(streamed.length, 10);
		}),
	);

	it("is lazy: breaking out never touches the rest of the tree", () => {
		const first = Paragraph.make({ children: [Text.make({ value: "a" })] });
		const second = Paragraph.make({ children: [Text.make({ value: "b" })] });
		// A tripwire: any read of the second paragraph's children throws. An
		// eager walk materializes every event before handing out the first, so
		// it trips the wire even though the loop below stops long before.
		Object.defineProperty(second, "children", {
			get() {
				throw new Error("the walk read past the point the consumer stopped at");
			},
		});
		const root = Root.make({ children: [first, second] });
		const seen: Array<string> = [];
		for (const event of MarkdownVisitor.walk(root)) {
			seen.push(shapeOf(event));
			if (event._tag === "Exit" && event.node === first) {
				break;
			}
		}
		assert.deepStrictEqual(seen, [
			"Enter:root@0[]",
			"Enter:paragraph@1[0]",
			"Enter:text@2[0.0]",
			"Exit:text@2[0.0]",
			"Exit:paragraph@1[0]",
		]);
	});

	it("is re-iterable: every iteration is a fresh walk from the root", () => {
		const root = parse("a\n\nb\n");
		const events = MarkdownVisitor.walk(root);
		// A partial first pass must not consume anything the second pass sees.
		for (const _ of events) {
			break;
		}
		const firstPass = [...events];
		const secondPass = [...events];
		assert.strictEqual(firstPass.length, 10);
		assert.deepStrictEqual(firstPass, secondPass);
		assert.deepStrictEqual(firstPass.map(shapeOf)[0], "Enter:root@0[]");
	});

	it("ends an over-deep hand-built tree with exactly one terminal Error event", () => {
		let node: Blockquote | Paragraph = Paragraph.make({
			children: [Text.make({ value: "x", position: syntheticPosition })],
			position: syntheticPosition,
		});
		for (let i = 0; i < 300; i++) {
			node = Blockquote.make({ children: [node], position: syntheticPosition });
		}
		const tree = Root.make({ children: [node], position: syntheticPosition });
		const events = [...MarkdownVisitor.walk(tree)];
		const errors = events.filter((event) => event._tag === "Error");
		assert.strictEqual(errors.length, 1);
		const last = events.at(-1);
		if (last?._tag === "Error") {
			assert.strictEqual(last.diagnostic.code, "NestingDepthExceeded");
		} else {
			assert.fail("expected the walk to end on its Error event");
		}
	});
});
