// `isReference` memoizes micromark's answer per distinct character reference at module scope, so a long-running host
// (an editor, a server linting uploads) would otherwise hold every reference it has ever seen.

import { assert, describe, it } from "@effect/vitest";
import { isReference, referenceMemoLimit, referenceMemoSize } from "../src/internal/inline.js";
import { MarkdownLint } from "../src/MarkdownLint.js";
import { MD037 } from "../src/rules/MD037.js";
import { MD052 } from "../src/rules/MD052.js";

describe("isReference's memo", () => {
	it("stays bounded over more distinct references than it holds", () => {
		const count = referenceMemoLimit * 3;
		for (let index = 0; index < count; index++) isReference(`&#${index};`);
		assert.isAtMost(referenceMemoSize(), referenceMemoLimit);
	});

	it("stays bounded across lints of documents holding many distinct references", () => {
		const references = Array.from({ length: referenceMemoLimit * 2 }, (_, index) => `&#${index + 100_000};`);
		const source = `# T\n\n${references.join(" * a * ")}\n\n[${references.join("")}]\n`;
		MarkdownLint.lint(source, [MD037, MD052]);
		assert.isAtMost(referenceMemoSize(), referenceMemoLimit);
	});

	it("answers the same once its first answers are dropped", () => {
		for (let index = 0; index < referenceMemoLimit * 2; index++) isReference(`&#x${index.toString(16)};`);
		assert.isTrue(isReference("&amp;"));
		assert.isFalse(isReference("&notanentityname;"));
		for (let index = 0; index < referenceMemoLimit * 2; index++) isReference(`&#${index};`);
		assert.isTrue(isReference("&amp;"));
		assert.isFalse(isReference("&notanentityname;"));
	});
});
