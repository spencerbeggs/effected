// Oracle-differential semantic expectations for block-structure boundaries.
//
// WHY THIS FILE EXISTS: kit-round-trip tests (parse → format → parse with our
// own engine) are structurally blind to parse bugs the formatter is faithful
// to — when the parser mis-nests a document, the formatter faithfully re-emits
// the mis-nesting and the round-trip matches. The shipped P0 (a trailing
// comment on the LAST key of a nested block mapping swallowed the following
// dedent, silently absorbing the next sibling key) survived every fixed-point
// fixture for exactly that reason. These expectations were authored against an
// INDEPENDENT reference parser, so a shared-defect round-trip cannot go green.
//
// Provenance (ORACLE.md convention, parity with fixtures/explicit-key):
// - Oracle: `yaml@2.9.0` (`YAML.parse` defaults; `parseAllDocuments` for the
//   multi-document case)
// - Authored: 2026-08-12, offline, in a scratch script outside the test run
// - The oracle is NOT a dependency of this suite — the committed expected
//   literals are the contract. Never regenerate them with our own parser.
//
// Coverage: a trailing comment in every structural position where a block
// boundary follows — last key of a nested map before dedent-to-key, before
// dedent-to-scalar, before EOF (with and without a final newline), before
// `---`, before `...`, last item of a nested sequence before dedent, last key
// before a deeper sibling, inside flow before `}` / `]`, around a
// block-scalar body before dedent — plus the control rows that isolated the
// P0 and hardening variants (CRLF, 4-space indent, quoted values, comment
// text containing `:` / `#` / tab, blank line before the dedent).

import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Yaml } from "../src/index.js";

interface OracleCase {
	readonly name: string;
	readonly input: string;
	/** Expected parsed value, authored from `yaml@2.9.0` — see file header. */
	readonly expected: unknown;
}

const controlCases: ReadonlyArray<OracleCase> = [
	{
		name: "no comment (control)",
		input: "outer:\n  a: 1\n  b: 2\nsibling:\n  c: 3\n",
		expected: { outer: { a: 1, b: 2 }, sibling: { c: 3 } },
	},
	{
		name: "trailing comment on a NON-last key (control)",
		input: "outer:\n  a: 1 # note\n  b: 2\nsibling:\n  c: 3\n",
		expected: { outer: { a: 1, b: 2 }, sibling: { c: 3 } },
	},
	{
		name: "comment on its own line (control)",
		input: "outer:\n  a: 1\n  b: 2\n  # note\nsibling:\n  c: 3\n",
		expected: { outer: { a: 1, b: 2 }, sibling: { c: 3 } },
	},
];

const dedentCases: ReadonlyArray<OracleCase> = [
	{
		name: "last key of a nested map, dedent to a mapping sibling (the P0 repro)",
		input: "outer:\n  a: 1\n  b: 2 # note\nsibling:\n  c: 3\n",
		expected: { outer: { a: 1, b: 2 }, sibling: { c: 3 } },
	},
	{
		name: "last key of a nested map, dedent to a scalar sibling",
		input: "outer:\n  a: 1\n  b: 2 # note\nsibling: 3\n",
		expected: { outer: { a: 1, b: 2 }, sibling: 3 },
	},
	{
		name: "three levels deep, dedent one level then to top",
		input: "l1:\n  l2:\n    a: 1\n    b: 2 # note\n  s2: 9\ntop: 0\n",
		expected: { l1: { l2: { a: 1, b: 2 }, s2: 9 }, top: 0 },
	},
	{
		name: "two levels of dedent in one step",
		input: "a:\n  b:\n    c: 1 # note\nd: 2\n",
		expected: { a: { b: { c: 1 } }, d: 2 },
	},
	{
		name: "three levels of dedent in one step",
		input: "a:\n  b:\n    c:\n      d: 1 # note\ne: 2\n",
		expected: { a: { b: { c: { d: 1 } } }, e: 2 },
	},
	{
		name: "last key before a DEEPER sibling",
		input: "a:\n  b: 1 # note\n  c:\n    d: 2\ne: 3\n",
		expected: { a: { b: 1, c: { d: 2 } }, e: 3 },
	},
	{
		name: "last item of a nested sequence before dedent",
		input: "outer:\n  items:\n    - a\n    - b # note\nsibling: 1\n",
		expected: { outer: { items: ["a", "b"] }, sibling: 1 },
	},
];

const streamBoundaryCases: ReadonlyArray<OracleCase> = [
	{
		name: "trailing comment before EOF",
		input: "outer:\n  b: 2 # note\n",
		expected: { outer: { b: 2 } },
	},
	{
		name: "trailing comment before EOF without a final newline",
		input: "outer:\n  b: 2 # note",
		expected: { outer: { b: 2 } },
	},
	{
		name: "trailing comment before a document-end marker (...)",
		input: "outer:\n  b: 2 # note\n...\n",
		expected: { outer: { b: 2 } },
	},
];

const hardeningCases: ReadonlyArray<OracleCase> = [
	{
		name: "double-quoted value with trailing comment before dedent",
		input: 'outer:\n  b: "2" # note\nsibling: 3\n',
		expected: { outer: { b: "2" }, sibling: 3 },
	},
	{
		name: "single-quoted value with trailing comment before dedent",
		input: "outer:\n  b: '2' # note\nsibling: 3\n",
		expected: { outer: { b: "2" }, sibling: 3 },
	},
	{
		name: "comment text containing a colon",
		input: "outer:\n  b: 2 # a: b\nsibling: 3\n",
		expected: { outer: { b: 2 }, sibling: 3 },
	},
	{
		name: "comment text containing a second #",
		input: "outer:\n  b: 2 # a # b\nsibling: 3\n",
		expected: { outer: { b: 2 }, sibling: 3 },
	},
	{
		name: "bare # comment",
		input: "outer:\n  b: 2 #\nsibling: 3\n",
		expected: { outer: { b: 2 }, sibling: 3 },
	},
	{
		name: "comment then a blank line then dedent",
		input: "outer:\n  b: 2 # note\n\nsibling: 3\n",
		expected: { outer: { b: 2 }, sibling: 3 },
	},
	{
		name: "4-space indentation",
		input: "outer:\n    a: 1\n    b: 2 # note\nsibling: 3\n",
		expected: { outer: { a: 1, b: 2 }, sibling: 3 },
	},
	{
		name: "CRLF line endings",
		input: "outer:\r\n  b: 2 # note\r\nsibling: 3\r\n",
		expected: { outer: { b: 2 }, sibling: 3 },
	},
	{
		name: "tab inside the comment text",
		input: "outer:\n  b: 2 # \tnote\nsibling: 3\n",
		expected: { outer: { b: 2 }, sibling: 3 },
	},
];

const flowAndBlockScalarCases: ReadonlyArray<OracleCase> = [
	{
		name: "trailing comment after an inline flow map, sibling follows",
		input: "m: { a: 1 } # note\nsibling: 2\n",
		expected: { m: { a: 1 }, sibling: 2 },
	},
	{
		name: "trailing comment after an inline flow seq, sibling follows",
		input: "s: [1, 2] # note\nsibling: 2\n",
		expected: { s: [1, 2], sibling: 2 },
	},
	// The closing bracket sits INDENTED (YAML 1.2 §7.4 requires flow content
	// in a block value to be indented past the block level). A `}`/`]` at
	// column 0 in this position is a KNOWN pre-existing strictness divergence:
	// our engine rejects it with a typed InvalidIndentation while yaml@2.9.0
	// accepts it leniently. That divergence is comment-independent (the
	// no-comment control fails identically) and is tracked outside this file.
	{
		name: "comment inside a multi-line flow map before }",
		input: "m: {\n  a: 1 # note\n  }\nsibling: 2\n",
		expected: { m: { a: 1 }, sibling: 2 },
	},
	{
		name: "comment inside a multi-line flow seq before ]",
		input: "s: [\n  1 # note\n  ]\nsibling: 2\n",
		expected: { s: [1], sibling: 2 },
	},
	{
		name: "block-scalar body before dedent (no comment — boundary control)",
		input: "outer:\n  text: |\n    line1\n    line2\nsibling: 3\n",
		expected: { outer: { text: "line1\nline2\n" }, sibling: 3 },
	},
	{
		name: "block-scalar header comment, body, then dedent",
		input: "outer:\n  text: | # note\n    line1\nsibling: 3\n",
		expected: { outer: { text: "line1\n" }, sibling: 3 },
	},
	{
		name: "# inside a block-scalar body is content, not a comment",
		input: "outer:\n  text: |\n    body # not a comment\nsibling: 3\n",
		expected: { outer: { text: "body # not a comment\n" }, sibling: 3 },
	},
];

const realWorldCases: ReadonlyArray<OracleCase> = [
	{
		// The claude.yml workflow excerpt from the downstream P0 report:
		// a trailing comment on the last key of a 5-entry nested map, then a
		// dedent to a sibling key. The corrupted parse put `steps` INSIDE
		// `permissions` and shredded its value; GitHub Actions, yaml@2.9.0 and
		// js-yaml all agree on this structure.
		name: "workflow permissions/steps excerpt",
		input:
			"permissions:\n" +
			"  contents: read\n" +
			"  pull-requests: read\n" +
			"  issues: read\n" +
			"  id-token: write\n" +
			"  actions: read # Required for Claude to read CI results on PRs\n" +
			"steps:\n" +
			"  - name: Checkout repository\n",
		expected: {
			permissions: {
				contents: "read",
				"pull-requests": "read",
				issues: "read",
				"id-token": "write",
				actions: "read",
			},
			steps: [{ name: "Checkout repository" }],
		},
	},
];

const groups: ReadonlyArray<readonly [string, ReadonlyArray<OracleCase>]> = [
	["controls", controlCases],
	["dedent after a trailing comment", dedentCases],
	["stream boundaries", streamBoundaryCases],
	["hardening variants", hardeningCases],
	["flow and block-scalar boundaries", flowAndBlockScalarCases],
	["real-world shapes", realWorldCases],
];

describe("oracle-differential (yaml@2.9.0 semantic expectations)", () => {
	for (const [groupName, cases] of groups) {
		describe(groupName, () => {
			for (const { name, input, expected } of cases) {
				it.effect(name, () =>
					Effect.gen(function* () {
						const value = yield* Yaml.parse(input);
						assert.deepStrictEqual(value, expected);
					}),
				);
			}
		});
	}

	describe("multi-document boundaries", () => {
		it.effect("trailing comment before a document-start marker (---)", () =>
			Effect.gen(function* () {
				const docs = yield* Yaml.parseAll("outer:\n  b: 2 # note\n---\nnext: 1\n");
				assert.deepStrictEqual(docs, [{ outer: { b: 2 } }, { next: 1 }]);
			}),
		);
	});
});
