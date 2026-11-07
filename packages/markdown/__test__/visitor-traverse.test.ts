// MarkdownVisitor.traverse: the callback form of the walk. It shares the
// engine with `walk`/`visit` (same order, path, depth and depth guard), adds
// SKIP/EXIT steering and ancestors, and narrows its callbacks by a type
// selector. The first test pins the shared-engine claim against `walk` over
// the CommonMark spec corpus, so the two forms cannot drift apart unnoticed.

import { assert, describe, it } from "@effect/vitest";
import { Option, Result } from "effect";
import { Markdown } from "../src/Markdown.js";
import type { Heading, MarkdownNode, Root } from "../src/MarkdownNode.js";
import { Blockquote, Paragraph, Point, Position, Root as RootNode, Text } from "../src/MarkdownNode.js";
import type { MarkdownVisitContext } from "../src/MarkdownVisitor.js";
import { MarkdownVisitor } from "../src/MarkdownVisitor.js";
import { loadSpecExamples } from "./e2e/support/corpus.js";

const parse = (text: string): Root => {
	const result = Markdown.parseResult(text, { dialect: "gfm", frontmatter: true });
	assert.isTrue(Result.isSuccess(result));
	return Result.getOrThrow(result);
};

const fromWalk = (root: Root): Array<string> => {
	const out: Array<string> = [];
	for (const event of MarkdownVisitor.walk(root)) {
		if (event._tag === "Error") out.push("Error");
		else out.push(`${event._tag}:${event.node.type}@${event.depth}[${event.path.join(".")}]`);
	}
	return out;
};

const fromTraverse = (root: Root): Array<string> => {
	const out: Array<string> = [];
	const record = (tag: string) => (node: MarkdownNode, context: MarkdownVisitContext) => {
		out.push(`${tag}:${node.type}@${context.depth}[${context.path.join(".")}]`);
		return undefined;
	};
	MarkdownVisitor.traverse(root, { enter: record("Enter"), exit: record("Exit") });
	return out;
};

const entered = (root: Root, enter: (node: MarkdownNode) => "skip" | "exit" | undefined): Array<string> => {
	const out: Array<string> = [];
	MarkdownVisitor.traverse(root, {
		enter: (node) => {
			out.push(`+${node.type}`);
			return enter(node);
		},
		exit: (node) => {
			out.push(`-${node.type}`);
			return undefined;
		},
	});
	return out;
};

const synthetic = Position.make({
	start: Point.make({ line: 1, column: 1, offset: 0 }),
	end: Point.make({ line: 1, column: 1, offset: 0 }),
});

describe("MarkdownVisitor.traverse", () => {
	it("produces exactly walk's event sequence over the CommonMark spec corpus", () => {
		const examples = loadSpecExamples();
		// A silently-empty corpus would make this loop vacuous.
		assert.isAbove(examples.length, 600);
		for (const example of examples) {
			const root = parse(example.markdown);
			assert.deepStrictEqual(fromTraverse(root), fromWalk(root), `spec example ${example.example}`);
		}
	});

	it("SKIP from enter keeps the walk out of the children but still runs the node's exit", () => {
		const root = parse("> a *b*\n\nc\n");
		const events = entered(root, (node) => (node.type === "blockquote" ? MarkdownVisitor.SKIP : undefined));
		assert.deepStrictEqual(events, [
			"+root",
			"+blockquote",
			"-blockquote",
			"+paragraph",
			"+text",
			"-text",
			"-paragraph",
			"-root",
		]);
	});

	it("SKIP from exit means continue", () => {
		const root = parse("a\n\nb\n");
		const seen: Array<string> = [];
		MarkdownVisitor.traverse(root, {
			enter: (node) => {
				seen.push(node.type);
				return undefined;
			},
			exit: () => MarkdownVisitor.SKIP,
		});
		assert.deepStrictEqual(seen, ["root", "paragraph", "text", "paragraph", "text"]);
	});

	it("EXIT from enter ends the walk with no further callback, ancestors' exits included", () => {
		const root = parse("> a *b*\n\nc\n");
		const events = entered(root, (node) => (node.type === "emphasis" ? MarkdownVisitor.EXIT : undefined));
		assert.deepStrictEqual(events, ["+root", "+blockquote", "+paragraph", "+text", "-text", "+emphasis"]);
	});

	it("EXIT from exit ends the walk", () => {
		const root = parse("a\n\nb\n");
		const seen: Array<string> = [];
		const outcome = MarkdownVisitor.traverse(root, {
			enter: (node) => {
				seen.push(`+${node.type}`);
				return MarkdownVisitor.CONTINUE;
			},
			exit: (node) => {
				seen.push(`-${node.type}`);
				return node.type === "paragraph" ? MarkdownVisitor.EXIT : undefined;
			},
		});
		assert.isTrue(Option.isNone(outcome));
		assert.deepStrictEqual(seen, ["+root", "+paragraph", "+text", "-text", "-paragraph"]);
	});

	it("a type selector narrows the callback and filters callbacks, not the tree", () => {
		const root = parse("# One\n\n> ## Two\n\n- ### Three\n");
		const depths: Array<number> = [];
		MarkdownVisitor.traverse(root, "heading", {
			enter: (heading: Heading) => {
				// `depth` exists only on Heading: the selector narrowed the type.
				depths.push(heading.depth);
				return undefined;
			},
		});
		// Headings nested in a blockquote and a list item are still reached.
		assert.deepStrictEqual(depths, [1, 2, 3]);
	});

	it("an array selector matches any listed type, and SKIP applies to the matched subtree", () => {
		const root = parse("# A\n\n> # B\n\n## C\n");
		const depths: Array<number> = [];
		MarkdownVisitor.traverse(root, ["heading", "blockquote"], {
			enter: (node) => {
				if (node.type === "blockquote") return MarkdownVisitor.SKIP;
				depths.push(node.depth);
				return undefined;
			},
		});
		assert.deepStrictEqual(depths, [1, 2]);
	});

	it("rejects a callback typed for the wrong node at compile time", () => {
		const root = parse("text\n");
		MarkdownVisitor.traverse(root, "paragraph", {
			// @ts-expect-error: a paragraph callback cannot read Heading's depth.
			enter: (node) => (node.depth > 0 ? undefined : undefined),
		});
		assert.isTrue(true);
	});

	it("hands each callback its ancestors, root first and parent last, as a snapshot", () => {
		const root = parse("> - item\n");
		const snapshots: Array<ReadonlyArray<MarkdownNode>> = [];
		MarkdownVisitor.traverse(root, "text", {
			enter: (_node, context) => {
				snapshots.push(context.ancestors);
				return undefined;
			},
			exit: (_node, context) => {
				snapshots.push(context.ancestors);
				return undefined;
			},
		});
		assert.lengthOf(snapshots, 2);
		const types = (ancestors: ReadonlyArray<MarkdownNode>) => ancestors.map((node) => node.type);
		assert.deepStrictEqual(types(snapshots[0] ?? []), ["root", "blockquote", "list", "listItem", "paragraph"]);
		// The enter snapshot is unchanged after the walk moved on.
		assert.deepStrictEqual(types(snapshots[0] ?? []), types(snapshots[1] ?? []));
		assert.strictEqual(snapshots[0]?.[0], root);
	});

	it("keeps every kept ancestors snapshot true to its node after the walk moves on, sharing and freezing them", () => {
		const root = parse("# A *b*\n\n- one\n- two **x**\n\n> quote\n\npara\n");
		const seen: Array<{
			readonly path: MarkdownVisitContext["path"];
			readonly ancestors: ReadonlyArray<MarkdownNode>;
		}> = [];
		const record = (_node: MarkdownNode, context: MarkdownVisitContext) => {
			seen.push({ path: context.path, ancestors: context.ancestors });
			return undefined;
		};
		MarkdownVisitor.traverse(root, { enter: record, exit: record });
		// Each node's ancestors, re-derived from its path after the walk ended.
		const expected = (path: MarkdownVisitContext["path"]): Array<MarkdownNode> => {
			const out: Array<MarkdownNode> = [];
			let node: MarkdownNode = root;
			for (const index of path) {
				out.push(node);
				node = (node as { readonly children: ReadonlyArray<MarkdownNode> }).children[Number(index)] as MarkdownNode;
			}
			return out;
		};
		assert.isAbove(seen.length, 20);
		for (const { path, ancestors } of seen) {
			assert.strictEqual(ancestors.length, path.length, path.join("."));
			for (const [index, node] of ancestors.entries()) assert.strictEqual(node, expected(path)[index], path.join("."));
			assert.isTrue(Object.isFrozen(ancestors));
		}
		// Siblings see one array, not a copy each.
		const listItems = seen.filter(({ path }) => path.length === 2 && path[0] === 1);
		assert.isAtLeast(listItems.length, 4);
		for (const { ancestors } of listItems) assert.strictEqual(ancestors, listItems[0]?.ancestors);
	});

	it("the root's ancestors are empty", () => {
		const root = parse("x\n");
		let rootAncestors: ReadonlyArray<MarkdownNode> | undefined;
		MarkdownVisitor.traverse(root, "root", {
			enter: (_node, context) => {
				rootAncestors = context.ancestors;
				return undefined;
			},
		});
		assert.deepStrictEqual(rootAncestors, []);
	});

	it("returns the depth-guard diagnostic for a hand-built tree nested past the cap", () => {
		let node: Blockquote | Paragraph = Paragraph.make({
			children: [Text.make({ value: "x", position: synthetic })],
			position: synthetic,
		});
		for (let i = 0; i < 300; i++) node = Blockquote.make({ children: [node], position: synthetic });
		const tree = RootNode.make({ children: [node], position: synthetic });
		let enters = 0;
		const outcome = MarkdownVisitor.traverse(tree, {
			enter: () => {
				enters++;
				return undefined;
			},
		});
		assert.isTrue(Option.isSome(outcome));
		if (Option.isSome(outcome)) assert.strictEqual(outcome.value.code, "NestingDepthExceeded");
		// Root (depth 0) through depth 256 entered; depth 257 trips the guard.
		assert.strictEqual(enters, 257);
	});

	it("a walk past the depth cap is skipped when SKIP keeps it out of the deep subtree", () => {
		let node: Blockquote | Paragraph = Paragraph.make({
			children: [Text.make({ value: "x", position: synthetic })],
			position: synthetic,
		});
		for (let i = 0; i < 300; i++) node = Blockquote.make({ children: [node], position: synthetic });
		const tree = RootNode.make({ children: [node], position: synthetic });
		const outcome = MarkdownVisitor.traverse(tree, {
			enter: (visited) => (visited.type === "blockquote" ? MarkdownVisitor.SKIP : undefined),
		});
		assert.isTrue(Option.isNone(outcome));
	});

	it("lets a callback's throw propagate unchanged", () => {
		const root = parse("x\n");
		const boom = new Error("boom");
		assert.throws(
			() =>
				MarkdownVisitor.traverse(root, {
					enter: () => {
						throw boom;
					},
				}),
			"boom",
		);
	});

	it("leaves walk unsteerable: a for…of over walk enters every node", () => {
		const root = parse("> a\n");
		const types: Array<string> = [];
		for (const event of MarkdownVisitor.walk(root)) if (event._tag === "Enter") types.push(event.node.type);
		assert.deepStrictEqual(types, ["root", "blockquote", "paragraph", "text"]);
	});
});
