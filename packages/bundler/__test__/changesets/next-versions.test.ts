// Ported from savvy-web/systems packages/tsdown-plugins/__test__/changesets/next-versions.int.test.ts on 2026-11-06
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, assert, beforeEach, describe, it } from "@effect/vitest";
import { resolveNextVersions } from "../../src/changesets/next-versions.js";

let root: string;

function pkg(dir: string, name: string, version: string, extra: Record<string, unknown> = {}): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version, ...extra }));
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "nextver-"));
	writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
	pkg(root, "root", "0.0.0", { private: true });
	pkg(join(root, "packages", "a"), "@scope/a", "1.0.0");
	pkg(join(root, "packages", "b"), "@scope/b", "2.0.0");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeChangesetConfig(): void {
	const dir = join(root, ".changeset");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "config.json"),
		JSON.stringify({ changelog: false, commit: false, access: "public", baseBranch: "main" }),
	);
}

function addChangeset(id: string, body: string): void {
	writeChangesetConfig();
	writeFileSync(join(root, ".changeset", `${id}.md`), body);
}

describe("resolveNextVersions", () => {
	it("keeps a real bump beside a changeset naming another package none", async () => {
		addChangeset("bump", '---\n"@scope/a": minor\n---\n\nminor');
		addChangeset("quiet", '---\n"@scope/b": none\n---\n\nno release');
		const result = await resolveNextVersions(join(root, "packages", "a"));
		assert.strictEqual(result.versions.get("@scope/a"), "1.1.0");
		assert.strictEqual(result.versions.get("@scope/b"), "2.0.0");
	});

	it("leaves out a version-less member even when a changeset names it", async () => {
		writeFileSync(join(root, "packages", "b", "package.json"), JSON.stringify({ name: "@scope/b" }));
		addChangeset("bump", '---\n"@scope/a": minor\n"@scope/b": major\n---\n\nboth');
		const result = await resolveNextVersions(join(root, "packages", "a"));
		assert.strictEqual(result.versions.get("@scope/a"), "1.1.0");
		assert.isFalse(result.versions.has("@scope/b"));
	});

	it("leaves a dev-dependent at its current version while its dependency bumps", async () => {
		pkg(join(root, "packages", "b"), "@scope/b", "2.0.0", { devDependencies: { "@scope/a": "workspace:*" } });
		addChangeset("bump", '---\n"@scope/a": minor\n---\n\nminor');
		const result = await resolveNextVersions(join(root, "packages", "a"));
		assert.strictEqual(result.versions.get("@scope/a"), "1.1.0");
		assert.strictEqual(result.versions.get("@scope/b"), "2.0.0");
	});

	it("excludes the root and a version-less member from the seed", async () => {
		pkg(join(root, "packages", "c"), "@scope/c", "0.0.0");
		writeFileSync(join(root, "packages", "c", "package.json"), JSON.stringify({ name: "@scope/c" }));
		writeChangesetConfig();
		const result = await resolveNextVersions(join(root, "packages", "a"));
		assert.isFalse(result.versions.has("root"));
		assert.isFalse(result.versions.has("@scope/c"));
		assert.strictEqual(realpathSync(result.root), realpathSync(root));
	});

	it("degrades to current versions in a changesets mode the planner does not model", async () => {
		addChangeset("bump", '---\n"@scope/a": major\n---\n\nbreaking');
		writeFileSync(
			join(root, ".changeset", "pre.json"),
			JSON.stringify({ mode: "pre", tag: "next", initialVersions: {}, changesets: [] }),
		);
		const pre = await resolveNextVersions(join(root, "packages", "a"));
		assert.strictEqual(pre.versions.get("@scope/a"), "1.0.0");
	});

	it("degrades to current versions for a fixed group", async () => {
		writeChangesetConfig();
		writeFileSync(
			join(root, ".changeset", "config.json"),
			JSON.stringify({
				changelog: false,
				commit: false,
				access: "public",
				baseBranch: "main",
				fixed: [["@scope/a", "@scope/b"]],
			}),
		);
		writeFileSync(join(root, ".changeset", "bump.md"), '---\n"@scope/a": major\n---\n\nbreaking');
		const fixed = await resolveNextVersions(join(root, "packages", "a"));
		assert.strictEqual(fixed.versions.get("@scope/a"), "1.0.0");
	});

	it("degrades to current versions for a changeset naming an unknown package", async () => {
		addChangeset("stray", '---\n"@scope/nope": major\n---\n\nstray');
		const result = await resolveNextVersions(join(root, "packages", "a"));
		assert.strictEqual(result.versions.get("@scope/a"), "1.0.0");
	});

	it("returns current versions for every package when config exists but no changesets are pending", async () => {
		writeChangesetConfig(); // config only, zero changeset .md files
		const result = await resolveNextVersions(join(root, "packages", "a"));
		assert.strictEqual(result.versions.get("@scope/a"), "1.0.0");
		assert.strictEqual(result.versions.get("@scope/b"), "2.0.0");
	});

	it("bumps a package that has a pending changeset", async () => {
		addChangeset("bump", '---\n"@scope/a": major\n---\n\nbreaking');
		const result = await resolveNextVersions(join(root, "packages", "a"));
		assert.strictEqual(result.versions.get("@scope/a"), "2.0.0");
		assert.strictEqual(result.versions.get("@scope/b"), "2.0.0");
	});

	it("degrades to current versions when there is no .changeset directory", async () => {
		const result = await resolveNextVersions(join(root, "packages", "a"));
		assert.strictEqual(result.versions.get("@scope/a"), "1.0.0");
	});

	it("returns an empty map when cwd is not a workspace", async () => {
		const lonely = mkdtempSync(join(tmpdir(), "lonely-"));
		writeFileSync(join(lonely, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
		const result = await resolveNextVersions(lonely);
		assert.strictEqual(result.versions.size, 0);
		assert.strictEqual(result.root, lonely);
		rmSync(lonely, { recursive: true, force: true });
	});
});
