import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import type { YamlNode, YamlPath, YamlRange } from "../src/index.js";
import { YamlDocument, YamlMap, YamlScalar, YamlSeq } from "../src/index.js";

// An empty scalar that carries properties (`a: !!null`, `- &x`) is
// zero-length, positioned immediately after its last property token; its tag
// and anchor spans are exposed as `tagRange` / `anchorRange` (#1439, #1440).

const parse = (text: string) => Effect.map(YamlDocument.parse(text), (doc) => doc.contents);

const at = (root: YamlNode | null, path: YamlPath): YamlNode => {
	assert.isNotNull(root);
	const found = (root as YamlNode).find(path);
	assert.isTrue(Option.isSome(found), `no node at ${JSON.stringify(path)}`);
	return Option.getOrThrow(found);
};

const scalarAt = (root: YamlNode | null, path: YamlPath): YamlScalar => {
	const node = at(root, path);
	assert.instanceOf(node, YamlScalar);
	return node as YamlScalar;
};

const slice = (text: string, range: YamlRange | undefined): string | undefined =>
	range === undefined ? undefined : text.slice(range.offset, range.offset + range.length);

const assertEmptyAt = (node: YamlScalar, offset: number) => {
	assert.strictEqual(node.length, 0);
	assert.strictEqual(node.offset, offset);
};

describe("empty scalars carrying properties", () => {
	it.effect("block map: tagged and anchored empty values sit after their property", () =>
		Effect.gen(function* () {
			const text = "a: !!null\nb: &x ~\nc: !!str\nd: 1\n";
			const root = yield* parse(text);
			const a = scalarAt(root, ["a"]);
			assertEmptyAt(a, 9);
			assert.isNull(a.value);
			assert.strictEqual(slice(text, a.tagRange), "!!null");
			const b = scalarAt(root, ["b"]);
			assert.strictEqual(b.offset, 16);
			assert.strictEqual(b.length, 1);
			assert.strictEqual(slice(text, b.anchorRange), "&x");
			const c = scalarAt(root, ["c"]);
			assertEmptyAt(c, 26);
			assert.strictEqual(c.value, "");
		}),
	);

	it.effect("block map: an end-of-block flush is not at offset 0", () =>
		Effect.gen(function* () {
			for (const text of ["x:\ny: &a\nz: !t\n", "x:\ny: &a\nz: !t"]) {
				const root = yield* parse(text);
				const y = scalarAt(root, ["y"]);
				assertEmptyAt(y, 8);
				assert.strictEqual(slice(text, y.anchorRange), "&a");
				const z = scalarAt(root, ["z"]);
				assertEmptyAt(z, 14);
				assert.strictEqual(slice(text, z.tagRange), "!t");
			}
		}),
	);

	it.effect("block map: a trailing comment does not pull the span to the next line", () =>
		Effect.gen(function* () {
			const text = "a:   !!null   # c\nb: 1\n";
			const root = yield* parse(text);
			assertEmptyAt(scalarAt(root, ["a"]), 11);
		}),
	);

	it.effect("tag and anchor in either order: the span follows the later one", () =>
		Effect.gen(function* () {
			const text = "a: &x !!null\nb: !!null &y\n";
			const root = yield* parse(text);
			const a = scalarAt(root, ["a"]);
			assertEmptyAt(a, 12);
			assert.strictEqual(slice(text, a.anchorRange), "&x");
			assert.strictEqual(slice(text, a.tagRange), "!!null");
			const b = scalarAt(root, ["b"]);
			assertEmptyAt(b, 25);
			assert.strictEqual(slice(text, b.anchorRange), "&y");
			assert.strictEqual(slice(text, b.tagRange), "!!null");
		}),
	);

	it.effect("block seq: empty entries sit after their property, mid-sequence and trailing", () =>
		Effect.gen(function* () {
			const text = "- !!null\n- &a\n- 1\n";
			const root = yield* parse(text);
			assertEmptyAt(scalarAt(root, [0]), 8);
			assertEmptyAt(scalarAt(root, [1]), 13);
			const trailing = "- !!str\n- &a";
			const root2 = yield* parse(trailing);
			const first = scalarAt(root2, [0]);
			assertEmptyAt(first, 7);
			// A tagged empty entry resolves through its tag wherever it sits.
			assert.strictEqual(first.value, "");
			const last = scalarAt(root2, [1]);
			assertEmptyAt(last, 12);
			assert.strictEqual(slice(trailing, last.anchorRange), "&a");
		}),
	);

	it.effect("flow map and flow seq", () =>
		Effect.gen(function* () {
			// The space before each comma keeps the span off the separator.
			const map = "{a: !!null , b: &x }";
			const flow = yield* parse(map);
			assertEmptyAt(scalarAt(flow, ["a"]), 10);
			assertEmptyAt(scalarAt(flow, ["b"]), 18);
			const seq = "[!!null, &a , !!str]";
			const root = yield* parse(seq);
			assertEmptyAt(scalarAt(root, [0]), 7);
			assertEmptyAt(scalarAt(root, [1]), 11);
			const last = scalarAt(root, [2]);
			assertEmptyAt(last, 19);
			assert.strictEqual(last.value, "");
		}),
	);

	it.effect("document root: a lone property is an empty scalar carrying it", () =>
		Effect.gen(function* () {
			for (const text of ["!!null", "!!null\n"]) {
				const root = yield* parse(text);
				assert.instanceOf(root, YamlScalar);
				const s = root as YamlScalar;
				assertEmptyAt(s, 6);
				assert.strictEqual(s.tag, "!!null");
				assert.strictEqual(slice(text, s.tagRange), "!!null");
			}
			const str = "--- &r !!str\n";
			const root = yield* parse(str);
			assert.instanceOf(root, YamlScalar);
			const s = root as YamlScalar;
			assertEmptyAt(s, 12);
			assert.strictEqual(s.value, "");
			assert.strictEqual(slice(str, s.anchorRange), "&r");
		}),
	);

	it.effect("a verbatim tag spans the whole !<...> token", () =>
		Effect.gen(function* () {
			const text = "a: !<tag:example.com,2000:x>\n";
			const a = scalarAt(yield* parse(text), ["a"]);
			assert.strictEqual(slice(text, a.tagRange), "!<tag:example.com,2000:x>");
			assertEmptyAt(a, text.length - 1);
		}),
	);

	it.effect("findAtOffset and pathOf agree with the empty scalar's span", () =>
		Effect.gen(function* () {
			const text = "a: !!null\nb: 1\n";
			const root = yield* parse(text);
			assert.instanceOf(root, YamlMap);
			const map = root as YamlMap;
			const a = scalarAt(map, ["a"]);
			assert.deepStrictEqual(map.pathOf(a), Option.some(["a"]));
			const atNext = map.findAtOffset(10);
			assert.isTrue(Option.isSome(atNext));
			const node = Option.getOrThrow(atNext);
			assert.instanceOf(node, YamlScalar);
			assert.strictEqual((node as YamlScalar).value, "b");
		}),
	);

	it.effect("an empty scalar with no properties keeps its position", () =>
		Effect.gen(function* () {
			const root = yield* parse("- a\n-\n");
			const empty = scalarAt(root, [1]);
			assert.strictEqual(empty.length, 0);
			assert.isUndefined(empty.tagRange);
			assert.isUndefined(empty.anchorRange);
		}),
	);
});

describe("tagRange and anchorRange", () => {
	it.effect("are present on scalars, maps and seqs from source, block and flow", () =>
		Effect.gen(function* () {
			const text = "a: !!map &m\n  b: 1\nc: &s !!seq\n  - 1\nd: !!map {x: 1}\ne: &f [1]\ng: !!str &v x\n";
			const root = yield* parse(text);
			const a = at(root, ["a"]);
			assert.instanceOf(a, YamlMap);
			assert.strictEqual(slice(text, (a as YamlMap).tagRange), "!!map");
			assert.strictEqual(slice(text, (a as YamlMap).anchorRange), "&m");
			const c = at(root, ["c"]);
			assert.instanceOf(c, YamlSeq);
			assert.strictEqual(slice(text, (c as YamlSeq).tagRange), "!!seq");
			assert.strictEqual(slice(text, (c as YamlSeq).anchorRange), "&s");
			const d = at(root, ["d"]);
			assert.instanceOf(d, YamlMap);
			assert.strictEqual((d as YamlMap).style, "flow");
			assert.strictEqual(slice(text, (d as YamlMap).tagRange), "!!map");
			assert.isUndefined((d as YamlMap).anchorRange);
			const e = at(root, ["e"]);
			assert.instanceOf(e, YamlSeq);
			assert.strictEqual((e as YamlSeq).style, "flow");
			assert.strictEqual(slice(text, (e as YamlSeq).anchorRange), "&f");
			assert.isUndefined((e as YamlSeq).tagRange);
			const g = scalarAt(root, ["g"]);
			assert.strictEqual(slice(text, g.tagRange), "!!str");
			assert.strictEqual(slice(text, g.anchorRange), "&v");
			// The node's own span excludes its properties.
			assert.strictEqual(g.sourceText(text), "x");
		}),
	);

	it.effect("are present inside flow collections", () =>
		Effect.gen(function* () {
			const text = "[!!int 1, &k {a: !!str b}]";
			const root = yield* parse(text);
			const first = scalarAt(root, [0]);
			assert.strictEqual(slice(text, first.tagRange), "!!int");
			const map = at(root, [1]);
			assert.instanceOf(map, YamlMap);
			assert.strictEqual(slice(text, (map as YamlMap).anchorRange), "&k");
			assert.strictEqual(slice(text, scalarAt(root, [1, "a"]).tagRange), "!!str");
		}),
	);

	it("are absent on synthetic nodes", () => {
		const s = YamlScalar.make({ value: 1, style: "plain", offset: 0, length: 0 });
		assert.isUndefined(s.tagRange);
		assert.isUndefined(s.anchorRange);
		assert.isFalse("tagRange" in s);
	});
});

describe("YamlScalar.sourceText", () => {
	it.effect("returns the scalar as written, before resolution", () =>
		Effect.gen(function* () {
			const text = "f: 0.10\ne: 1e1\nq: 'q'\nd: \"q\"\nb: |\n  hi\n";
			const root = yield* parse(text);
			const f = scalarAt(root, ["f"]);
			assert.strictEqual(f.value, 0.1);
			assert.strictEqual(f.sourceText(text), "0.10");
			const e = scalarAt(root, ["e"]);
			assert.strictEqual(e.value, 10);
			assert.strictEqual(e.sourceText(text), "1e1");
			assert.strictEqual(scalarAt(root, ["q"]).sourceText(text), "'q'");
			assert.strictEqual(scalarAt(root, ["d"]).sourceText(text), '"q"');
			const b = scalarAt(root, ["b"]);
			assert.strictEqual(b.value, "hi\n");
			assert.strictEqual(b.sourceText(text), "|\n  hi\n");
		}),
	);

	it.effect("is empty for an empty scalar and a synthetic node", () =>
		Effect.gen(function* () {
			const text = "a: !!null\n";
			assert.strictEqual(scalarAt(yield* parse(text), ["a"]).sourceText(text), "");
			const synthetic = YamlScalar.make({ value: "x", style: "plain", offset: 0, length: 0 });
			assert.strictEqual(synthetic.sourceText("anything"), "");
		}),
	);
});
