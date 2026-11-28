// The round-trip property for the frontmatter schema composition seam
// (`MarkdownFrontmatter.schema`). The unit coverage is in
// `frontmatter-schema.test.ts`.
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
import { Depth } from "@effected/testing";
import { Toml } from "@effected/toml";
import { Yaml } from "@effected/yaml";
import { Effect, Schema } from "effect";
import { MarkdownFrontmatter } from "../src/Frontmatter.js";
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

describe("frontmatter round-trip property", () => {
	// Newline-free strings only — see the file header for why. The count stays
	// in the 32-bit range every frontmatter codec represents exactly.
	const Scalar = Schema.String.check(Schema.makeFilter((s) => !s.includes("\n") && !s.includes("\r")));
	const MetaArb = Schema.Struct({
		title: Scalar,
		count: Schema.Int.check(Schema.isBetween({ minimum: -(2 ** 31), maximum: 2 ** 31 - 1 })),
	});

	/** Fence a stringified block, normalizing a missing trailing newline. */
	const fenced = (open: string, block: string, close: string): string =>
		`${open}\n${block}${block.endsWith("\n") ? "" : "\n"}${close}\n\nbody\n`;

	const decodeVia = (source: string, codec: typeof YamlFrontmatter) =>
		Effect.flatMap(parseDoc(source), (document) => MarkdownFrontmatter.schema(Meta, codec)(document));

	it.effect.prop(
		"yaml: stringify, parse and decode recovers the data",
		[MetaArb],
		([data]) =>
			Effect.gen(function* () {
				const block = yield* Yaml.stringify(data);
				assert.deepStrictEqual(yield* decodeVia(fenced("---", block, "---"), YamlFrontmatter), data);
			}),
		{ arbitrary: { runs: Depth.pick({ sample: 60, full: 600 }) } },
	);

	it.effect.prop(
		"toml: stringify, parse and decode recovers the data",
		[MetaArb],
		([data]) =>
			Effect.gen(function* () {
				const block = yield* Toml.stringify(data);
				assert.deepStrictEqual(yield* decodeVia(fenced("+++", block, "+++"), TomlFrontmatter), data);
			}),
		{ arbitrary: { runs: Depth.pick({ sample: 60, full: 600 }) } },
	);

	it.effect.prop(
		"json: stringify, parse and decode recovers the data",
		[MetaArb],
		([data]) =>
			Effect.gen(function* () {
				const block = yield* Jsonc.stringify(data);
				assert.deepStrictEqual(yield* decodeVia(fenced("---json", block, "---"), JsonFrontmatter), data);
			}),
		{ arbitrary: { runs: Depth.pick({ sample: 60, full: 600 }) } },
	);
});
