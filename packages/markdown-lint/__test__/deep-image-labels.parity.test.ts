// Images nest inside image labels as deep as the input, and micromark reads every level's label as inline content.
// The kit's image carries its alt as a string, so the readers re-parse each level's label in turn (see
// `imageLabelNodes` and `referenceData`). Each level here holds a finding for every rule that reads image labels, so
// the comparison against markdownlint covers the deep levels, not only the outermost.

import { assert, describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import type { LintRule } from "../src/LintRule.js";
import { MD039 } from "../src/rules/MD039.js";
import { MD042 } from "../src/rules/MD042.js";
import { MD049 } from "../src/rules/MD049.js";
import { MD050 } from "../src/rules/MD050.js";
import { MD052 } from "../src/rules/MD052.js";
import { MD053 } from "../src/rules/MD053.js";
import { MD054 } from "../src/rules/MD054.js";
import { MD059 } from "../src/rules/MD059.js";
import { compareOne } from "./helpers/differential.js";

const LEVEL = "_e_ *f* __s__ **t** [ sp ](u) [z]() [x][q] [y][r] [r] [click here](u) ";

/** `depth` images, each label holding `LEVEL` and the next image, beside one used and one unused definition. */
const nestedImages = (depth: number): string =>
	`# T\n\n*a* **b**\n\n${`![${LEVEL}`.repeat(depth)}a${"](b)".repeat(depth)}\n\n[r]: u\n[unused]: u\n`;

// Each rule and its settings, and whether markdownlint reports a finding per level (MD053 reports the one unused
// definition, and reads the levels for the uses that keep `[r]` used).
const readers: ReadonlyArray<readonly [rule: LintRule, settings: unknown, perLevel: boolean]> = [
	[MD039, true, true],
	[MD042, true, true],
	[MD049, true, true],
	[MD050, true, true],
	[MD052, { shortcut_syntax: true }, true],
	[MD053, true, false],
	[MD054, { inline: false, full: false, shortcut: false }, true],
	[MD059, true, true],
];

// 50 levels on every run; 300, which is most of this file's time, at full depth.
describe("images nested in image labels", () => {
	for (const depth of Depth.pick({ sample: [50], full: [50, 300] })) {
		for (const [rule, settings, perLevel] of readers) {
			it(`${rule.name} matches markdownlint over ${depth} levels`, { timeout: 60_000 }, () => {
				const { oracleFindings, reason } = compareOne(
					rule,
					{ default: false, [rule.name]: settings },
					{ name: `${depth} levels`, source: nestedImages(depth) },
				);
				assert.isAtLeast(oracleFindings, perLevel ? depth : 1, `markdownlint found ${oracleFindings}`);
				assert.isUndefined(reason);
			});
		}
	}
});

// A level's label is re-parsed with the inline images nested in it left out, which holds only while the text left out
// plays no part in how the label holding it reads: a `$` in it can pair with one past it and open math, a link formed
// in it makes the link starts before it inactive, and a `]` in a code span in it does not end the label holding it.
const MD054_ALL = { inline: false, full: false, shortcut: false, collapsed: false, autolink: false };
const across: ReadonlyArray<readonly [name: string, source: string, rule: LintRule, settings: unknown]> = [
	["a `$` pairing out of a nested label", "![x ![a $](x) [b][c] $](y)\n", MD052, true],
	[
		"a `$` pairing out of a nested label, shortcuts read",
		"![x ![a $](x) [b] $](y)\n",
		MD052,
		{ shortcut_syntax: true },
	],
	["a `$` pairing out of a nested label", "[c]: u\n\n![x ![a $](x) [b][c] $](y)\n\n[unused]: v\n", MD053, true],
	["a link formed in a nested label", "![[`![bb[r]_](x)*][r]](x)\n\n[r]: u\n", MD052, true],
	["a link formed in a nested label", "![[`![bb[r]_](x)*][r]](x)\n\n[r]: u\n", MD054, MD054_ALL],
	["a `]` in a code span in a nested label", "![![a` [r]](x)`![`\nb][]](x)\n](x)](x)\n\n[r]: u\n", MD052, true],
	["a `]` in a code span in a nested label", "![![a` [r]](x)`![`\nb][]](x)\n](x)](x)\n\n[r]: u\n", MD053, true],
	["a `]` in a code span in a nested label", "![![a` [r]](x)`![`\nb][]](x)\n](x)](x)\n\n[r]: u\n", MD054, MD054_ALL],
	["a `]` in a nested image's title", '![a ![b](x "t]")](y)\n', MD052, true],
];

describe("labels holding a nested image", () => {
	for (const [name, source, rule, settings] of across) {
		it(`${rule.name} matches markdownlint over ${name}`, () => {
			const { reason } = compareOne(rule, { default: false, [rule.name]: settings }, { name, source });
			assert.isUndefined(reason);
		});
	}
});
