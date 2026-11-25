import { assert, describe, it } from "@effect/vitest";
import { afterEach, vi } from "vitest";
import { Depth } from "../src/index.js";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("Depth.parse", () => {
	it("parses undefined as sample", () => {
		assert.strictEqual(Depth.parse(undefined), "sample");
	});

	it("parses the two depths", () => {
		assert.strictEqual(Depth.parse("sample"), "sample");
		assert.strictEqual(Depth.parse("full"), "full");
	});

	// A mistyped depth must never read as a passed full run.
	it("refuses anything else, naming the value and the variable", () => {
		for (const raw of ["Full", "ful", "", " full", "1"]) {
			assert.throws(() => Depth.parse(raw), /EFFECTED_TEST_DEPTH must be "sample" or "full"/);
			assert.throws(() => Depth.parse(raw), new RegExp(JSON.stringify(raw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		}
	});
});

describe("Depth.current", () => {
	it("reads the environment on every access", () => {
		vi.stubEnv("EFFECTED_TEST_DEPTH", "full");
		assert.strictEqual(Depth.current, "full");
		vi.stubEnv("EFFECTED_TEST_DEPTH", "sample");
		assert.strictEqual(Depth.current, "sample");
	});

	it("refuses a mistyped environment value", () => {
		vi.stubEnv("EFFECTED_TEST_DEPTH", "Full");
		assert.throws(() => Depth.current, /EFFECTED_TEST_DEPTH/);
	});
});

describe("Depth.pick and Depth.whenFull", () => {
	it("picks by depth and runs whenFull only at full", () => {
		vi.stubEnv("EFFECTED_TEST_DEPTH", "full");
		assert.strictEqual(Depth.pick({ sample: 5, full: 6 }), 6);
		let ran = 0;
		Depth.whenFull(() => {
			ran += 1;
		});
		vi.stubEnv("EFFECTED_TEST_DEPTH", "sample");
		assert.strictEqual(Depth.pick({ sample: 5, full: 6 }), 5);
		Depth.whenFull(() => {
			ran += 1;
		});
		assert.strictEqual(ran, 1);
	});
});
