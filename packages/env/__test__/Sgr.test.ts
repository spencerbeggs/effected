import { stripVTControlCharacters } from "node:util";
import { assert, describe, it } from "@effect/vitest";
import type { SgrStyle } from "../src/Sgr.js";
import { Sgr } from "../src/Sgr.js";

/**
 * Milliseconds of CPU time this process has spent (`process.cpuUsage`, user plus system): time the work spent, not
 * time the process was descheduled, so a loaded machine can not stretch a sample. vitest runs each file in its own
 * fork, so no other test's CPU lands here. It under-measures async I/O, which the units here do not use.
 */
const cpuNow = (): number => {
	const used = process.cpuUsage();
	return (used.user + used.system) / 1000;
};

const ESC = "\u001b";

describe("Sgr.strip", () => {
	it("removes bold, reset, truecolor and the colon form", () => {
		assert.strictEqual(Sgr.strip(`${ESC}[1mbold${ESC}[0m`), "bold");
		assert.strictEqual(Sgr.strip(`${ESC}[38;2;1;2;3mrgb${ESC}[39m`), "rgb");
		assert.strictEqual(Sgr.strip(`${ESC}[38:2::1:2:3mrgb${ESC}[39m`), "rgb");
		assert.strictEqual(Sgr.strip(`${ESC}[mbare`), "bare");
	});

	it("keeps a cursor move, an erase and an OSC 8 hyperlink", () => {
		const cursor = `${ESC}[2A${ESC}[Kline`;
		assert.strictEqual(Sgr.strip(cursor), cursor);
		const link = `${ESC}]8;;https://example.com${ESC}\\text${ESC}]8;;${ESC}\\`;
		assert.strictEqual(Sgr.strip(link), link);
		assert.strictEqual(Sgr.strip(`${ESC}[1m${link}${ESC}[0m`), link);
	});

	it("agrees with node:util on SGR-only input", () => {
		const samples = [
			`${ESC}[1mA${ESC}[22m ${ESC}[31mB${ESC}[39m`,
			`${ESC}[38;5;200mC${ESC}[0m${ESC}[48;2;9;9;9mD${ESC}[49m`,
			`plain`,
			`${ESC}[1;4;31mmulti${ESC}[0m`,
		];
		for (const sample of samples) assert.strictEqual(Sgr.strip(sample), stripVTControlCharacters(sample));
	});

	it("is linear on a long parameter run that never ends in m", () => {
		const input = `${ESC}[${"1;".repeat(100_000)}`;
		const start = cpuNow();
		assert.strictEqual(Sgr.strip(input), input);
		const repeated = `${ESC}[1;`.repeat(50_000);
		assert.strictEqual(Sgr.strip(repeated), repeated);
		assert.isBelow(cpuNow() - start, 1000);
	});
});

describe("Sgr.paint", () => {
	it("is the identity at none", () => {
		assert.strictEqual(Sgr.paint("none", "red", "text"), "text");
		assert.strictEqual(Sgr.paint("none", ["bold", "red"], "text"), "text");
	});

	it("emits the known SGR bytes for each style", () => {
		const expected: ReadonlyArray<readonly [SgrStyle, string, string]> = [
			["bold", "1", "22"],
			["dim", "2", "22"],
			["italic", "3", "23"],
			["underline", "4", "24"],
			["black", "30", "39"],
			["red", "31", "39"],
			["green", "32", "39"],
			["yellow", "33", "39"],
			["blue", "34", "39"],
			["magenta", "35", "39"],
			["cyan", "36", "39"],
			["white", "37", "39"],
			["gray", "90", "39"],
		];
		for (const [style, open, close] of expected) {
			assert.strictEqual(Sgr.paint("basic", style, "x"), `\u001b[${open}mx\u001b[${close}m`, style);
		}
	});

	it("paints the same at every level above none", () => {
		for (const level of ["basic", "256", "truecolor"] as const) {
			assert.strictEqual(Sgr.paint(level, "green", "ok"), "\u001b[32mok\u001b[39m");
		}
	});

	it("lists a style array outermost first", () => {
		assert.strictEqual(Sgr.paint("basic", ["bold", "red"], "x"), "\u001b[1m\u001b[31mx\u001b[39m\u001b[22m");
	});

	it("re-opens the outer style after a nested close", () => {
		const inner = Sgr.paint("basic", "green", "in");
		assert.strictEqual(inner, "\u001b[32min\u001b[39m");
		assert.strictEqual(
			Sgr.paint("basic", "red", `a${inner}b`),
			"\u001b[31ma\u001b[32min\u001b[39m\u001b[31mb\u001b[39m",
		);
	});

	it("leaves empty text empty", () => {
		assert.strictEqual(Sgr.paint("basic", "red", ""), "");
	});

	it("strips back to the text", () => {
		assert.strictEqual(Sgr.strip(Sgr.paint("truecolor", ["bold", "yellow"], "hi")), "hi");
	});
});
