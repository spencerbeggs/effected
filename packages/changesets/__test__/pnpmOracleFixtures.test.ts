import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, it } from "@effect/vitest";
import { PLAN_LINE, containedPath } from "../scripts/oracleSupport.js";
import { ROOT, caseNames, loadExpected } from "./support/pnpmOracle.js";

const cases = caseNames();

it("records at least one pnpm-native oracle case", () => {
	assert.isTrue(cases.length > 0);
});

for (const name of cases) {
	it(`${name} has a coherent recorded expected.json`, () => {
		assert.isTrue(existsSync(join(ROOT, name, "expected.json")));
		// The schema decode is the shape check: a missing or mistyped key throws here.
		const expected = loadExpected(name);
		assert.strictEqual(expected.case, name);
		assert.isTrue(existsSync(join(ROOT, name, expected.statusFile)));
		if (expected.ledgerFile !== null) {
			assert.isTrue(existsSync(join(ROOT, name, expected.ledgerFile)));
		}
		if (expected.outcome === "applied") {
			assert.deepStrictEqual(expected.errors, []);
		} else {
			assert.strictEqual(expected.outcome, "rejected");
			assert.isTrue(expected.errors.length > 0);
			assert.isNull(expected.ledgerFile);
			assert.deepStrictEqual(expected.releases, []);
		}
	});
}

it("an applied case with a ledger records releases, and one without a plan records neither", () => {
	for (const name of cases) {
		const expected = loadExpected(name);
		if (expected.outcome !== "applied") continue;
		const hasPlan = expected.releases.length > 0;
		assert.strictEqual(typeof expected.ledgerFile === "string", hasPlan, name);
	}
});

it("the status text and the recorded releases agree on whether anything is planned", () => {
	for (const name of cases) {
		const expected = loadExpected(name);
		if (expected.outcome !== "applied") continue;
		const status = readFileSync(join(ROOT, name, "status.txt"), "utf8");
		const planned = status.split("\n").filter((line) => PLAN_LINE.test(line)).length;
		assert.strictEqual(planned > 0, expected.releases.length > 0, name);
	}
});

it("lane-graduation depends on a prerelease ledger entry for its intent, left by pnpm", () => {
	const ledger = readFileSync(join(ROOT, "lane-graduation", "ledger.after.yaml"), "utf8");
	assert.isTrue(ledger.includes('"@p/a@3.0.0-alpha.0":'));
	assert.isTrue(ledger.includes('"@p/a@3.0.0":'));
});

it("a prelude path that leaves the scratch copy is refused", () => {
	const work = "/scratch/workspace";
	assert.strictEqual(containedPath(work, ".changeset/x.md"), "/scratch/workspace/.changeset/x.md");
	for (const bad of ["../x", "a/../../x", "/etc/passwd", "..", "a\\..\\x", "."]) {
		assert.throws(() => containedPath(work, bad), /prelude path/);
	}
});
