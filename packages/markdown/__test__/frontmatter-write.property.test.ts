// Round-trip properties for the typed frontmatter write seam
// (`MarkdownFrontmatter.setToString`): set, re-parse and decode recovers the
// data, and the content after the block survives byte-identical. The unit
// coverage is in `frontmatter-write.test.ts`.
//
// Property strings are newline-free for the same reason the decode-side
// round-trip constrains them: a multi-line string could legally place a bare
// fence-closer at column zero inside the block, which the capture scanner
// rightly treats as the closing fence — fence semantics, not a codec defect.

import { assert, describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Effect, Schema } from "effect";
import { MarkdownFrontmatter } from "../src/Frontmatter.js";
import { JsonFrontmatter } from "../src/JsonFrontmatter.js";
import { MarkdownParseOptions } from "../src/Markdown.js";
import { MarkdownDocument } from "../src/MarkdownDocument.js";
import { TomlFrontmatter } from "../src/TomlFrontmatter.js";
import { YamlFrontmatter } from "../src/YamlFrontmatter.js";

const withFrontmatter = MarkdownParseOptions.make({ frontmatter: true });
const parseDoc = (source: string) => MarkdownDocument.parse(source, withFrontmatter);

const Meta = Schema.Struct({
	title: Schema.String,
	count: Schema.Number,
});

describe("frontmatter write round-trip property", () => {
	// Newline-free strings only — see the file header for why. The count stays
	// in the 32-bit range every frontmatter codec represents exactly.
	const Scalar = Schema.String.check(Schema.makeFilter((s) => !s.includes("\n") && !s.includes("\r")));
	const MetaArb = Schema.Struct({
		title: Scalar,
		count: Schema.Int.check(Schema.isBetween({ minimum: -(2 ** 31), maximum: 2 ** 31 - 1 })),
	});
	const bodyDoc = "# Title\n\nsome *emphasis* text\n";

	const insertRoundTrip = (codec: typeof YamlFrontmatter, data: { readonly title: string; readonly count: number }) =>
		Effect.gen(function* () {
			const document = yield* parseDoc(bodyDoc);
			const updated = yield* MarkdownFrontmatter.setToString(Meta, codec)(document, data);
			// The pre-existing content survives byte-identical.
			assert.isTrue(updated.endsWith(`\n\n${bodyDoc}`));
			const reparsed = yield* parseDoc(updated);
			return yield* MarkdownFrontmatter.schema(Meta, codec)(reparsed);
		});

	it.effect.prop(
		"yaml: set then re-parse then decode recovers the data",
		[MetaArb],
		([data]) =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* insertRoundTrip(YamlFrontmatter, data), data);
			}),
		{ arbitrary: { runs: Depth.pick({ sample: 60, full: 600 }) } },
	);

	it.effect.prop(
		"toml: set then re-parse then decode recovers the data",
		[MetaArb],
		([data]) =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* insertRoundTrip(TomlFrontmatter, data), data);
			}),
		{ arbitrary: { runs: Depth.pick({ sample: 60, full: 600 }) } },
	);

	it.effect.prop(
		"json: set then re-parse then decode recovers the data",
		[MetaArb],
		([data]) =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* insertRoundTrip(JsonFrontmatter, data), data);
			}),
		{ arbitrary: { runs: Depth.pick({ sample: 60, full: 600 }) } },
	);

	const fenced = `---\ntitle: Old\ncount: 0\n---\n\n${bodyDoc}`;
	it.effect.prop(
		"yaml: replacing an existing block preserves the suffix byte-for-byte and recovers the data",
		[MetaArb],
		([data]) =>
			Effect.gen(function* () {
				const document = yield* parseDoc(fenced);
				const updated = yield* MarkdownFrontmatter.setToString(Meta, YamlFrontmatter)(document, data);
				assert.isTrue(updated.endsWith(`\n\n${bodyDoc}`));
				const reparsed = yield* parseDoc(updated);
				const result = yield* MarkdownFrontmatter.schema(Meta, YamlFrontmatter)(reparsed);
				assert.deepStrictEqual(result, data);
			}),
		{ arbitrary: { runs: Depth.pick({ sample: 60, full: 600 }) } },
	);
});
