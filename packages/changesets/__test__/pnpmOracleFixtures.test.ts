import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assert, it } from "@effect/vitest";

const ROOT = new URL("./fixtures/pnpm-native/", import.meta.url).pathname;

const cases = readdirSync(ROOT, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

it("records at least one pnpm-native oracle case", () => {
	assert.isTrue(cases.length > 0);
});

interface Expected {
	readonly pnpmVersion?: unknown;
	readonly case?: unknown;
	readonly outcome?: unknown;
	readonly releases?: ReadonlyArray<unknown>;
	readonly errors?: ReadonlyArray<unknown>;
	readonly ledgerFile?: string | null;
	readonly statusFile?: string;
}

for (const name of cases) {
	it(`${name} has a coherent recorded expected.json`, () => {
		const path = join(ROOT, name, "expected.json");
		assert.isTrue(existsSync(path));
		const text = readFileSync(path, "utf8");
		assert.isTrue(text.trim().length > 0);
		const expected = JSON.parse(text) as Expected;
		assert.isString(expected.pnpmVersion);
		assert.strictEqual(expected.case, name);
		assert.isString(expected.statusFile);
		assert.isTrue(existsSync(join(ROOT, name, expected.statusFile as string)));
		if (expected.ledgerFile !== null && expected.ledgerFile !== undefined) {
			assert.isTrue(existsSync(join(ROOT, name, expected.ledgerFile)));
		}
		if (expected.outcome === "applied") {
			assert.deepStrictEqual(expected.errors, []);
		} else {
			assert.strictEqual(expected.outcome, "rejected");
			assert.isTrue((expected.errors?.length ?? 0) > 0);
			assert.isNull(expected.ledgerFile);
			assert.deepStrictEqual(expected.releases, []);
		}
	});
}

it("an applied case with a ledger records releases, and one without a plan records neither", () => {
	for (const name of cases) {
		const expected = JSON.parse(readFileSync(join(ROOT, name, "expected.json"), "utf8")) as Expected;
		if (expected.outcome !== "applied") continue;
		const hasPlan = (expected.releases?.length ?? 0) > 0;
		assert.strictEqual(typeof expected.ledgerFile === "string", hasPlan, name);
	}
});
