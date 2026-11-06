import { assert, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Result } from "effect";
import { PendingChangesets } from "../src/PendingChangesets.js";

const change = (pkg: string, bump: string, text: string): string => `---\n"${pkg}": ${bump}\n---\n\n${text}\n`;

const Populated = MemoryFileSystem.layerWithPath({
	"/repo/.changeset/zeta.md": change("@effected/z", "patch", "Zeta."),
	"/repo/.changeset/alpha.md": change("@effected/a", "minor", "Alpha."),
	"/repo/.changeset/mid.md": change("@effected/m", "major", "Mid."),
	"/repo/.changeset/README.md": "# Changesets\n",
	"/repo/.changeset/.gitkeep": "",
	"/repo/.changeset/config.json": "{}",
});

const Malformed = MemoryFileSystem.layerWithPath({
	"/repo/.changeset/good.md": change("@effected/a", "minor", "Fine."),
	"/repo/.changeset/bad.md": '---\n"@effected/a": huge\n---\n',
});

const Empty = MemoryFileSystem.layerWithPath({ "/repo/package.json": "{}" });

it.effect("reads only the changeset files, sorted by name", () =>
	Effect.gen(function* () {
		const pending = yield* PendingChangesets.read("/repo");
		assert.deepStrictEqual(
			pending.map((p) => p.file),
			["alpha.md", "mid.md", "zeta.md"],
		);
		assert.strictEqual(pending[0]?.releases.get("@effected/a"), "minor");
		assert.strictEqual(pending[0]?.summary, "Alpha.\n");
	}).pipe(Effect.provide(Populated)),
);

it.effect("a missing .changeset directory answers an empty list", () =>
	Effect.gen(function* () {
		const pending = yield* PendingChangesets.read("/repo");
		assert.deepStrictEqual(pending, []);
	}).pipe(Effect.provide(Empty)),
);

it.effect("a malformed file fails with ChangesetParseError carrying the file", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(PendingChangesets.read("/repo"));
		assert.strictEqual(error._tag, "ChangesetParseError");
		if (error._tag === "ChangesetParseError") assert.strictEqual(error.file, "bad.md");
	}).pipe(Effect.provide(Malformed)),
);

it("readSync reads real files from disk, sorted, and answers [] for a missing directory", async () => {
	const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const root = mkdtempSync(join(tmpdir(), "changesets-"));
	try {
		const missing = PendingChangesets.readSync(root);
		assert.isTrue(Result.isSuccess(missing));
		if (Result.isSuccess(missing)) assert.deepStrictEqual(missing.success, []);

		mkdirSync(join(root, ".changeset"));
		writeFileSync(join(root, ".changeset", "b.md"), change("@effected/b", "patch", "B."));
		writeFileSync(join(root, ".changeset", "a.md"), change("@effected/a", "minor", "A."));
		writeFileSync(join(root, ".changeset", "README.md"), "# readme\n");
		const result = PendingChangesets.readSync(root);
		assert.isTrue(Result.isSuccess(result));
		if (Result.isSuccess(result))
			assert.deepStrictEqual(
				result.success.map((p) => p.file),
				["a.md", "b.md"],
			);

		writeFileSync(join(root, ".changeset", "c.md"), "no front matter");
		const bad = PendingChangesets.readSync(root);
		assert.isTrue(Result.isFailure(bad));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
