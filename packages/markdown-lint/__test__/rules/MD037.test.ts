// MD037 `no-space-in-emphasis`, held to markdownlint's own MD037 over the
// upstream fixture corpus (LF and CRLF) and over a grid of emphasis-marker
// shapes (see `emphasisGrid`). markdownlint pairs the marker runs micromark
// leaves bare, as `data` tokens of their own, in a block's top-level inline
// content; the kit reads the same runs from that content's source. The rule
// has no settings.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD037 } from "../../src/rules/MD037.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";
import { emphasisGrid } from "../helpers/emphasis-grid.js";

const run = runRule(MD037);

describe("MD037 no-space-in-emphasis", () => {
	it(
		"agrees with markdownlint over the corpus and the emphasis grid",
		() => {
			const result = differential(MD037, { extra: emphasisGrid });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports the spaces inside each marker, with fixes that delete them", () => {
		const source = "a ** bold ** c\n";
		const findings = run(source);
		assert.lengthOf(findings, 2);
		assert.deepStrictEqual(findings[0]?.context, Option.some("** b"));
		assert.deepStrictEqual(findings[0]?.range, Option.some([5, 1] as const));
		assert.deepStrictEqual(findings[1]?.context, Option.some("d **"));
		assert.deepStrictEqual(findings[1]?.range, Option.some([10, 1] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"a **bold** c\n",
		);
	});
});

// markdownlint's MD037 findings over the corpus (LF and CRLF) and the grid.
const ORACLE_FINDINGS_DEFAULT = 571;
