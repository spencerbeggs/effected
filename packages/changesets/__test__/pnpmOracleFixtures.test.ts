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

for (const name of cases) {
	it(`${name} has a recorded expected.json naming the pnpm that produced it`, () => {
		const path = join(ROOT, name, "expected.json");
		assert.isTrue(existsSync(path));
		const text = readFileSync(path, "utf8");
		assert.isTrue(text.trim().length > 0);
		const expected = JSON.parse(text) as { pnpmVersion?: unknown; outcome?: unknown };
		assert.isString(expected.pnpmVersion);
		assert.isTrue(expected.outcome === "applied" || expected.outcome === "rejected");
	});
}
