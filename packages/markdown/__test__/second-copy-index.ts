// A `LineIndex` stand-in from a second installed copy of `@effected/source`,
// for the type-level interop tests. Same public surface, its own `private`
// members, so it is NOT assignable to this copy's `LineIndex` class.

import type { LineBreaks, SourceLocation, SourcePosition, SourceRange, SourceSpan } from "../src/index.js";
import { LineIndex } from "../src/index.js";

/**
 * A stand-in for `LineIndex` loaded from a second installed copy: the same
 * public surface and its own `private` members, which is exactly what makes
 * the two classes incompatible.
 */
export class SecondCopyLineIndex {
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
