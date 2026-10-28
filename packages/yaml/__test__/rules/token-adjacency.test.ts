// Batch-6 token-adjacency rules (#129): comments-spacing, colon-spacing,
// hyphen-spacing — each through the shared fixture harness (which carries
// the mutation proofs).

import { builtin, testRule } from "./harness.js";

testRule(builtin("comments-spacing"), [
	{
		name: "well-spaced comments pass",
		input: "# leading\na: 1 # trailing\n",
		expected: [],
	},
	{
		name: "a missing space after # reports and fixes",
		input: "#tight\na: 1\n",
		expected: [{ line: 0, character: 0, messageIncludes: 'after "#"' }],
		fixed: "# tight\na: 1\n",
	},
	{
		name: "a bare # is fine",
		input: "#\na: 1\n",
		expected: [],
	},
	{
		name: "a shebang at the stream head is exempt",
		input: "#!/usr/bin/env tool\na: 1\n",
		expected: [],
	},
	{
		// A ZERO-space trailing comment cannot exist — YAML 1.2 §6.6 requires
		// whitespace before `#` (a glued `1# c` is a plain scalar), so the
		// default minSpacesBefore of 1 is the grammar floor and the
		// before-check only bites when configured higher.
		name: "minSpacesBefore: 2 wants more breathing room",
		input: "a: 1 # c\n",
		setting: { minSpacesBefore: 2 },
		expected: [{ line: 0, character: 4 }],
		fixed: "a: 1  # c\n",
	},
	{
		name: "own-line comment indentation is not 'space before'",
		input: "a: 1\n  # indented own-line\nb: 2\n",
		expected: [],
	},
	{
		// The lexer emits a comment token for `#b`, but this package's composer
		// folds the line into the plain scalar `"a - #b"` (yaml 2.9 reads a
		// comment there; the divergence is the composer's). The rule follows the
		// composer: inserting a space edited the value.
		name: "a # the composer reads as scalar content is not reported",
		input: "a\n - #b\n",
		expected: [],
	},
]);

testRule(builtin("colon-spacing"), [
	{
		name: "key: value passes",
		input: "a: 1\nb:\n  c: 2\n",
		expected: [],
	},
	{
		name: "space before the colon reports and fixes",
		input: "a : 1\n",
		expected: [{ line: 0, character: 1, messageIncludes: 'before ":"' }],
		fixed: "a: 1\n",
	},
	{
		name: "extra spaces after the colon report and fix to one",
		input: "a:   1\n",
		expected: [{ line: 0, character: 2, messageIncludes: 'after ":"' }],
		fixed: "a: 1\n",
	},
	{
		name: "a value on the next line is fine",
		input: "a:\n  b: 1\n",
		expected: [],
	},
	{
		name: "spaces before a comment after the colon are comments-spacing's business",
		input: "a:   # c\n  b: 1\n",
		expected: [],
	},
	{
		name: "an explicit-value colon at the head of its line is structure, not spacing",
		input: "? key\n: value\n",
		expected: [],
	},
	{
		name: "a quoted key's space before the colon reports and fixes",
		input: '"a" : 1\n',
		expected: [{ line: 0, character: 3, messageIncludes: 'before ":"' }],
		fixed: '"a": 1\n',
	},
	{
		// `- : 1` is a sequence of the map `{ "": 1 }`; deleting the space gives
		// `-: 1`, the map `{ "-": 1 }`. The finding stands, the fix declines.
		name: "the space after a sequence hyphen is not spacing before a key: no fix",
		input: "- : 1\n",
		expected: [{ line: 0, character: 1, messageIncludes: 'before ":"' }],
		fixed: "- : 1\n",
	},
	{
		// `a: :` deleted to `a::` is the key `a:` — another structure.
		name: "the space after another colon is separation: no fix",
		input: "a: : 1\n",
		expected: [{ line: 0, character: 2, messageIncludes: 'before ":"' }],
		fixed: "a: : 1\n",
		setting: "error",
		expectsParseErrors: false,
	},
	{
		// An alias name may contain `:`, so `*x:` reads as the alias `x:`.
		name: "the space after an alias key keeps the alias name whole: no fix",
		input: "a: &x k\n*x : 1\n",
		expected: [{ line: 1, character: 2, messageIncludes: 'before ":"' }],
		fixed: "a: &x k\n*x : 1\n",
	},
	{
		// The lexer mints a `block-map-value` for this `:`, but the composer
		// folds the line into the plain scalar `"a - :  b"`: it is content, and
		// a fix there changed the value. yaml 2.9 rejects this input (an implicit
		// key across two lines); the leniency is the composer's, and the rule
		// follows the composer either way.
		name: "a colon the composer reads as scalar content is not reported",
		input: "a\n  - :  b\n",
		expected: [],
	},
]);

testRule(builtin("hyphen-spacing"), [
	{
		name: "- item passes",
		input: "- a\n- b\n",
		expected: [],
	},
	{
		name: "extra spaces after the hyphen report and fix to one",
		input: "-   a\n- b\n",
		expected: [{ line: 0, character: 1, messageIncludes: 'after "-"' }],
		fixed: "- a\n- b\n",
	},
	{
		name: "a nested value on the next line is fine",
		input: "-\n  a: 1\n",
		expected: [],
	},
	{
		name: "indentation before the hyphen is not this rule's business",
		input: "steps:\n  - a\n  - b\n",
		expected: [],
	},
	{
		// The lexer mints a `block-seq-entry` for this `-`, but the composer
		// folds the line into the plain scalar `"b -  a"`: deleting a space
		// changed the value.
		name: "a hyphen the composer reads as scalar content is not reported",
		input: "b\n -  a\n",
		expected: [],
	},
	{
		// `b: 2` is indented to `a`'s column; moving `a` left re-parents it.
		name: "a multi-line block mapping after the hyphen keeps its column: no fix",
		input: "-   a: 1\n    b: 2\n",
		expected: [{ line: 0, character: 1, messageIncludes: 'after "-"' }],
		fixed: "-   a: 1\n    b: 2\n",
	},
	{
		name: "a multi-line block sequence after the hyphen keeps its column: no fix",
		input: "-   - a\n    - b\n",
		expected: [{ line: 0, character: 1, messageIncludes: 'after "-"' }],
		fixed: "-   - a\n    - b\n",
	},
	{
		name: "a single-line block mapping after the hyphen still fixes",
		input: "-   a: 1\n- b\n",
		expected: [{ line: 0, character: 1, messageIncludes: 'after "-"' }],
		fixed: "- a: 1\n- b\n",
	},
]);
