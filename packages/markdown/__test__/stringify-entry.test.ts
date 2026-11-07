import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import * as RootEntry from "../src/index.js";
import { Markdown } from "../src/Markdown.js";
import * as Entry from "../src/stringify.js";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** Reads a module's text; the real graph reads the disk, the mutation control reads a map. */
type Read = (file: string) => string;
const readDisk: Read = (file) => readFileSync(file, "utf8");

/**
 * The relative specifiers a module loads at RUNTIME. Comments are stripped (line comments first, so a `//` comment
 * holding a `/*` cannot open a block), and `import type`/`export type` statements are dropped: they are erased, so
 * they reach nothing a bundler keeps. An inline `{ type X, Y }` stays, because `Y` is a value.
 */
const runtimeSpecifiersOf = (text: string): ReadonlyArray<string> => {
	const code = text
		.replace(/^\s*\/\/.*$/gm, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*(?:import|export)\s+type\s[\s\S]*?from\s*["'][^"']+["'];?/gm, "");
	return [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.[^"']+)\1/g)].map(
		(match) => match[2] ?? "",
	);
};

/** Every source module reachable from `entry` through runtime imports, as paths relative to `src/`. */
const reachableFrom = (entry: string, read: Read = readDisk): ReadonlySet<string> => {
	const seen = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || seen.has(file)) continue;
		seen.add(file);
		for (const specifier of runtimeSpecifiersOf(read(file))) {
			queue.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
		}
	}
	return new Set([...seen].map((file) => relative(SRC, file)));
};

/** The parser, the document model built on it, and the entity table only decoding needs. */
const isParserModule = (path: string): boolean =>
	/^(?:Markdown|MarkdownDocument|MarkdownFormat|MarkdownVisitor|Mdast|Frontmatter\w*)\.ts$/.test(path) ||
	/^internal\/(?:blocks|inlines)\//.test(path) ||
	/^internal\/(?:blockParser|blockRegistry|inlineParser|inlineRegistry|phrasing|preprocess|entities|entityMap|unescape|references)\.ts$/.test(
		path,
	);

describe("the ./stringify entry point's module graph", () => {
	const reached = reachableFrom(resolve(SRC, "stringify.ts"));

	it("reaches the serializer and the node classes, and nothing of the parser or the entity table", () => {
		// The control: the walk resolved the modules the entry genuinely needs.
		for (const needed of ["MarkdownStringify.ts", "MarkdownNode.ts", "internal/stringify.ts", "internal/grammar.ts"]) {
			assert.isTrue(reached.has(needed), needed);
		}
		assert.deepStrictEqual([...reached].filter(isParserModule).sort(), []);
	});

	it("positive control: the root entry DOES reach the parser and the entity table", () => {
		const root = reachableFrom(resolve(SRC, "index.ts"));
		for (const parser of ["internal/blockParser.ts", "internal/inlineParser.ts", "internal/entityMap.ts"]) {
			assert.isTrue(root.has(parser), parser);
		}
	});

	it("mutation control: a parser module reached transitively is found; one in a comment or a type import is not", () => {
		const files: Record<string, string> = {
			[resolve(SRC, "stringify.ts")]:
				'// import { x } from "./internal/entityMap.js";\nimport type { D } from "./MarkdownDocument.js";\nexport { a } from "./a.js";',
			[resolve(SRC, "a.ts")]: '/* from "./Markdown.js" */\nexport const a = () => import("./internal/phrasing.js");',
			[resolve(SRC, "internal/phrasing.ts")]: "export const p = 1;",
		};
		const read: Read = (file) => files[file] ?? "";
		assert.deepStrictEqual([...reachableFrom(resolve(SRC, "stringify.ts"), read)].filter(isParserModule), [
			"internal/phrasing.ts",
		]);
	});
});

describe("the ./stringify entry point's exports", () => {
	it("exports the serializer, its error, the diagnostic and the whole node vocabulary", () => {
		assert.deepStrictEqual(Object.keys(Entry).sort(), [
			"Blockquote",
			"Break",
			"BreakStyle",
			"BulletChar",
			"Code",
			"Definition",
			"Delete",
			"Emphasis",
			"EmphasisChar",
			"FenceChar",
			"FlowContent",
			"FootnoteDefinition",
			"FootnoteReference",
			"Frontmatter",
			"FrontmatterContent",
			"FrontmatterFormat",
			"Heading",
			"HeadingDepth",
			"HeadingStyle",
			"Html",
			"Image",
			"ImageReference",
			"InlineCode",
			"Link",
			"LinkReference",
			"List",
			"ListContent",
			"ListDelimiter",
			"ListItem",
			"MarkdownDiagnostic",
			"MarkdownNode",
			"MarkdownParseErrorCode",
			"MarkdownStringifyError",
			"MdxFlowExpression",
			"MdxJsxAttribute",
			"MdxJsxAttributeContent",
			"MdxJsxAttributeValueExpression",
			"MdxJsxExpressionAttribute",
			"MdxJsxFlowElement",
			"MdxJsxTextElement",
			"MdxTextExpression",
			"MdxjsEsm",
			"Paragraph",
			"PhrasingContent",
			"Point",
			"Position",
			"ReferenceType",
			"Root",
			"RowContent",
			"Strong",
			"Table",
			"TableAlign",
			"TableCell",
			"TableContent",
			"TableRow",
			"Text",
			"ThematicBreak",
			"ThematicBreakChar",
			"stringify",
			"stringifyResult",
		]);
	});

	it("shares every export with the root entry by identity, so a tree built from either serializes through both", () => {
		const root = RootEntry as Record<string, unknown>;
		for (const [name, value] of Object.entries(Entry)) {
			assert.strictEqual(root[name], value, name);
		}
	});

	it("is what the Markdown statics delegate to", () => {
		assert.strictEqual(Markdown.stringify, Entry.stringify);
	});
});

describe("stringify and stringifyResult as free functions", () => {
	const tree = Entry.Root.make({
		children: [
			Entry.Heading.make({ depth: 2, children: [Entry.Text.make({ value: "Usage" })] }),
			Entry.List.make({
				ordered: false,
				spread: false,
				bulletChar: "*",
				children: [
					Entry.ListItem.make({
						spread: false,
						children: [Entry.Paragraph.make({ children: [Entry.Text.make({ value: "snake_case & a*b" })] })],
					}),
				],
			}),
		],
	});

	it("emits exactly the bytes the Markdown static emits, with and without canonical", () => {
		assert.deepStrictEqual(Entry.stringifyResult(tree), Markdown.stringifyResult(tree));
		assert.deepStrictEqual(
			Entry.stringifyResult(tree, { canonical: true }),
			Markdown.stringifyResult(tree, { canonical: true }),
		);
		assert.strictEqual(Result.getOrThrow(Entry.stringifyResult(tree)), "## Usage\n\n* snake_case & a\\*b\n");
		assert.strictEqual(
			Result.getOrThrow(Entry.stringifyResult(tree, { canonical: true })),
			"## Usage\n\n- snake_case & a\\*b\n",
		);
	});

	it("runs the TSDoc example as written", () => {
		const example = Entry.Root.make({
			children: [Entry.Heading.make({ depth: 2, children: [Entry.Text.make({ value: "Usage" })] })],
		});
		assert.strictEqual(Result.getOrThrow(Entry.stringifyResult(example)), "## Usage\n");
	});

	it.effect("stringify is the Effect twin", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* Entry.stringify(tree), Result.getOrThrow(Entry.stringifyResult(tree)));
		}),
	);

	it.effect("a tree nested past the cap fails typed with MarkdownStringifyError", () =>
		Effect.gen(function* () {
			let node: InstanceType<typeof Entry.Blockquote> = Entry.Blockquote.make({ children: [] });
			for (let depth = 0; depth < 400; depth += 1) node = Entry.Blockquote.make({ children: [node] });
			const error = yield* Effect.flip(Entry.stringify(Entry.Root.make({ children: [node] })));
			assert.instanceOf(error, Entry.MarkdownStringifyError);
			assert.strictEqual(error.diagnostic.code, "NestingDepthExceeded");
		}),
	);
});
