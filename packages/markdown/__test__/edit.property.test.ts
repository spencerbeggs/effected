// applyAll's splice semantics on generated disjoint edits: a batch equals the
// same edits applied one at a time from the highest offset down. The fixed
// cases and the overlap posture are in `edit.test.ts`.

import { describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Arbitrary, Schema } from "effect";
import { MarkdownEdit } from "../src/MarkdownEdit.js";

describe("MarkdownEdit — property", () => {
	const Nat = (max: number) => Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: max }));
	const disjointEdits = Arbitrary.schema(
		Schema.Tuple([
			Schema.String.check(Schema.isBetweenLength(8, 64)),
			Schema.Array(Schema.Tuple([Nat(7), Nat(3), Schema.String.check(Schema.isMaxLength(5))])).check(
				Schema.isMaxLength(4),
			),
		]),
	).pipe(
		Arbitrary.map(([text, raw]) => {
			// Lay raw (gap, length, content) triples out left to right so the
			// resulting edits are always disjoint and in-bounds. The cursor
			// always advances at least one unit past each edit's offset, so a
			// zero-length insertion can never share an offset with the next
			// edit's start (which the overlap guard rightly rejects).
			const edits: Array<MarkdownEdit> = [];
			let cursor = 0;
			for (const [gap, length, content] of raw) {
				const offset = cursor + gap;
				if (offset + length > text.length) {
					break;
				}
				edits.push(MarkdownEdit.make({ offset, length, content }));
				cursor = offset + Math.max(length, 1);
			}
			return { text, edits };
		}),
	);

	// `size` lifts the length scale to the 64-character text cap; the default
	// scale of 10 would pin every text near its 8-character floor.
	it.prop(
		"batch application equals sequential reverse-offset application on disjoint edits",
		[disjointEdits],
		([{ text, edits }]) => {
			const batch = MarkdownEdit.applyAll(text, edits);
			let sequential = text;
			for (const e of [...edits].sort((a, b) => b.offset - a.offset)) {
				sequential = MarkdownEdit.applyAll(sequential, [e]);
			}
			return batch === sequential;
		},
		{ arbitrary: { runs: Depth.pick({ sample: 200, full: 2_000 }), size: 64 } },
	);
});
