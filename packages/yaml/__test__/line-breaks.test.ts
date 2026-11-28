// YAML 1.2 §5.4: a line break (`b-break`) is `\r\n`, `\r` or `\n`, and every
// one of them breaks a line the same way. The engine once read a bare `\r` as
// ordinary content, so `"- x\r- y"` composed to one plain scalar
// (`[["x - x\r- y"]]`-shaped) and `"a: 1\r..."` to `{ a: "1 ..." }`. The
// LF, CR and CRLF twins of generated documents are compared in
// `line-breaks.property.test.ts`.

import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { Yaml, YamlDocument } from "../src/index.js";

const CR = String.fromCodePoint(13);
const LF = String.fromCodePoint(10);
const CRLF = `${CR}${LF}`;

describe("a bare CR is a line break", () => {
	it("separates block sequence entries", () => {
		assert.deepStrictEqual(Yaml.parseResult(`- x${CR}- y`), Result.succeed(["x", "y"]));
	});

	it("ends a document before a `...` marker", () => {
		assert.deepStrictEqual(Yaml.parseAllResult(`a: 1${CR}...`), Result.succeed([{ a: 1 }]));
	});

	it("starts a new mapping entry at the same indentation", () => {
		assert.deepStrictEqual(Yaml.parseResult(`a: 1${CR}b: 2${CR}`), Result.succeed({ a: 1, b: 2 }));
	});

	it("tracks indentation after it", () => {
		assert.deepStrictEqual(Yaml.parseResult(`a:${CR}  b: 1${CR}c: 2`), Result.succeed({ a: { b: 1 }, c: 2 }));
	});

	it("folds a multi-line plain scalar like `\\n` does", () => {
		assert.deepStrictEqual(Yaml.parseResult(`a b${CR}  c${CR}${CR}  d`), Result.succeed("a b c\nd"));
	});

	it("folds inside single- and double-quoted scalars like `\\n` does", () => {
		assert.deepStrictEqual(Yaml.parseResult(`'a${CR}b'`), Result.succeed("a b"));
		assert.deepStrictEqual(Yaml.parseResult(`"a${CR}${CR}b"`), Result.succeed("a\nb"));
		assert.deepStrictEqual(Yaml.parseResult(`"a\\${CR}  b"`), Result.succeed("ab"));
	});

	it("normalizes to `\\n` inside a block scalar", () => {
		assert.deepStrictEqual(Yaml.parseResult(`k: |${CR}  a${CR}  b${CR}`), Result.succeed({ k: "a\nb\n" }));
		assert.deepStrictEqual(Yaml.parseResult(`k: >${CR}  a${CR}  b${CR}`), Result.succeed({ k: "a b\n" }));
	});

	it("ends a comment", () => {
		assert.deepStrictEqual(Yaml.parseResult(`# c${CR}a: 1`), Result.succeed({ a: 1 }));
	});

	it("separates documents at `---`", () => {
		assert.deepStrictEqual(Yaml.parseAllResult(`a${CR}---${CR}b`), Result.succeed(["a", "b"]));
	});

	it("keeps the node offsets the source has", () => {
		const doc = YamlDocument.parseResult(`a: 1${CR}b: 2`);
		assert.isTrue(Result.isSuccess(doc));
		if (Result.isSuccess(doc)) {
			const value = doc.success.contents;
			assert.isDefined(value);
			assert.strictEqual(value?.offset, 0);
			assert.strictEqual(value?.length, 9);
		}
	});
});

describe("CRLF folds inside a single-quoted scalar like `\\n`", () => {
	it("leaves no `\\r` at the end of a folded line", () => {
		// `foldFlowLines` split on `\n` only, so the `\r` of a CRLF survived the
		// first line's trailing trim.
		assert.deepStrictEqual(Yaml.parseResult(`'a${CRLF}'`), Result.succeed("a "));
		assert.deepStrictEqual(Yaml.parseResult(`'a${CRLF}${CRLF}b'`), Result.succeed("a\nb"));
	});
});
