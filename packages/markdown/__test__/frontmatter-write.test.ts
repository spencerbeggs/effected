// Coverage for the typed frontmatter write seam (`MarkdownFrontmatter.set` /
// `setToString`) and the codecs' `encode` members.
//
// The write side mirrors the decode seam: schema-ENCODE the typed data,
// serialize the encoded value through the codec, then splice — one
// whole-block replacement when a capture of the codec's format exists, one
// offset-0 insert when the document has none. The empty-object rulings are
// pinned per codec: yaml encodes `{}` to the flow mapping body `{}\n`
// (deliberately not an empty body, which would round-trip as `null`), toml
// encodes `{}` to the empty body (the mirror of its empty-capture decode
// ruling), json encodes `{}` to `{}`. The write round-trip properties are in
// `frontmatter-write.property.test.ts`.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import {
	FrontmatterEncodeError,
	FrontmatterFormatMismatchError,
	FrontmatterValidationError,
	MarkdownFrontmatter,
} from "../src/Frontmatter.js";
import { JsonFrontmatter } from "../src/JsonFrontmatter.js";
import { MarkdownParseOptions } from "../src/Markdown.js";
import { MarkdownDocument } from "../src/MarkdownDocument.js";
import { MarkdownEdit } from "../src/MarkdownEdit.js";
import { TomlFrontmatter } from "../src/TomlFrontmatter.js";
import { YamlFrontmatter } from "../src/YamlFrontmatter.js";

const withFrontmatter = MarkdownParseOptions.make({ frontmatter: true });
const parseDoc = (source: string) => MarkdownDocument.parse(source, withFrontmatter);

const Meta = Schema.Struct({
	title: Schema.String,
	count: Schema.Number,
});

describe("codec encode", () => {
	it.effect("YamlFrontmatter.encode pins the empty object to the flow mapping body", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* YamlFrontmatter.encode({}), "{}\n");
		}),
	);

	it.effect("TomlFrontmatter.encode pins the empty object to the empty body", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* TomlFrontmatter.encode({}), "");
		}),
	);

	it.effect("JsonFrontmatter.encode pins the empty object to {}", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* JsonFrontmatter.encode({}), "{}");
		}),
	);

	it.effect("encode output is the body only — never fences", () =>
		Effect.gen(function* () {
			const yaml = yield* YamlFrontmatter.encode({ title: "Hi" });
			const toml = yield* TomlFrontmatter.encode({ title: "Hi" });
			const json = yield* JsonFrontmatter.encode({ title: "Hi" });
			assert.strictEqual(yaml, "title: Hi\n");
			assert.strictEqual(toml, 'title = "Hi"\n');
			assert.strictEqual(json, '{\n  "title": "Hi"\n}');
		}),
	);

	it.effect("a serialization failure is typed with the format package's error preserved structurally", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(JsonFrontmatter.encode({ big: BigInt(1) }));
			assert.instanceOf(error, FrontmatterEncodeError);
			assert.strictEqual(error._tag, "FrontmatterEncodeError");
			assert.strictEqual(error.format, "json");
			// The cause is the jsonc engine's typed stringify error, never a string.
			assert.strictEqual((error.cause as { readonly _tag: string })._tag, "JsoncStringifyError");
		}),
	);
});

describe("MarkdownFrontmatter.set", () => {
	it.effect("replaces an existing yaml block with one edit and preserves the rest byte-identically", () =>
		Effect.gen(function* () {
			const source = "---\ntitle: Old\ncount: 1\n---\n\n# Body\n\ntext after the block\n";
			const document = yield* parseDoc(source);
			const node = Option.getOrThrow(document.frontmatter);
			const edits = yield* MarkdownFrontmatter.set(Meta, YamlFrontmatter)(document, { title: "New", count: 2 });
			assert.strictEqual(edits.length, 1);
			assert.strictEqual(edits[0]?.offset, 0);
			const updated = MarkdownEdit.applyAll(source, edits);
			// Everything after the closing fence survives byte-identical.
			assert.isTrue(updated.endsWith(source.slice(node.position.end.offset)));
			// The re-parsed document decodes the new data with the same tree shape.
			const reparsed = yield* parseDoc(updated);
			const data = yield* MarkdownFrontmatter.schema(Meta, YamlFrontmatter)(reparsed);
			assert.deepStrictEqual(data, { title: "New", count: 2 });
			assert.deepStrictEqual(
				reparsed.root.children.map((child) => child.type),
				document.root.children.map((child) => child.type),
			);
		}),
	);

	it.effect("inserts a fenced block at offset 0 with a blank line when the document has none", () =>
		Effect.gen(function* () {
			const source = "# Body\n\ntext\n";
			const document = yield* parseDoc(source);
			const edits = yield* MarkdownFrontmatter.set(Meta, TomlFrontmatter)(document, { title: "Hi", count: 3 });
			assert.strictEqual(edits.length, 1);
			assert.strictEqual(edits[0]?.offset, 0);
			assert.strictEqual(edits[0]?.length, 0);
			const updated = MarkdownEdit.applyAll(source, edits);
			// The existing content survives byte-identical after the blank line.
			assert.isTrue(updated.endsWith(`\n\n${source}`));
			const reparsed = yield* parseDoc(updated);
			const data = yield* MarkdownFrontmatter.schema(Meta, TomlFrontmatter)(reparsed);
			assert.deepStrictEqual(data, { title: "Hi", count: 3 });
		}),
	);

	it.effect("a format mismatch fails typed and never switches fences", () =>
		Effect.gen(function* () {
			const document = yield* parseDoc('+++\ntitle = "Old"\ncount = 1\n+++\n\nbody\n');
			const error = yield* Effect.flip(
				MarkdownFrontmatter.set(Meta, YamlFrontmatter)(document, { title: "New", count: 2 }),
			);
			assert.instanceOf(error, FrontmatterFormatMismatchError);
			assert.strictEqual(error.expected, "yaml");
			assert.strictEqual(error.actual, "toml");
		}),
	);

	it.effect(
		"schema-encode-invalid data fails typed with FrontmatterValidationError carrying the structured issue",
		() =>
			Effect.gen(function* () {
				const document = yield* parseDoc("# Body\n");
				const error = yield* Effect.flip(
					MarkdownFrontmatter.set(Meta, YamlFrontmatter)(document, { title: 42, count: "x" } as never),
				);
				assert.instanceOf(error, FrontmatterValidationError);
				// The issue is the structured v4 issue tree, never a string.
				assert.isObject(error.issue);
				assert.isString((error.issue as { readonly _tag: string })._tag);
			}),
	);

	it.effect("a codec serialization failure propagates as FrontmatterEncodeError", () =>
		Effect.gen(function* () {
			const document = yield* parseDoc("# Body\n");
			const error = yield* Effect.flip(
				MarkdownFrontmatter.set(Schema.Unknown, JsonFrontmatter)(document, { big: BigInt(1) }),
			);
			assert.instanceOf(error, FrontmatterEncodeError);
			assert.strictEqual(error.format, "json");
		}),
	);
});

describe("MarkdownFrontmatter.setToString", () => {
	const Empty = Schema.Struct({});

	it.effect("pins the empty-object block per codec on an empty document", () =>
		Effect.gen(function* () {
			const document = yield* parseDoc("");
			assert.strictEqual(
				yield* MarkdownFrontmatter.setToString(Empty, YamlFrontmatter)(document, {}),
				"---\n{}\n---\n",
			);
			assert.strictEqual(yield* MarkdownFrontmatter.setToString(Empty, TomlFrontmatter)(document, {}), "+++\n+++\n");
			assert.strictEqual(
				yield* MarkdownFrontmatter.setToString(Empty, JsonFrontmatter)(document, {}),
				"---json\n{}\n---\n",
			);
		}),
	);

	it.effect("the empty-object block re-parses and decodes back to the empty object in every codec", () =>
		Effect.gen(function* () {
			const document = yield* parseDoc("");
			for (const codec of [YamlFrontmatter, TomlFrontmatter, JsonFrontmatter]) {
				const updated = yield* MarkdownFrontmatter.setToString(Empty, codec)(document, {});
				const reparsed = yield* parseDoc(updated);
				const data = yield* MarkdownFrontmatter.schema(Empty, codec)(reparsed);
				assert.deepStrictEqual(data, {});
			}
		}),
	);

	it.effect("writes the json block with its language-hint fence", () =>
		Effect.gen(function* () {
			const document = yield* parseDoc("body\n");
			const updated = yield* MarkdownFrontmatter.setToString(Meta, JsonFrontmatter)(document, {
				title: "Hi",
				count: 1,
			});
			assert.strictEqual(updated, '---json\n{\n  "title": "Hi",\n  "count": 1\n}\n---\n\nbody\n');
		}),
	);
});
