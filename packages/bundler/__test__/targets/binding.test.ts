import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { writeTargetsBinding } from "../../src/targets/binding.js";

describe("writeTargetsBinding", () => {
	it("writes dist/prod/targets.json with groups and targets", () => {
		const cwd = mkdtempSync(join(tmpdir(), "bind-"));
		const path = writeTargetsBinding(cwd, {
			groups: [{ id: "npm", name: "x", dir: "dist/prod/npm/pkg" }],
			targets: [
				{ id: "npm", group: "npm", name: "x", registry: "https://registry.npmjs.org", releases: "all" },
				{ id: "mirror", group: "npm", name: "x", registry: "https://mirror.test", releases: "prerelease" },
			],
		});
		assert.strictEqual(path, join(cwd, "dist", "prod", "targets.json"));
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as {
			groups: Array<{ id: string }>;
			targets: Array<{ id: string; group: string; releases: string }>;
		};
		assert.deepStrictEqual(
			parsed.groups.map((g) => g.id),
			["npm"],
		);
		assert.strictEqual(parsed.targets.find((t) => t.id === "mirror")?.group, "npm");
		assert.deepStrictEqual(
			parsed.targets.map((t) => t.releases),
			["all", "prerelease"],
		);
	});
});
