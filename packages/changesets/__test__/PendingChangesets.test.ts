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
	"/repo/.changeset/readme.md": "# Changesets\n",
	"/repo/.changeset/AGENTS.md": "# Agents\n",
	"/repo/.changeset/CLAUDE.md": "# Claude\n",
	"/repo/.changeset/GEMINI.md": "# Gemini\n",
	"/repo/.changeset/.gitkeep": "",
	"/repo/.changeset/config.json": "{}",
});

const Unsorted = MemoryFileSystem.layerWithPath(
	{
		"/repo/.changeset/alpha.md": change("@effected/a", "minor", "Alpha."),
		"/repo/.changeset/mid.md": change("@effected/m", "major", "Mid."),
		"/repo/.changeset/zeta.md": change("@effected/z", "patch", "Zeta."),
	},
	{ faults: { readDirectory: () => Effect.succeed(["zeta.md", "mid.md", "alpha.md"]) } },
);

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

it.effect("sorts by file name regardless of the order the directory lists", () =>
	Effect.gen(function* () {
		const pending = yield* PendingChangesets.read("/repo");
		assert.deepStrictEqual(
			pending.map((p) => p.file),
			["alpha.md", "mid.md", "zeta.md"],
		);
	}).pipe(Effect.provide(Unsorted)),
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
		writeFileSync(join(root, ".changeset", "c.md"), change("@effected/c", "patch", "C."));
		writeFileSync(join(root, ".changeset", "b.md"), change("@effected/b", "patch", "B."));
		writeFileSync(join(root, ".changeset", "a.md"), change("@effected/a", "minor", "A."));
		writeFileSync(join(root, ".changeset", "README.md"), "# readme\n");
		writeFileSync(join(root, ".changeset", ".gitkeep"), "");
		writeFileSync(join(root, ".changeset", ".hidden.md"), "not a changeset");
		writeFileSync(join(root, ".changeset", "config.json"), "{}");
		const result = PendingChangesets.readSync(root);
		assert.isTrue(Result.isSuccess(result));
		if (Result.isSuccess(result))
			assert.deepStrictEqual(
				result.success.map((p) => p.file),
				["a.md", "b.md", "c.md"],
			);

		writeFileSync(join(root, ".changeset", "d.md"), "no front matter");
		const bad = PendingChangesets.readSync(root);
		assert.isTrue(Result.isFailure(bad));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("readSync reads the same directory whatever trailing separators the root carries", async () => {
	const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const root = mkdtempSync(join(tmpdir(), "changesets-"));
	try {
		mkdirSync(join(root, ".changeset"));
		writeFileSync(join(root, ".changeset", "a.md"), change("@effected/a", "minor", "A."));
		const files = (input: string) => {
			const result = PendingChangesets.readSync(input);
			assert.isTrue(Result.isSuccess(result), `readSync(${JSON.stringify(input)}) failed`);
			return Result.isSuccess(result) ? result.success.map((p) => p.file) : [];
		};
		const bare = files(root);
		assert.deepStrictEqual(bare, ["a.md"]);
		assert.deepStrictEqual(files(`${root}/`), bare);
		assert.deepStrictEqual(files(`${root}//`), bare);
		assert.deepStrictEqual(files(`${root}\\`), bare);
		assert.deepStrictEqual(files(`${root}/\\/`), bare);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("readSync trims a long run of separators in linear time", () => {
	// A run that does not end the string is the backtracking case for a `[\\/]+$` trim.
	const root = `/r${"/".repeat(100_000)}x`;
	const started = performance.now();
	const result = PendingChangesets.readSync(root);
	const elapsed = performance.now() - started;
	// On this host the path is past the OS limit, so the read fails; a host or a trim that
	// collapsed the run would answer an empty list instead. Either is fine: what matters is
	// that the answer comes fast, and that it is an answer, not a throw.
	assert.isTrue(Result.isFailure(result) || Result.isSuccess(result));
	assert.isBelow(elapsed, 500, `readSync took ${elapsed.toFixed(0)}ms`);
});
