// Unit and property coverage for the frontmatter schema composition seam
// (P3 Task 3): `MarkdownFrontmatter.schema` and the `MarkdownDocument`
// frontmatter accessor.
//
// Naming note: the design doc's indicative spelling was `Frontmatter.schema`,
// but `Frontmatter` names the mdast-shaped capture node class (the Task 1
// co-location ruling), so the seam facade follows the package's
// Markdown-prefix convention instead — `MarkdownFrontmatter.schema`.
//
// The round-trip property generates data, stringifies it through each format
// package's public stringify surface (`Yaml.stringify`, `Toml.stringify`,
// `Jsonc.stringify`), wraps it in fences, parses with capture on and decodes
// back through the seam. Generated
// strings are constrained newline-free: a multi-line string could legally
// place a bare fence-closer at column zero inside the block (toml multi-line
// basic strings do exactly that), which the capture scanner would rightly
// treat as the closing fence — that is fence semantics, not a codec defect,
// so the property excludes it.

import { assert, describe, it } from "@effect/vitest";
import { Jsonc } from "@effected/jsonc";
import { Toml } from "@effected/toml";
import { Yaml } from "@effected/yaml";
import { Effect, Schema } from "effect";
import { FastCheck as fc } from "effect/testing";
import { FrontmatterMissingError, FrontmatterValidationError, MarkdownFrontmatter } from "../src/Frontmatter.js";
import { JsonFrontmatter } from "../src/JsonFrontmatter.js";
import { MarkdownParseOptions } from "../src/Markdown.js";
import { MarkdownDocument } from "../src/MarkdownDocument.js";
import { TomlFrontmatter } from "../src/TomlFrontmatter.js";
import { YamlFrontmatter } from "../src/YamlFrontmatter.js";

const withFrontmatter = MarkdownParseOptions.make({ frontmatter: true });

const Meta = Schema.Struct({
	title: Schema.String,
	count: Schema.Number,
});

const parseDoc = (source: string) => MarkdownDocument.parse(source, withFrontmatter);

describe("MarkdownFrontmatter.schema", () => {
	it.effect("decodes yaml frontmatter to typed data end to end", () =>
		Effect.gen(function* () {
			const document = yield* parseDoc("---\ntitle: Hello\ncount: 2\n---\n\n# Body\n");
			const data = yield* MarkdownFrontmatter.schema(Meta, YamlFrontmatter)(document);
			assert.deepStrictEqual(data, { title: "Hello", count: 2 });
		}),
	);

	it.effect("decodes toml frontmatter to typed data end to end", () =>
		Effect.gen(function* () {
			const document = yield* parseDoc('+++\ntitle = "Hello"\ncount = 2\n+++\n\n# Body\n');
			const data = yield* MarkdownFrontmatter.schema(Meta, TomlFrontmatter)(document);
			assert.deepStrictEqual(data, { title: "Hello", count: 2 });
		}),
	);

	it.effect("decodes json frontmatter to typed data end to end", () =>
		Effect.gen(function* () {
			const document = yield* parseDoc('---json\n{ "title": "Hello", "count": 2 }\n---\n\n# Body\n');
			const data = yield* MarkdownFrontmatter.schema(Meta, JsonFrontmatter)(document);
			assert.deepStrictEqual(data, { title: "Hello", count: 2 });
		}),
	);

	it.effect("fails typed with FrontmatterMissingError when the document has no frontmatter", () =>
		Effect.gen(function* () {
			const document = yield* parseDoc("# Just a heading\n");
			const error = yield* Effect.flip(MarkdownFrontmatter.schema(Meta, YamlFrontmatter)(document));
			assert.strictEqual(error._tag, "FrontmatterMissingError");
			assert.instanceOf(error, FrontmatterMissingError);
		}),
	);

	it.effect("a fenced document parsed with capture off also reports missing", () =>
		Effect.gen(function* () {
			const document = yield* MarkdownDocument.parse("---\ntitle: Hello\n---\n");
			const error = yield* Effect.flip(MarkdownFrontmatter.schema(Meta, YamlFrontmatter)(document));
			assert.strictEqual(error._tag, "FrontmatterMissingError");
		}),
	);

	it.effect("propagates the codec's format mismatch error", () =>
		Effect.gen(function* () {
			const document = yield* parseDoc('+++\ntitle = "Hello"\ncount = 2\n+++\n');
			const error = yield* Effect.flip(MarkdownFrontmatter.schema(Meta, YamlFrontmatter)(document));
			assert.strictEqual(error._tag, "FrontmatterFormatMismatchError");
		}),
	);

	it.effect("propagates the codec's decode error for unparseable content", () =>
		Effect.gen(function* () {
			const document = yield* parseDoc("---\n: [\n---\n");
			const error = yield* Effect.flip(MarkdownFrontmatter.schema(Meta, YamlFrontmatter)(document));
			assert.strictEqual(error._tag, "FrontmatterDecodeError");
		}),
	);

	it.effect("fails typed with FrontmatterValidationError carrying the structured issue", () =>
		Effect.gen(function* () {
			const document = yield* parseDoc("---\ntitle: 42\ncount: 2\n---\n");
			const error = yield* Effect.flip(MarkdownFrontmatter.schema(Meta, YamlFrontmatter)(document));
			assert.strictEqual(error._tag, "FrontmatterValidationError");
			assert.instanceOf(error, FrontmatterValidationError);
			// The issue is the structured v4 issue tree, never a string.
			assert.isObject(error.issue);
			assert.isString((error.issue as { readonly _tag: string })._tag);
		}),
	);
});

describe("MarkdownDocument.frontmatter", () => {
	it.effect("returns the captured node when frontmatter was parsed", () =>
		Effect.gen(function* () {
			const document = yield* parseDoc("---\ntitle: Hello\n---\n\nbody\n");
			const node = document.frontmatter;
			assert.isDefined(node);
			assert.strictEqual(node?.type, "frontmatter");
			assert.strictEqual(node?.format, "yaml");
			// Task 1 pinned capture semantics: the value carries the raw text
			// between the fences without the final line terminator.
			assert.strictEqual(node?.value, "title: Hello");
			assert.strictEqual(node, document.root.children[0]);
		}),
	);

	it.effect("is undefined when the document has no frontmatter", () =>
		Effect.gen(function* () {
			const document = yield* parseDoc("# Heading\n");
			assert.isUndefined(document.frontmatter);
		}),
	);

	it.effect("is undefined for a fenced document parsed with capture off", () =>
		Effect.gen(function* () {
			const document = yield* MarkdownDocument.parse("---\ntitle: Hello\n---\n");
			assert.isUndefined(document.frontmatter);
		}),
	);
});

describe("frontmatter round-trip property", () => {
	// Newline-free strings only — see the file header for why.
	const scalar = fc.string().filter((s) => !s.includes("\n") && !s.includes("\r"));
	const metaArb = fc.record({ title: scalar, count: fc.integer() });

	/** Fence a stringified block, normalizing a missing trailing newline. */
	const fenced = (open: string, block: string, close: string): string =>
		`${open}\n${block}${block.endsWith("\n") ? "" : "\n"}${close}\n\nbody\n`;

	const decodeVia = (
		source: string,
		codec: typeof YamlFrontmatter,
	): { readonly title: string; readonly count: number } =>
		Effect.runSync(Effect.flatMap(parseDoc(source), (document) => MarkdownFrontmatter.schema(Meta, codec)(document)));

	it("yaml: stringify, parse and decode recovers the data", () => {
		fc.assert(
			fc.property(metaArb, (data) => {
				const block = Effect.runSync(Yaml.stringify(data));
				assert.deepStrictEqual(decodeVia(fenced("---", block, "---"), YamlFrontmatter), data);
			}),
			{ numRuns: 60 },
		);
	});

	it("toml: stringify, parse and decode recovers the data", () => {
		fc.assert(
			fc.property(metaArb, (data) => {
				const block = Effect.runSync(Toml.stringify(data));
				assert.deepStrictEqual(decodeVia(fenced("+++", block, "+++"), TomlFrontmatter), data);
			}),
			{ numRuns: 60 },
		);
	});

	it("json: stringify, parse and decode recovers the data", () => {
		fc.assert(
			fc.property(metaArb, (data) => {
				const block = Effect.runSync(Jsonc.stringify(data));
				assert.deepStrictEqual(decodeVia(fenced("---json", block, "---"), JsonFrontmatter), data);
			}),
			{ numRuns: 60 },
		);
	});
});
