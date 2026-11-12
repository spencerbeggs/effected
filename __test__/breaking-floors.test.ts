import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, assert, describe, it } from "vitest";
import {
	FLOOR_PREFIX,
	applyFloorEdits,
	floorEdits,
	floorFile,
	planFloors,
	renderFloorChangeset,
} from "../lib/scripts/breaking-floors.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Pkg {
	readonly version: string;
	readonly peerDependencies?: Record<string, string>;
	readonly dependencies?: Record<string, string>;
}

/** A pnpm workspace with `.changeset/` holding `changesets` (file -> releases). */
function workspace(packages: Record<string, Pkg>, changesets: Record<string, Record<string, string>>): string {
	const root = mkdtempSync(join(tmpdir(), "breaking-floors-"));
	roots.push(root);
	writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
	writeFileSync(join(root, "package.json"), JSON.stringify({ name: "root", version: "0.0.0", private: true }));
	mkdirSync(join(root, ".changeset"));
	writeFileSync(join(root, ".changeset/config.json"), JSON.stringify({ baseBranch: "main" }));
	for (const [name, pkg] of Object.entries(packages)) {
		const dir = join(root, "packages", name.replace(/^@[^/]+\//, ""));
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "package.json"), JSON.stringify({ name, ...pkg }));
	}
	for (const [file, releases] of Object.entries(changesets)) {
		const front = Object.entries(releases)
			.map(([name, type]) => `"${name}": ${type}`)
			.join("\n");
		writeFileSync(join(root, ".changeset", file), `---\n${front}\n---\n\n## Features\n\n- Change.\n`);
	}
	return root;
}

const floorFiles = (root: string): string[] =>
	readdirSync(join(root, ".changeset"))
		.filter((file) => file.startsWith(FLOOR_PREFIX))
		.sort();

/** Run the script's sync step once, as `pnpm changeset:floors` does. */
async function syncFloors(root: string): Promise<number> {
	const edits = floorEdits(root, await planFloors(root));
	applyFloorEdits(root, edits);
	return edits.length;
}

describe("breaking floors", () => {
	it("raises the #1333 shape: a patch beside its peer's breaking minor", async () => {
		const root = workspace(
			{
				"@effected/npm": { version: "0.33.0" },
				"@effected/lockfiles": { version: "0.24.0", peerDependencies: { "@effected/npm": "workspace:^" } },
			},
			{ "npm.md": { "@effected/npm": "minor" }, "lockfiles.md": { "@effected/lockfiles": "patch" } },
		);

		assert.strictEqual(await syncFloors(root), 1);

		const file = join(root, ".changeset", floorFile("@effected/lockfiles"));
		assert.strictEqual(floorFile("@effected/lockfiles"), "breaking-floor-effected-lockfiles.md");
		const text = readFileSync(file, "utf8");
		assert.match(
			text,
			/^---\n"@effected\/lockfiles": minor\n---\n\n## Breaking Changes\n\n- Requires `@effected\/npm` 0\.34\.0/,
		);
		assert.include(text, "`peerDependencies`: `^0.34.0`");
	});

	it("follows the chain until nothing crosses", async () => {
		// c only crosses once b is raised: the second pass finds it.
		const root = workspace(
			{
				a: { version: "0.1.0" },
				b: { version: "0.5.0", peerDependencies: { a: "workspace:^" } },
				c: { version: "0.9.0", peerDependencies: { b: "workspace:^" } },
				d: { version: "0.2.0" },
			},
			{ "a.md": { a: "minor" } },
		);

		await syncFloors(root);

		assert.deepStrictEqual(floorFiles(root), ["breaking-floor-b.md", "breaking-floor-c.md"]);
		assert.include(readFileSync(join(root, ".changeset/breaking-floor-c.md"), "utf8"), '"c": minor');
	});

	it("is idempotent: a second run plans past its own files and changes nothing", async () => {
		const root = workspace(
			{ a: { version: "0.1.0" }, b: { version: "0.5.0", peerDependencies: { a: "workspace:^" } } },
			{ "a.md": { a: "minor" } },
		);

		assert.strictEqual(await syncFloors(root), 1);
		assert.strictEqual(await syncFloors(root), 0);
		assert.deepStrictEqual(floorFiles(root), ["breaking-floor-b.md"]);
	});

	it("deletes a floor file whose cause is gone", async () => {
		const root = workspace(
			{ a: { version: "0.1.0" }, b: { version: "0.5.0", peerDependencies: { a: "workspace:^" } } },
			{ "a.md": { a: "minor" } },
		);
		await syncFloors(root);
		// The breaking change was dropped from the branch: a is a patch now.
		writeFileSync(join(root, ".changeset/a.md"), '---\n"a": patch\n---\n\n## Bug Fixes\n\n- Fix.\n');

		assert.strictEqual(await syncFloors(root), 1);
		assert.deepStrictEqual(floorFiles(root), []);
	});

	it("deletes a floor file naming a package the branch removed", async () => {
		const root = workspace({ a: { version: "0.1.0" } }, { "a.md": { a: "patch" } });
		// Left behind by a raise of a package that no longer exists: planning it would fail.
		writeFileSync(
			join(root, ".changeset/breaking-floor-gone.md"),
			'---\n"gone": minor\n---\n\n## Breaking Changes\n\n- Old.\n',
		);

		assert.strictEqual(await syncFloors(root), 1);
		assert.deepStrictEqual(floorFiles(root), []);
	});

	it("rewrites a hand-edited floor file back to its derived content", async () => {
		const root = workspace(
			{ a: { version: "0.1.0" }, b: { version: "0.5.0", peerDependencies: { a: "workspace:^" } } },
			{ "a.md": { a: "minor" } },
		);
		await syncFloors(root);
		const file = join(root, ".changeset/breaking-floor-b.md");
		writeFileSync(file, '---\n"b": patch\n---\n\n## Maintenance\n\n- Edited.\n');

		const edits = floorEdits(root, await planFloors(root));
		assert.deepStrictEqual(
			edits.map((edit) => edit.file),
			["breaking-floor-b.md"],
			"a check run must see the edit as drift",
		);
		applyFloorEdits(root, edits);
		assert.include(readFileSync(file, "utf8"), '"b": minor');
	});

	it("writes nothing when no release crosses a floor", async () => {
		const root = workspace(
			{ a: { version: "0.1.0" }, b: { version: "0.5.0", peerDependencies: { a: "workspace:^" } } },
			{ "a.md": { a: "patch" } },
		);
		assert.strictEqual(await syncFloors(root), 0);
		assert.isFalse(existsSync(join(root, ".changeset/breaking-floor-b.md")));
	});

	it("fails with the read's own message", async () => {
		const root = workspace({ a: { version: "0.1.0" } }, { "ghost.md": { ghost: "minor" } });
		const error = await planFloors(root).then(
			() => undefined,
			(cause: unknown) => cause,
		);
		assert.instanceOf(error, Error);
		assert.match((error as Error).message, /Release plan could not be read: .*ghost/);
	});

	it("renders one line per cause", () => {
		const text = renderFloorChangeset({
			name: "x",
			required: "minor",
			causes: [
				{ kind: "peerDependencies", dependency: "a", oldVersion: "0.1.0", newVersion: "0.2.0", range: "^0.2.0" },
				{ kind: "dependencies", dependency: "b", oldVersion: "0.3.0", newVersion: "0.4.0", range: "^0.4.0" },
			] as never,
		});
		assert.strictEqual(text.split("\n").filter((line) => line.startsWith("- ")).length, 2);
		assert.include(text, "To upgrade, move `a` to 0.2.0, `b` to 0.4.0 in the same install as this release.");
	});
});
