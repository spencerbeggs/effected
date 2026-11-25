// Every string up to a length over the characters that make or break a workflow command, judged by the independent
// oracle. `CommandNeutralizer.test.ts` holds the named cases.

import { assert, describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { CommandNeutralizer } from "../src/index.js";
import { LINE_BREAK, commandLines, isCommand } from "./helpers/runnerCommands.js";

/** The marker: U+2800 BRAILLE PATTERN BLANK. */
const MARK = String.fromCodePoint(0x2800);

/** Every string up to `length` over `alphabet`, as a lazily built list. */
const strings = (alphabet: ReadonlyArray<string>, length: number): ReadonlyArray<string> => {
	let level: ReadonlyArray<string> = [""];
	const all: Array<string> = [""];
	for (let i = 0; i < length; i++) {
		level = level.flatMap((prefix) => alphabet.map((ch) => `${prefix}${ch}`));
		for (const item of level) all.push(item);
	}
	return all;
};

describe("CommandNeutralizer: exhaustive over a small alphabet, judged by the independent oracle", () => {
	// The characters that make or break a command: the colon, the hash, the bracket, ordinary and .NET whitespace (a
	// space, a tab, NEL), the three line break characters and a letter.
	//
	// Length 5 is what a pull request runs: 66,430 strings. The longest trigger is three characters (`##[`, or
	// whitespace then `::`), so five holds a one-character line break, a whole trigger and one character before it:
	// every way a trigger meets a single break or what precedes it. A CRLF break with a character before it and a
	// three-character trigger needs six, which is 597,871 strings: too many for every pull request (four tests over
	// them ran past the runner's test timeout), so length 6 runs at full depth.
	const LENGTH = Depth.pick({ sample: 5, full: 6 });
	const ALL = strings([":", "#", "[", " ", "\t", "\u0085", "\r", "\n", "x"], LENGTH);
	const TIMEOUT = { timeout: 120_000 };

	it(`no output line is a command, for all ${ALL.length} strings`, TIMEOUT, () => {
		for (const text of ALL) {
			assert.deepStrictEqual(commandLines(CommandNeutralizer.text(text)), [], JSON.stringify(text));
		}
	});

	it("only the marker is added: removing it gives back the input's own lines", TIMEOUT, () => {
		for (const text of ALL) {
			const out = CommandNeutralizer.lines(text).map((line) => line.replaceAll(MARK, ""));
			assert.deepStrictEqual(out, text.split(LINE_BREAK), JSON.stringify(text));
		}
	});

	it("a line the oracle does not read as a command is returned exactly as it was", TIMEOUT, () => {
		for (const text of ALL) {
			const inputLines = text.split(LINE_BREAK);
			const out = CommandNeutralizer.lines(text);
			inputLines.forEach((line, index) => {
				if (!isCommand(line)) assert.strictEqual(out[index], line, JSON.stringify(text));
			});
		}
	});

	it("is idempotent for every one of them", TIMEOUT, () => {
		for (const text of ALL) {
			const once = CommandNeutralizer.text(text);
			assert.strictEqual(CommandNeutralizer.text(once), once, JSON.stringify(text));
		}
	});
});
