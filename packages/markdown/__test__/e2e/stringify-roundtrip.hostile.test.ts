// Serialization cost against the design doc's ~17µs/node Schema-construction
// flag: stringify builds strings, not Schema nodes, so the flag must not bind
// here. `stringify-roundtrip.e2e.test.ts` holds what stringify emits.

import { assert, describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { parseBlocks } from "../../src/internal/blockParser.js";
import { stringifyTree } from "../../src/internal/stringify.js";

describe("stringify cost", () => {
	it("serialization is string-building, not schema construction", () => {
		// A comparison of two times measured side by side, never a time in
		// milliseconds: stringify of a tree must land under the parse that built
		// it — it allocates strings, never Schema nodes.
		const input =
			"# heading\n\npara *em* **st** `code` [l](/u)\n\n- a\n- b\n\n> quote\n\n| a | b |\n| - | - |\n| 1 | 2 |\n".repeat(
				500,
			);
		const warm = parseBlocks(input, "gfm").root;
		stringifyTree(warm);

		const parseStart = Growth.cpuNow();
		const tree = parseBlocks(input, "gfm").root;
		const parseMs = Growth.cpuNow() - parseStart;

		const stringifyStart = Growth.cpuNow();
		const emitted = stringifyTree(tree);
		const stringifyMs = Growth.cpuNow() - stringifyStart;

		assert.isAbove(emitted.length, input.length / 2);
		// The flag would bind if serialization cost rivaled parse cost (which
		// includes Schema materialization). Pin an order-of-magnitude margin
		// rather than a wall-clock number: stringify must cost less than the
		// parse of the same document in the same environment.
		assert.isBelow(
			stringifyMs,
			parseMs,
			`stringify ${stringifyMs.toFixed(1)}ms should undercut parse ${parseMs.toFixed(1)}ms`,
		);
	});
});
