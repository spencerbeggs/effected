// MD038 `no-space-in-code`, held to markdownlint's own MD038 over the upstream
// fixture corpus (LF and CRLF) and over a grid of code spans (see
// `codeSpanGrid`). The rule reads a code span the way micromark tokenizes it,
// from its source. The rule has no settings.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD038 } from "../../src/rules/MD038.js";
import { codeSpanGrid } from "../helpers/code-span-grid.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";

const run = runRule(MD038);

describe("MD038 no-space-in-code", () => {
	it(
		"agrees with markdownlint over the corpus and the code-span grid",
		() => {
			const result = differential(MD038, { extra: codeSpanGrid });
			// Not divergences of the port: where a line ending is a code span's padding, markdownlint's range for the
			// spaces beside it runs past the line's end, and it throws on its own `range`. The kit reports there too.
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				["break and spaces both sides", "space-break-space", "quoted breaks both sides", "listed breaks both sides"],
			);
			for (const divergence of result.divergences) {
				assert.match(
					divergence.reason,
					/^markdownlint throws: Value of 'range' passed to onError by 'MD038' is incorrect for 'input'\.; kit: \d+ findings$/,
				);
			}
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports the extra spaces at a code span's start, with a fix that deletes them", () => {
		const source = "a `  x` b\n";
		const findings = run(source);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 1);
		assert.deepStrictEqual(finding?.context, Option.some("`  x`"));
		assert.deepStrictEqual(finding?.range, Option.some([4, 2] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"a `x` b\n",
		);
	});
});

// markdownlint's MD038 findings over the corpus (LF and CRLF) and the grid.
const ORACLE_FINDINGS_DEFAULT = 814;
