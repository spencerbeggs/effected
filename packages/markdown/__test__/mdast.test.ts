// The Mdast projection facade: toMdast's canonical plain-JSON emission
// (the mdast-util-from-markdown shape the interop corpus pins), and
// fromMdast's checked admission of foreign mdast — null normalization,
// sentinel positions, frontmatter literal mapping, and typed failure.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, SchemaIssue } from "effect";
import { Markdown, MarkdownParseOptions } from "../src/Markdown.js";
import { Frontmatter, Root } from "../src/MarkdownNode.js";
import { Mdast, MdastDecodeError } from "../src/Mdast.js";

const gfm = (text: string): Root => {
	const parsed = Markdown.parseResult(text);
	assert.isTrue(Result.isSuccess(parsed));
	return Result.isSuccess(parsed) ? parsed.success : (undefined as never);
};

const first = (tree: unknown): Record<string, unknown> => {
	const root = tree as { children: Array<Record<string, unknown>> };
	const child = root.children[0];
	assert.isDefined(child);
	return child as Record<string, unknown>;
};

describe("Mdast.toMdast", () => {
	it("emits plain objects, not schema classes", () => {
		const projected = Mdast.toMdast(gfm("hello\n"));
		assert.strictEqual(Object.getPrototypeOf(projected), Object.prototype);
		assert.strictEqual(projected.type, "root");
	});

	it("strips fidelity extras and keeps positions", () => {
		const heading = first(Mdast.toMdast(gfm("# Title\n")));
		assert.deepStrictEqual(Object.keys(heading).sort(), ["children", "depth", "position", "type"]);
		assert.deepStrictEqual(heading.position, {
			start: { line: 1, column: 1, offset: 0 },
			end: { line: 1, column: 8, offset: 7 },
		});
	});

	it("spells list and item optionality the reference utility's way", () => {
		const list = first(Mdast.toMdast(gfm("- a\n- b\n")));
		assert.strictEqual(list.ordered, false);
		assert.strictEqual(list.start, null);
		assert.strictEqual(list.spread, false);
		const item = (list.children as Array<Record<string, unknown>>)[0];
		assert.isDefined(item);
		assert.strictEqual(item?.spread, false);
		assert.strictEqual(item?.checked, null);
	});

	it("computes list spread as blank-between-items, not looseness", () => {
		// A blank line INSIDE the single item makes the list loose for
		// rendering, but mdast's List.spread reads false: no blank line
		// separates two items.
		const withinItem = first(Mdast.toMdast(gfm("- a\n\n  b\n")));
		assert.strictEqual(withinItem.spread, false);
		// A blank line BETWEEN items reads true.
		const betweenItems = first(Mdast.toMdast(gfm("- a\n\n- b\n")));
		assert.strictEqual(betweenItems.spread, true);
	});

	it("emits explicit nulls for absent code lang and meta and strips the value terminator", () => {
		const code = first(Mdast.toMdast(gfm("```\nbody\n```\n")));
		assert.strictEqual(code.lang, null);
		assert.strictEqual(code.meta, null);
		assert.strictEqual(code.value, "body");
	});

	it("emits task-list state through checked", () => {
		const list = first(Mdast.toMdast(gfm("- [x] done\n- [ ] open\n")));
		const children = list.children as Array<Record<string, unknown>>;
		assert.strictEqual(children[0]?.checked, true);
		assert.strictEqual(children[1]?.checked, false);
	});

	it("decodes escapes and references in labels, keeping identifiers source-form", () => {
		const tree = Mdast.toMdast(gfm("[&semi;]\n\n[&semi;]: /x\n"));
		const reference = first(tree);
		const link = (reference.children as Array<Record<string, unknown>>)[0];
		assert.strictEqual(link?.label, ";");
		assert.strictEqual(link?.identifier, "&semi;");
	});

	it("projects gfm tables with alignment", () => {
		const table = first(Mdast.toMdast(gfm("| a | b |\n| :- | -: |\n| c | d |\n")));
		assert.strictEqual(table.type, "table");
		assert.deepStrictEqual(table.align, ["left", "right"]);
	});

	it("projects the frontmatter capture to a format-named literal node", () => {
		for (const [source, type, value] of [
			["---\na: 1\n---\nbody\n", "yaml", "a: 1"],
			["+++\na = 1\n+++\nbody\n", "toml", "a = 1"],
			['---json\n{ "a": 1 }\n---\nbody\n', "json", '{ "a": 1 }'],
		] as const) {
			const parsed = Markdown.parseResult(source, MarkdownParseOptions.make({ frontmatter: true }));
			assert.isTrue(Result.isSuccess(parsed));
			if (Result.isSuccess(parsed)) {
				const node = first(Mdast.toMdast(parsed.success));
				assert.strictEqual(node.type, type);
				assert.strictEqual(node.value, value);
			}
		}
	});
});

describe("Mdast.fromMdast", () => {
	it("round-trips a parsed tree through plain mdast, positions included", () => {
		const root = gfm("# T\n\ntext with *emphasis* and ~~strike~~\n\n- [x] item\n");
		const back = Mdast.fromMdastResult(Mdast.toMdast(root));
		assert.isTrue(Result.isSuccess(back));
		if (Result.isSuccess(back)) {
			assert.instanceOf(back.success, Root);
			assert.deepStrictEqual(Mdast.toMdast(back.success), Mdast.toMdast(root));
		}
	});

	it("normalizes explicit nulls to absence", () => {
		const back = Mdast.fromMdastResult({
			type: "root",
			children: [
				{
					type: "list",
					ordered: false,
					start: null,
					spread: false,
					children: [{ type: "listItem", spread: false, checked: null, children: [] }],
				},
			],
		});
		assert.isTrue(Result.isSuccess(back));
		if (Result.isSuccess(back)) {
			const list = back.success.children[0];
			assert.strictEqual(list?.type, "list");
			if (list?.type === "list") {
				assert.isFalse(Object.hasOwn(list, "start"));
				const item = list.children[0];
				assert.isDefined(item);
				assert.isFalse(Object.hasOwn(item as object, "checked"));
				// Explicit false is a value, not absence.
				assert.strictEqual(list.ordered, false);
			}
		}
	});

	it("synthesizes the zero-width sentinel for missing positions", () => {
		const back = Mdast.fromMdastResult({
			type: "root",
			children: [{ type: "paragraph", children: [{ type: "text", value: "hi" }] }],
		});
		assert.isTrue(Result.isSuccess(back));
		if (Result.isSuccess(back)) {
			const paragraph = back.success.children[0];
			assert.deepStrictEqual({ ...paragraph?.position.start }, { line: 1, column: 1, offset: 0 });
		}
	});

	it("keeps complete foreign positions and drops incomplete ones", () => {
		const back = Mdast.fromMdastResult({
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						{
							type: "text",
							value: "hi",
							position: { start: { line: 3, column: 2, offset: 12 }, end: { line: 3, column: 4, offset: 14 } },
						},
					],
					position: { start: { line: 3 }, end: { line: 3 } },
				},
			],
		});
		assert.isTrue(Result.isSuccess(back));
		if (Result.isSuccess(back)) {
			const paragraph = back.success.children[0];
			assert.strictEqual(paragraph?.position.start.offset, 0);
			const text = paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;
			assert.strictEqual(text?.position.start.offset, 12);
		}
	});

	it("decodes frontmatter literal nodes into the capture class", () => {
		const back = Mdast.fromMdastResult({
			type: "root",
			children: [{ type: "yaml", value: "a: 1" }],
		});
		assert.isTrue(Result.isSuccess(back));
		if (Result.isSuccess(back)) {
			const node = back.success.children[0];
			assert.instanceOf(node, Frontmatter);
			if (node instanceof Frontmatter) {
				assert.strictEqual(node.format, "yaml");
				assert.strictEqual(node.value, "a: 1");
			}
		}
	});

	it("restores the code value terminator", () => {
		const back = Mdast.fromMdastResult({
			type: "root",
			children: [{ type: "code", lang: null, meta: null, value: "body" }],
		});
		assert.isTrue(Result.isSuccess(back));
		if (Result.isSuccess(back)) {
			const code = back.success.children[0];
			assert.strictEqual(code?.type === "code" ? code.value : "", "body\n");
		}
	});

	it("drops foreign data fields at the boundary", () => {
		const back = Mdast.fromMdastResult({
			type: "root",
			children: [{ type: "paragraph", data: { custom: true }, children: [{ type: "text", value: "x" }] }],
		});
		assert.isTrue(Result.isSuccess(back));
		if (Result.isSuccess(back)) {
			assert.isFalse(Object.hasOwn(back.success.children[0] as object, "data"));
		}
	});

	it("fails typed on an unknown node type, carrying the structured issue", () => {
		const back = Mdast.fromMdastResult({
			type: "root",
			children: [{ type: "widget", value: "?" }],
		});
		assert.isTrue(Result.isFailure(back));
		if (Result.isFailure(back)) {
			assert.instanceOf(back.failure, MdastDecodeError);
			assert.isDefined(back.failure.issue);
		}
	});

	it("fails typed on non-tree junk", () => {
		for (const junk of [42, "root", null, { type: 7 }]) {
			assert.isTrue(Result.isFailure(Mdast.fromMdastResult(junk)));
		}
	});

	it.effect("agrees with the Effect twin on both channels", () =>
		Effect.gen(function* () {
			const good = { type: "root", children: [] };
			const bad = { type: "widget" };
			assert.deepStrictEqual(yield* Effect.result(Mdast.fromMdast(good)), Mdast.fromMdastResult(good) as never);
			const effectFailure = yield* Effect.result(Effect.flip(Mdast.fromMdast(bad)));
			assert.isTrue(Result.isSuccess(effectFailure));
		}),
	);

	describe("nesting depth guard", () => {
		// Depth counts from the root at 0: root(0) > paragraph(1) >
		// emphasis(2..N+1) > text(N+2). The cap admits depth 256, so 254
		// emphasis levels is the deepest tree that decodes.
		const emphasisChain = (levels: number): unknown => {
			let node: unknown = { type: "text", value: "leaf" };
			for (let i = 0; i < levels; i++) node = { type: "emphasis", children: [node] };
			return { type: "root", children: [{ type: "paragraph", children: [node] }] };
		};

		it("decodes a tree whose deepest node sits exactly at the cap", () => {
			assert.isTrue(Result.isSuccess(Mdast.fromMdastResult(emphasisChain(254))));
		});

		it("fails typed one level past the cap, naming the depth", () => {
			const result = Mdast.fromMdastResult(emphasisChain(255));
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.instanceOf(result.failure, MdastDecodeError);
				const issue = result.failure.issue;
				assert.instanceOf(issue, SchemaIssue.InvalidValue);
				assert.isTrue(SchemaIssue.isIssue(issue));
				assert.include(String((issue as SchemaIssue.InvalidValue).annotations?.message), "limit 256, actual 257");
			}
		});

		it("fails typed rather than throwing on input deep enough to exhaust the stack", () => {
			// 1000 levels once threw from the schema decoder; 3000 overflowed the stack.
			for (const levels of [1000, 3000]) {
				const result = Mdast.fromMdastResult(emphasisChain(levels));
				assert.isTrue(Result.isFailure(result), `${levels} levels`);
				if (Result.isFailure(result)) assert.instanceOf(result.failure, MdastDecodeError);
			}
		});

		it("refuses a parsed tree whose leaf sits past the cap, as stringify does", () => {
			// The parser caps container depth, not leaf depth: 255 nested
			// blockquotes parse, but the text leaf lands at depth 257.
			const atCap = gfm(`${"> ".repeat(254)}x\n`);
			assert.isTrue(Result.isSuccess(Mdast.fromMdastResult(Mdast.toMdast(atCap))));
			const pastCap = gfm(`${"> ".repeat(255)}x\n`);
			assert.isTrue(Result.isFailure(Mdast.fromMdastResult(Mdast.toMdast(pastCap))));
			assert.isTrue(Result.isFailure(Markdown.stringifyResult(pastCap)));
		});
	});
});
