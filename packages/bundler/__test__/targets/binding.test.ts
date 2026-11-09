// Ported from savvy-web/systems packages/tsdown-plugins/__test__/targets/binding.test.ts on 2026-11-06
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { writeTargetsBinding } from "../../src/targets/binding.js";

describe("writeTargetsBinding", () => {
	it.effect("writes dist/prod/targets.json with groups and targets", () =>
		Effect.gen(function* () {
			const handle = MemoryFileSystem.makeSync();
			const cwd = "/ws/pkg";
			const path = yield* writeTargetsBinding(cwd, {
				groups: [{ id: "npm", name: "x", dir: "dist/prod/npm/pkg" }],
				targets: [
					{ id: "npm", group: "npm", name: "x", registry: "https://registry.npmjs.org", releases: "all" },
					{ id: "mirror", group: "npm", name: "x", registry: "https://mirror.test", releases: "prerelease" },
				],
			}).pipe(Effect.provide(handle.layer));
			assert.strictEqual(path, join(cwd, "dist", "prod", "targets.json"));
			const text = handle.volume.text(path) ?? "";
			// Tab-indented with a trailing newline: the bytes the release action has always read.
			assert.isTrue(text.startsWith('{\n\t"groups"'));
			assert.isTrue(text.endsWith("}\n"));
			const parsed = JSON.parse(text) as {
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
		}),
	);
});
