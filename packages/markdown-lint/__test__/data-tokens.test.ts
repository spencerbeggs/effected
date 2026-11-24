// The shared `data`-token splitter (`textTokens`, src/internal/inline.ts), held token for token to markdownlint's
// own `data` tokens (line, column, text) over a grid of the places micromark cuts them (see `dataTokenGrid`). MD036
// and MD044 read inline text through it.

import { assert, describe, it } from "@effect/vitest";
import { textTokens } from "../src/internal/inline.js";
import { LintRule } from "../src/LintRule.js";
import { MarkdownLint } from "../src/MarkdownLint.js";
import { dataTokenGrid } from "./helpers/data-token-grid.js";
import { DIFFERENTIAL_TIMEOUT } from "./helpers/differential.js";
import { oracleDataTokens } from "./helpers/markdownlint-oracle.js";

// The kit's `data` tokens for `source`, as `[line, column, text]`, read through a rule that records them.
const kitDataTokens = (source: string): ReadonlyArray<string> => {
	const found: Array<string> = [];
	const probe = LintRule.make({
		names: ["X901", "data-tokens"],
		description: "Records the data tokens",
		tags: ["test"],
		check: (context) => {
			for (const token of textTokens(context, { code: false, html: false })) {
				const line = context.mapping.lineNumber(token.start);
				const column = token.start - context.mapping.lineStart(line) + 1;
				found.push(JSON.stringify([line, column, context.source.slice(token.start, token.end)]));
			}
		},
	});
	MarkdownLint.lint(source, [probe]);
	return found.sort();
};

describe("data tokens", () => {
	it(
		"match markdownlint's over the data-token grid",
		() => {
			const differ = dataTokenGrid.filter(
				(input) =>
					JSON.stringify(kitDataTokens(input.source)) !==
					JSON.stringify(
						oracleDataTokens(input.source)
							.map((token) => JSON.stringify(token))
							.sort(),
					),
			);
			assert.deepStrictEqual(
				differ.map((input) => input.name),
				[],
			);
			assert.strictEqual(dataTokenGrid.length, GRID_INPUTS);
		},
		DIFFERENTIAL_TIMEOUT,
	);
});

const GRID_INPUTS = 1066;
