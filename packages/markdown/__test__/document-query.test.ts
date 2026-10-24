// `MarkdownDocument.find`/`findAll`: the query helpers over the parsed tree —
// type-string selectors that narrow through the node-class union, plain and
// type-guard predicates, document pre-order (the visitor's Enter order,
// root-inclusive), identity into `MarkdownFormat.modify`, and the getters'
// thrown-defect posture on an over-deep foreign tree.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result, Stream } from "effect";
import { MAX_NESTING_DEPTH } from "../src/internal/limits.js";
import { MarkdownDocument } from "../src/MarkdownDocument.js";
import { MarkdownFormat } from "../src/MarkdownFormat.js";
import type { FlowContent, MarkdownNode } from "../src/MarkdownNode.js";
import { Blockquote, Heading, List, Paragraph, Root, Table, Text } from "../src/MarkdownNode.js";
import { MarkdownVisitor } from "../src/MarkdownVisitor.js";

const parseDoc = (text: string) => {
	const result = MarkdownDocument.parseResult(text);
	assert.isTrue(Result.isSuccess(result));
	return Result.getOrThrow(result);
};

// Type-level contract: `find` returns `Option` and every overload still
// narrows. Checked by `types:check` (the test tree is in the program); the
// runtime suite only proves the module loaded.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_Expected extends true>(): void => {};
declare const typedDocument: MarkdownDocument;
/** Never called: the assertions inside are compile-time only. */
const findOverloadsNarrow = (): void => {
	const byTag = typedDocument.find("table");
	assertType<Equals<typeof byTag, Option.Option<Table>>>();
	const byGuard = typedDocument.find((node): node is Heading => node.type === "heading");
	assertType<Equals<typeof byGuard, Option.Option<Heading>>>();
	// A predicate TypeScript cannot infer a type guard from stays wide.
	const byPredicate = typedDocument.find((node) => node.position.start.line > 1);
	assertType<Equals<typeof byPredicate, Option.Option<MarkdownNode>>>();
};

const source = [
	"# Title",
	"",
	"Intro with a [link](/a).",
	"",
	"> ## Quoted heading",
	"",
	"- item one",
	"- item two",
	"",
	"| h |",
	"| - |",
	"| c |",
	"",
	"## Outro",
	"",
].join("\n");

describe("MarkdownDocument.find", () => {
	it("finds the first node of a type, narrowed through the type tag", () => {
		const document = parseDoc(source);
		const heading = Option.getOrThrow(document.find("heading"));
		assert.instanceOf(heading, Heading);
		// The narrowed static type exposes `depth` without a cast.
		assert.strictEqual(heading.depth, 1);
		assert.isFunction(findOverloadsNarrow);
	});

	it("matches by identity against the document's own tree", () => {
		const document = parseDoc(source);
		assert.strictEqual(Option.getOrThrow(document.find("heading")), document.root.children[0]);
		// The root itself is in the walk, so the widest query returns it first.
		assert.strictEqual(Option.getOrThrow(document.find(() => true)), document.root);
		assert.strictEqual(Option.getOrThrow(document.find("root")), document.root);
	});

	it("accepts a plain predicate and returns the wide node union", () => {
		const document = parseDoc(source);
		const found = Option.getOrThrow(document.find((node) => node.type === "heading" && node.depth === 2));
		assert.instanceOf(found, Heading);
	});

	it("narrows through a type-guard predicate", () => {
		const document = parseDoc(source);
		const table = Option.getOrThrow(document.find((node): node is Table => node.type === "table"));
		assert.instanceOf(table, Table);
		assert.isDefined(table.align);
	});

	it("returns Option.none when nothing matches", () => {
		const document = parseDoc(source);
		assert.isTrue(Option.isNone(document.find("footnoteDefinition")));
		assert.isTrue(Option.isNone(document.find(() => false)));
	});
});

describe("MarkdownDocument.findAll", () => {
	it("collects every match in document pre-order, wherever it nests", () => {
		const document = parseDoc(source);
		const headings = document.findAll("heading");
		assert.strictEqual(headings.length, 3);
		for (const heading of headings) {
			assert.instanceOf(heading, Heading);
		}
		// Document order: the quoted heading sits between the two root-level
		// ones, and `findAll("heading")[1]` addresses it without child indexing.
		assert.deepStrictEqual(
			headings.map((heading) => heading.depth),
			[1, 2, 2],
		);
		// Same nodes, same order as the navigation getter, by identity.
		assert.deepStrictEqual(
			headings,
			document.headings.map((entry) => entry.node),
		);
	});

	it.effect("matches the visitor's Enter order node for node, root included", () =>
		Effect.gen(function* () {
			const document = parseDoc(source);
			const events = yield* Stream.runCollect(MarkdownVisitor.visit(document.root));
			const entered = [...events].filter((event) => event._tag === "Enter").map((event) => event.node);
			assert.deepStrictEqual(
				document.findAll(() => true),
				entered,
			);
		}),
	);

	it("returns an empty array when nothing matches", () => {
		const document = parseDoc("plain paragraph\n");
		assert.deepStrictEqual(document.findAll("code"), []);
	});

	it("collects with a type-guard predicate over fidelity fields", () => {
		const document = parseDoc(source);
		const unordered = document.findAll((node): node is List => node.type === "list" && node.ordered !== true);
		assert.strictEqual(unordered.length, 1);
		assert.instanceOf(unordered[0], List);
	});
});

describe("query helpers feed MarkdownFormat.modify", () => {
	it.effect("finds a node and replaces it by identity", () =>
		Effect.gen(function* () {
			const document = parseDoc(source);
			const outro = document.findAll("heading")[2];
			assert.isDefined(outro);
			const replacement = Heading.make({ depth: 3, children: [Text.make({ value: "Fin" })] });
			const out = yield* MarkdownFormat.modifyToString(document, outro, replacement);
			assert.isTrue(out.includes("### Fin"));
			assert.isFalse(out.includes("## Outro"));
		}),
	);
});

describe("guard posture", () => {
	const overDeepDocument = (): MarkdownDocument => {
		let flow: FlowContent = Paragraph.make({ children: [Text.make({ value: "x" })] });
		for (let index = 0; index < MAX_NESTING_DEPTH + 44; index += 1) {
			flow = Blockquote.make({ children: [flow] });
		}
		return MarkdownDocument.make({
			source: "",
			root: Root.make({ children: [flow] }),
			diagnostics: [],
			definitions: new Map(),
		});
	};

	it("refuses an over-deep foreign tree as a defect, mirroring the getters", () => {
		const document = overDeepDocument();
		assert.throws(() => document.findAll("text"));
		// A find that must descend past the cap trips the same guard.
		assert.throws(() => document.find("text"));
	});

	it("returns early without visiting the deep region when a shallow node matches", () => {
		const document = overDeepDocument();
		assert.strictEqual(Option.getOrThrow(document.find("root")), document.root);
	});
});
