import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { packageNameOf, resolveBundledSiblings, siblingPaths } from "../../src/dts/bundled-siblings.js";
import { ConfigValidationError } from "../../src/errors.js";

const roots: string[] = [];
afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const write = (path: string, content: string): void => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
};

/** A workspace with `packages/b` depending on sibling `@x/a`, a registry-shaped `reg`, and an outside `file:` link. */
const workspace = (): { readonly root: string; readonly cwd: string; readonly sibling: string } => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "bundled-siblings-")));
	roots.push(root);
	write(join(root, "package.json"), JSON.stringify({ name: "root", version: "0.0.0", private: true }));
	write(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
	const cwd = join(root, "packages", "b");
	const sibling = join(root, "packages", "a");
	const modules = join(cwd, "node_modules");
	mkdirSync(join(modules, "@x"), { recursive: true });
	mkdirSync(sibling, { recursive: true });
	symlinkSync(sibling, join(modules, "@x", "a"));
	const store = join(root, "node_modules", ".pnpm", "reg@1.0.0", "node_modules", "reg");
	mkdirSync(store, { recursive: true });
	symlinkSync(store, join(modules, "reg"));
	const outside = realpathSync(mkdtempSync(join(tmpdir(), "bundled-outside-")));
	roots.push(outside);
	symlinkSync(outside, join(modules, "linked"));
	return { root, cwd, sibling };
};

const built = (sibling: string, group = "npm"): string => {
	const pkg = join(sibling, "dist", "prod", group, "pkg");
	write(join(pkg, "index.d.ts"), "export {};\n");
	return pkg;
};

describe("packageNameOf", () => {
	it("reads the package out of a scoped or bare entry, with or without a subpath", () => {
		assert.strictEqual(packageNameOf("@x/a"), "@x/a");
		assert.strictEqual(packageNameOf("@x/a/deep/thing"), "@x/a");
		assert.strictEqual(packageNameOf("reg"), "reg");
		assert.strictEqual(packageNameOf("reg/sub"), "reg");
	});
});

describe("resolveBundledSiblings", () => {
	it("finds only the sibling: a store package and a link out of the workspace are not", async () => {
		const { cwd, sibling } = workspace();
		const pkgDir = built(sibling);
		const siblings = await resolveBundledSiblings(cwd, ["@x/a", "reg", "linked", "not-installed"]);
		assert.deepStrictEqual(siblings, [{ name: "@x/a", pkgDir, nestedExports: {} }]);
	});

	it("reads the canonical group from the sibling's targets.json", async () => {
		const { cwd, sibling } = workspace();
		const pkgDir = built(sibling, "github");
		write(
			join(sibling, "dist", "prod", "targets.json"),
			JSON.stringify({
				groups: [
					{ id: "other", name: "@elsewhere/a" },
					{ id: "github", name: "@x/a" },
				],
			}),
		);
		const [found] = await resolveBundledSiblings(cwd, ["@x/a"]);
		assert.strictEqual(found?.pkgDir, pkgDir);
	});

	it("collects a nested subpath's declaration file from the sibling's emitted manifest", async () => {
		const { cwd, sibling } = workspace();
		const pkgDir = built(sibling);
		write(
			join(pkgDir, "package.json"),
			JSON.stringify({
				exports: {
					".": { types: "./index.d.ts", import: "./index.js" },
					"./flat": { types: "./flat.d.ts", import: "./flat.js" },
					"./deep/thing": { types: "./deep-thing.d.ts", import: "./deep-thing.js" },
					"./schemas/*.json": "./schemas/*.json",
				},
			}),
		);
		const [found] = await resolveBundledSiblings(cwd, ["@x/a"]);
		assert.deepStrictEqual(found?.nestedExports, { "@x/a/deep/thing": join(pkgDir, "deep-thing.d.ts") });
	});

	it("fails naming the sibling and the turbo fix when it has not been built, for a subpath entry too", async () => {
		const { cwd } = workspace();
		for (const entry of ["@x/a", "@x/a/deep/thing"]) {
			const failure = await resolveBundledSiblings(cwd, [entry]).catch((cause: unknown) => cause);
			assert.instanceOf(failure, ConfigValidationError);
			assert.strictEqual(failure.path, "bundledPackages");
			assert.include(failure.message, "Build @x/a first");
			assert.include(failure.message, 'dependsOn: ["^build"]');
		}
	});

	it("reads nothing for an empty list, and finds nothing outside a workspace", async () => {
		assert.deepStrictEqual(await resolveBundledSiblings("/does/not/exist", []), []);
		assert.deepStrictEqual(await resolveBundledSiblings("/does/not/exist", ["@x/a"]), []);
	});
});

describe("siblingPaths", () => {
	it("maps the root, the wildcard and each nested subpath, and nothing else", () => {
		assert.deepStrictEqual(
			siblingPaths([
				{ name: "@x/a", pkgDir: "/s/pkg", nestedExports: { "@x/a/deep/thing": "/s/pkg/deep-thing.d.ts" } },
			]),
			{
				"@x/a": ["/s/pkg/index.d.ts"],
				"@x/a/*": ["/s/pkg/*.d.ts"],
				"@x/a/deep/thing": ["/s/pkg/deep-thing.d.ts"],
			},
		);
	});
});
