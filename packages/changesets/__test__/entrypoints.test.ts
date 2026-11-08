import { readFileSync } from "node:fs";
import { assert, it } from "@effect/vitest";
import * as Changesets from "../src/index.js";

it("the root exports exactly the public surface", () => {
	assert.deepStrictEqual(Object.keys(Changesets).sort(), [
		"BumpType",
		"ChangesetConfig",
		"ChangesetConfigError",
		"ChangesetFile",
		"ChangesetParseError",
		"ParsedChangeset",
		"PendingChangeset",
		"PendingChangesets",
		"PlannedRelease",
		"PreState",
		"ReleasePlan",
		"ReleaseType",
		"UnknownPackageError",
	]);
});

it("the lint entry exports exactly ChangesetLint", async () => {
	const Lint = await import("../src/lint.js");
	assert.deepStrictEqual(Object.keys(Lint), ["ChangesetLint"]);
});

it("the root never reaches the optional markdown peers", () => {
	// Walk the root's relative imports: a consumer of the planner alone does not
	// install @effected/markdown or @effected/markdown-lint.
	const seen = new Set<string>();
	const reached = new Set<string>();
	const visit = (url: URL): void => {
		if (seen.has(url.href)) return;
		seen.add(url.href);
		const source = readFileSync(url, "utf8");
		for (const [, specifier = ""] of source.matchAll(/from "([^"]+)"/g)) {
			if (specifier.startsWith(".")) visit(new URL(specifier.replace(/\.js$/, ".ts"), url));
			else reached.add(specifier);
		}
	};
	visit(new URL("../src/index.ts", import.meta.url));
	assert.isAbove(seen.size, 5);
	assert.isTrue(reached.has("@effected/semver"));
	assert.isFalse([...reached].some((specifier) => specifier.startsWith("@effected/markdown")));
	visit(new URL("../src/lint.ts", import.meta.url));
	assert.isTrue(reached.has("@effected/markdown-lint"));
});
