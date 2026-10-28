// Two installed copies of `@effected/source` must interoperate: the public
// signatures that take or return a line index are typed with the structural
// `SourceIndex` interface, never the `LineIndex` class, whose `private`
// members make it nominal.

import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import type { SourceIndex } from "../src/index.js";
import { MarkdownDiagnostic, MarkdownDocument } from "../src/index.js";
import { SecondCopyLineIndex } from "./second-copy-index.js";

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("@effected/source interop", () => {
	it("MarkdownDiagnostic.fromRaw accepts a second copy's index", () => {
		const copy = SecondCopyLineIndex.make("# a\nb\n");
		const d = MarkdownDiagnostic.fromRaw(copy, { code: "NestingDepthExceeded", message: "m", offset: 4, length: 1 });
		assert.deepStrictEqual([d.line, d.character], [1, 0]);
	});

	it("MarkdownDocument.lineIndex is declared as the interface, not the class", () => {
		const parsed = MarkdownDocument.parseResult("# a\nb\n");
		assert.isTrue(Result.isSuccess(parsed));
		if (Result.isSuccess(parsed)) {
			// A `LineIndex` return type fails this: the class is not assignable
			// from the interface, so a consumer typing against its own copy's
			// `SourceIndex` would get a narrower promise than the getter makes.
			const declared: Exact<typeof parsed.success.lineIndex, SourceIndex> = true;
			assert.isTrue(declared);
			assert.deepStrictEqual(parsed.success.lineIndex.positionAt(4), { line: 1, character: 0 });
		}
	});
});
