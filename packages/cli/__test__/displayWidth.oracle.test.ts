// The differential test for the package's own display width, against `string-width`. This is the ONLY file in the
// package that imports `string-width` (a devDependency); see okf/decisions/own-display-width.md.
import { assert, describe, it } from "@effect/vitest";
import stringWidth from "string-width";
import { displayWidth } from "../src/internal/displayWidth.js";

const OSC8 = "\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007";

/** 29 curated strings: ASCII, accents, CJK, emoji of every kind, ANSI, OSC-8, text and emoji presentation. */
const CURATED: ReadonlyArray<string> = [
	"hello world",
	"héllo",
	"héllo",
	"日本語",
	"ＡＢＣ",
	"👍",
	"👨‍👩‍👧",
	"🇯🇵",
	"👍🏽",
	"1️⃣",
	"\u001b[31mred\u001b[0m",
	"a\tb",
	"한국어",
	OSC8,
	"ｱｲｳ",
	"⚠️",
	"❤️",
	"✅",
	"⚠",
	"สวัสดี",
	"",
	"🏳️‍🌈",
	"─┼─│",
	"日本語 mixed abc",
	"a‍b",
	"🌡",
	"🌡️",
	"\u{20000}",
	"한ㅤ글",
];

describe("displayWidth against string-width", () => {
	it("the oracle is the version the decision was measured against", () => {
		// 7.2.0 said 2 for a bare U+26A0 and 8.3.0 says 1; if this flips, string-width drifted and the sweep below
		// is no longer comparing what the decision measured.
		assert.strictEqual(stringWidth("⚠"), 1);
	});

	it("the harness can report a mismatch (positive control)", () => {
		assert.notStrictEqual(stringWidth("日本語"), "日本語".length);
		assert.notStrictEqual(displayWidth("日本語"), "日本語".length);
	});

	it("has 29 curated strings", () => {
		assert.strictEqual(CURATED.length, 29);
	});

	for (const text of CURATED) {
		it(`curated ${JSON.stringify(text)}`, () => {
			assert.strictEqual(displayWidth(text), stringWidth(text));
		});
	}

	it("a code-point sweep agrees, except the lone regional indicators", () => {
		// Every assigned code point of the BMP, the astral ranges the width table covers, and the emoji plane,
		// with a stride over the vast CJK extension planes. Surrogates and ESC (which starts an escape) are skipped.
		const ranges: ReadonlyArray<readonly [number, number, number]> = [
			[0x0000, 0xffff, 1],
			[0x16fe0, 0x16ff6, 1],
			[0x17000, 0x191ff, 1],
			[0x1aff0, 0x1b2ff, 1],
			[0x1d300, 0x1d376, 1],
			[0x1f000, 0x1ffff, 1],
			[0x20000, 0x3fffd, 97],
		];
		const assigned = /^\p{Assigned}$/u;
		const mismatches: string[] = [];
		let checked = 0;
		for (const [from, to, step] of ranges) {
			for (let cp = from; cp <= to; cp += step) {
				if ((cp >= 0xd800 && cp <= 0xdfff) || cp === 0x1b) continue;
				const ch = String.fromCodePoint(cp);
				if (!assigned.test(ch)) continue;
				// Documented divergence: a lone regional indicator is 1 for the oracle and 2 here.
				if (cp >= 0x1f1e6 && cp <= 0x1f1ff) continue;
				checked++;
				if (displayWidth(ch) !== stringWidth(ch)) {
					mismatches.push(`U+${cp.toString(16).toUpperCase()} ours=${displayWidth(ch)} oracle=${stringWidth(ch)}`);
				}
			}
		}
		assert.isAbove(checked, 50_000);
		assert.deepStrictEqual(mismatches.slice(0, 10), []);
		assert.strictEqual(mismatches.length, 0);
	});

	it("pins the two documented divergences", () => {
		// A lone regional indicator: the oracle counts one column, this counts two.
		assert.strictEqual(stringWidth("\u{1F1FA}"), 1);
		assert.strictEqual(displayWidth("\u{1F1FA}"), 2);
		// A bare combining mark glued after a flag grapheme: the oracle folds the whole grapheme to one column,
		// this counts two.
		assert.strictEqual(stringWidth("🇺🇸ั"), 1);
		assert.strictEqual(displayWidth("🇺🇸ั"), 2);
	});

	it("a seeded fuzz of 5,000 compositions agrees", () => {
		// Atoms are the curated strings without a free-standing combining mark, the one documented divergence.
		const atoms = CURATED.filter((text) => text !== "" && !text.includes("ㅤ"));
		// mulberry32, fixed seed: the run never varies.
		let state = 0x5eed1234;
		const next = (): number => {
			state = (state + 0x6d2b79f5) | 0;
			let t = Math.imul(state ^ (state >>> 15), 1 | state);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		const mismatches: string[] = [];
		for (let i = 0; i < 5000; i++) {
			const length = 1 + Math.floor(next() * 6);
			let text = "";
			for (let j = 0; j < length; j++) text += atoms[Math.floor(next() * atoms.length)];
			if (displayWidth(text) !== stringWidth(text)) mismatches.push(JSON.stringify(text));
		}
		assert.deepStrictEqual(mismatches.slice(0, 5), []);
	});
});
