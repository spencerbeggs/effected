// Two installed copies of `@effected/source` must interoperate. A class with
// `private` members compares nominally in TypeScript, so a signature typed
// with the `LineIndex` CLASS rejects an index built by another copy of the
// package (TS2345: "Types have separate declarations of a private
// property"). Cross-package signatures take the structural `SourceIndex`
// interface instead, which names only public members.

import { assert, describe, it } from "@effect/vitest";
import type { LineBreaks, SourceIndex, SourceLocation, SourcePosition, SourceRange, SourceSpan } from "../src/index.js";
import { LineIndex } from "../src/index.js";

/**
 * A stand-in for `LineIndex` loaded from a second installed copy: the same
 * public surface and its own `private` members, which is exactly what makes
 * the two classes incompatible.
 */
class SecondCopyLineIndex {
	private constructor(private readonly starts: LineIndex) {}
	static make(text: string): SecondCopyLineIndex {
		return new SecondCopyLineIndex(LineIndex.make(text));
	}
	get text(): string {
		return this.starts.text;
	}
	get lineBreaks(): LineBreaks {
		return this.starts.lineBreaks;
	}
	get lineCount(): number {
		return this.starts.lineCount;
	}
	lineAt(offset: number): number {
		return this.starts.lineAt(offset);
	}
	lineStart(line: number): number {
		return this.starts.lineStart(line);
	}
	lineEnd(line: number): number {
		return this.starts.lineEnd(line);
	}
	lineText(line: number): string {
		return this.starts.lineText(line);
	}
	positionAt(offset: number): SourcePosition {
		return this.starts.positionAt(offset);
	}
	offsetAt(position: SourcePosition): number {
		return this.starts.offsetAt(position);
	}
	spanOf(range: SourceRange): SourceSpan {
		return this.starts.spanOf(range);
	}
	rangeOf(span: SourceSpan): SourceRange {
		return this.starts.rangeOf(span);
	}
	locationOf(range: SourceRange): SourceLocation {
		return this.starts.locationOf(range);
	}
}

const consume = (index: SourceIndex): SourcePosition => index.positionAt(2);

describe("SourceIndex", () => {
	it("is implemented by LineIndex", () => {
		const index: SourceIndex = LineIndex.make("a\nb");
		assert.deepStrictEqual(consume(index), { line: 1, character: 0 });
	});

	it("accepts an index from a second copy of the package, where the class does not", () => {
		const copy = SecondCopyLineIndex.make("a\nb");
		assert.deepStrictEqual(consume(copy), { line: 1, character: 0 });
		// @ts-expect-error a class with private members is nominal: a second copy is not this copy's LineIndex
		const nominal: LineIndex = copy;
		assert.isDefined(nominal);
	});
});
