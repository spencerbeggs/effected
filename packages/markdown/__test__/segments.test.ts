// `sourceOffsetAt` binary-searches the segments; it must answer exactly what a scan from the first segment answers,
// for every index, over segment runs with gaps, adjacent and empty segments.

import { assert, describe, it } from "@effect/vitest";
import type { RawInlineSegment } from "../src/internal/blockTypes.js";
import { sourceOffsetAt } from "../src/internal/segments.js";

// The scan the binary search replaced.
const scanned = (segments: ReadonlyArray<RawInlineSegment>, textIndex: number, fallback: number): number => {
	let offset = fallback;
	for (const segment of segments) {
		if (textIndex < segment.textOffset) return offset;
		if (textIndex < segment.textOffset + segment.length) return segment.sourceOffset + (textIndex - segment.textOffset);
		offset = segment.sourceOffset + segment.length;
	}
	return offset;
};

// A deterministic pseudo-random run of segments: increasing text offsets, gaps of 0-2 injected characters, lengths
// of 0-4, source offsets advancing by the length plus a stripped prefix of 0-3.
const runOf = (seed: number, count: number): ReadonlyArray<RawInlineSegment> => {
	let state = seed;
	const next = (bound: number) => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return state % bound;
	};
	const segments: Array<RawInlineSegment> = [];
	let textOffset = next(3);
	let sourceOffset = 10 + next(5);
	for (let index = 0; index < count; index++) {
		const length = next(5);
		segments.push({ textOffset, sourceOffset, length });
		textOffset += length + next(3);
		sourceOffset += length + next(4);
	}
	return segments;
};

describe("sourceOffsetAt", () => {
	it("answers what a scan from the first segment answers", () => {
		let checked = 0;
		for (let seed = 1; seed <= 200; seed++) {
			const segments = runOf(seed, seed % 12);
			const last = segments.at(-1);
			const limit = (last === undefined ? 0 : last.textOffset + last.length) + 3;
			for (let textIndex = 0; textIndex <= limit; textIndex++) {
				assert.strictEqual(sourceOffsetAt(segments, textIndex, 7), scanned(segments, textIndex, 7));
				checked++;
			}
		}
		assert.isAbove(checked, 2000);
	});
});
