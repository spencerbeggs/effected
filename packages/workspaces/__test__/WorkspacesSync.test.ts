// The synchronous escape hatch runs on real `node:fs`, so it cannot ride the
// virtual `FileSystem` layer the rest of the suite uses — these tests build a
// real temporary tree instead.
//
// `findWorkspaceRootSync` / `getWorkspacePackagesSync` are plain synchronous
// functions, not Effects, so plain `it()` is correct here.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { findWorkspaceRootSync, getWorkspacePackagesSync } from "../src/index.js";

let root = "";

/** Write `content` to `root/relative`, creating parent directories. */
const write = (relative: string, content: string): void => {
	const file = join(root, relative);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content, "utf8");
};

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "effected-workspaces-sync-"));
	write("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n");
	write("package.json", JSON.stringify({ name: "root", version: "0.0.0", private: true }));
	write("packages/good/package.json", JSON.stringify({ name: "@x/good", version: "1.0.0" }));

	// The hostile manifests. Each is VALID JSON that does not decode to an object,
	// which is the case a `raw === undefined` guard does not cover: `JSON.parse`
	// returns `null` / a number / a string, never `undefined`.
	write("packages/null-manifest/package.json", "null");
	write("packages/number-manifest/package.json", "42");
	write("packages/string-manifest/package.json", '"nope"');
	write("packages/array-manifest/package.json", "[1, 2, 3]");
	// And an outright syntax error, which the `undefined` guard DID cover.
	write("packages/broken-manifest/package.json", "{ not json");
});

afterAll(() => {
	if (root !== "") rmSync(root, { recursive: true, force: true });
});

describe("getWorkspacePackagesSync — hostile manifests", () => {
	it("a package.json containing exactly `null` does not crash the enumeration", () => {
		// Regression: `readJson` returned `JSON.parse`'s result typed as
		// `Record | undefined`, but `JSON.parse("null")` is `null`. The
		// `raw === undefined` guard let it through and `raw.name` threw a
		// TypeError — malformed input escaping as a DEFECT out of a function
		// documented as total. A Vitest config calling this would simply crash.
		const packages = getWorkspacePackagesSync(root);
		const names = packages.map((pkg) => pkg.name);
		assert.include(names, "@x/good");
	});

	it("every non-object manifest is skipped, not decoded into a member", () => {
		const names = getWorkspacePackagesSync(root).map((pkg) => pkg.name);
		// Only the root and the one good member survive; the five hostile
		// directories contribute nothing.
		assert.deepStrictEqual(names.slice().sort(), ["@x/good", "root"]);
	});

	it("the good member is still fully decoded alongside the hostile ones", () => {
		const good = getWorkspacePackagesSync(root).find((pkg) => pkg.name === "@x/good");
		assert.isDefined(good);
		assert.strictEqual(good?.version, "1.0.0");
		assert.strictEqual(good?.relativePath, "packages/good");
	});
});

describe("findWorkspaceRootSync", () => {
	it("finds the root from a nested directory", () => {
		assert.strictEqual(findWorkspaceRootSync(join(root, "packages", "good")), root);
	});

	it("a root whose package.json is `null` still resolves via pnpm-workspace.yaml", () => {
		// `manifest?.workspaces` optional-chains, so this path never threw — but it
		// is the sibling of the crash above and worth pinning.
		assert.strictEqual(findWorkspaceRootSync(root), root);
	});
});
