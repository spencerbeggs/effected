import { assert, describe, it } from "@effect/vitest";
import { CommandNeutralizer } from "../src/index.js";
import { commandLines, isCommand } from "./helpers/runnerCommands.js";

const ZWSP = String.fromCodePoint(0x200b);
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

describe("CommandNeutralizer: the runner's two parsers", () => {
	it("the oracle itself flags what each parser reads, and nothing else (mutation controls)", () => {
		for (const command of [
			"::error::x",
			"  ::add-mask::x",
			"\u0085::x",
			"　 ::x",
			"prefix ##[add-mask]secret",
			"##[group]x",
			"x##[y",
		]) {
			assert.isTrue(isCommand(command), JSON.stringify(command));
		}
		for (const quiet of ["## Heading", "a :: b", ": :x", `${MARK}::x`, `##${MARK}[x`, "# [x]", "##", "#[x]"]) {
			assert.isFalse(isCommand(quiet), JSON.stringify(quiet));
		}
	});

	it("the oracle reads a command through what ICU skips: a zero-width space, a BOM, a control or a tag hides nothing", () => {
		for (const hidden of [
			`${ZWSP}::x`,
			"\uFEFF::x",
			`:${ZWSP}:add-mask::x`,
			"\u0001::x",
			`##${ZWSP}[x`,
			"#\u0640#[x",
			"#\u{E0041}#\u200D[x",
		]) {
			assert.isTrue(isCommand(hidden), JSON.stringify(hidden));
		}
	});

	it("a V2 line gets the marker in front, before whatever whitespace it had", () => {
		for (const line of ["::error::x", "  ::add-mask::x", "\t::x", " ::x", "\u0085::x", " ::x"]) {
			const [out] = CommandNeutralizer.lines(line);
			assert.strictEqual(out, `${MARK}${line}`, JSON.stringify(line));
			assert.isFalse(isCommand(out ?? ""), JSON.stringify(line));
		}
	});

	it("the legacy form is broken at EVERY occurrence, wherever it sits, and a bare ## is left alone", () => {
		assert.deepStrictEqual(CommandNeutralizer.lines("a ##[x] b ##[y]"), [`a ##${MARK}[x] b ##${MARK}[y]`]);
		assert.deepStrictEqual(CommandNeutralizer.lines("prefix ##[add-mask]secret"), [`prefix ##${MARK}[add-mask]secret`]);
		for (const bare of ["## Heading", "a ## b", "##", "###", "## [link]", "#[x]", "# #[x]", "##x[y]"]) {
			assert.deepStrictEqual(CommandNeutralizer.lines(bare), [bare], JSON.stringify(bare));
		}
	});

	it("splits at CR, LF and CRLF, as the runner does, so a lone CR starts a line", () => {
		const out = CommandNeutralizer.lines("a\r::error::x\r\n##[group]y\n  ::add-mask::z\rplain\r\n ::w\n\u0085::n");
		assert.strictEqual(out.length, 7);
		assert.deepStrictEqual(out.filter(isCommand), []);
		assert.deepStrictEqual(CommandNeutralizer.lines("no command\nhere: ::"), ["no command", "here: ::"]);
	});

	it("text joins the neutralized lines with a line feed", () => {
		assert.strictEqual(CommandNeutralizer.text("a\r\n::b\rc"), `a\n${MARK}::b\nc`);
		assert.strictEqual(CommandNeutralizer.text(""), "");
	});

	it("is idempotent", () => {
		for (const text of ["::error::x\n a ##[b]\n##[c]", "plain", "::a::##[b]##[c]", "x\r\n::y", "##[", "##[[ ##[#[x"]) {
			const once = CommandNeutralizer.text(text);
			assert.strictEqual(CommandNeutralizer.text(once), once, JSON.stringify(text));
		}
	});
});

describe("CommandNeutralizer: exhaustive over a small alphabet, judged by the independent oracle", () => {
	// The sweep over every string up to a length is in `CommandNeutralizer.property.test.ts`.
	it("a string that already carries zero-width spaces, which the runner skips, is still made safe", () => {
		for (const text of strings([":", "#", "[", ZWSP, "\n"], 6)) {
			assert.deepStrictEqual(commandLines(CommandNeutralizer.text(text)), [], JSON.stringify(text));
		}
	});

	it("so is one that hides a command behind anything else ICU skips: a BOM, a control, a mark, a tag", () => {
		for (const text of strings([":", "#", "[", " ", "\uFEFF", "\u0001", "\u0301", "\u{E0041}", "x"], 4)) {
			const once = CommandNeutralizer.text(text);
			assert.deepStrictEqual(commandLines(once), [], JSON.stringify(text));
			assert.strictEqual(CommandNeutralizer.text(once), once, `idempotent: ${JSON.stringify(text)}`);
		}
	});

	it("a zero-width-space-prefixed command is neutralized again, not taken as already safe", () => {
		assert.deepStrictEqual(CommandNeutralizer.lines(`${ZWSP}::add-mask::x`), [`${MARK}${ZWSP}::add-mask::x`]);
		assert.deepStrictEqual(CommandNeutralizer.lines(`##${ZWSP}[x]`), [`##${ZWSP}${MARK}[x]`]);
	});
});

// `CommandNeutralizer.hostile.test.ts` holds that matching each of these is linear in its length.
describe("CommandNeutralizer: a long hostile line is still answered", () => {
	const BOM = String.fromCodePoint(0xfeff);

	it("a long run of BOMs (both whitespace and a format character) with no command is returned unchanged", () => {
		const text = `${BOM.repeat(10_000)}x`;
		assert.strictEqual(CommandNeutralizer.text(text), text);
	});

	it("the same run in front of a command is neutralized", () => {
		assert.deepStrictEqual(commandLines(CommandNeutralizer.text(`${BOM.repeat(10_000)}::add-mask::x`)), []);
	});

	it("so is a run mixing every kind of leading character the V2 rule skips", () => {
		const text = `${` \t\u0085${BOM}${ZWSP}\u0301`.repeat(2_000)}x`;
		assert.strictEqual(CommandNeutralizer.text(text), text);
	});

	it("and a long run of #-and-ignorable pairs with no [ is left alone", () => {
		const text = `#${ZWSP}`.repeat(5_000);
		assert.strictEqual(CommandNeutralizer.text(text), text);
	});
});
