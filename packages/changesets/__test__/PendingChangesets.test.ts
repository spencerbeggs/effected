import { assert, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, PlatformError, Result } from "effect";
import { PendingChangesets } from "../src/PendingChangesets.js";

/**
 * Milliseconds of CPU time this process has spent (`process.cpuUsage`, user plus system): time the work spent, not
 * time the process was descheduled, so a loaded machine can not stretch a sample. vitest runs each file in its own
 * fork, so no other test's CPU lands here. It under-measures async I/O, which the units here do not use.
 */
const cpuNow = (): number => {
	const used = process.cpuUsage();
	return (used.user + used.system) / 1000;
};

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
	{
		faults: {
			readDirectory: (path) =>
				path === "/repo/.changeset" ? Effect.succeed(["zeta.md", "mid.md", "alpha.md"]) : undefined,
		},
	},
);

const Malformed = MemoryFileSystem.layerWithPath({
	"/repo/.changeset/good.md": change("@effected/a", "minor", "Fine."),
	"/repo/.changeset/bad.md": '---\n"@effected/a": huge\n---\n',
});

const WithConsumed = MemoryFileSystem.layerWithPath({
	"/repo/.changeset/fresh.md": change("@effected/a", "patch", "Fresh."),
	"/repo/.changeset/pre/old.md": change("@effected/b", "minor", "Old."),
	"/repo/.changeset/pre/README.md": "# Consumed\n",
	"/repo/.changeset/pre/nested/deep.md": change("@effected/c", "major", "Deeper."),
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
		assert.strictEqual(pending[0]?.summary, "Alpha.");
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

it.effect("reads the changesets a pre-release consumed after the rest, as pre/<name>", () =>
	Effect.gen(function* () {
		const pending = yield* PendingChangesets.read("/repo");
		assert.deepStrictEqual(
			pending.map((p) => [p.file, [...p.releases.keys()]]),
			[
				["fresh.md", ["@effected/a"]],
				["pre/old.md", ["@effected/b"]],
			],
		);
	}).pipe(Effect.provide(WithConsumed)),
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

		mkdirSync(join(root, ".changeset", "pre"));
		writeFileSync(join(root, ".changeset", "pre", "old.md"), change("@effected/o", "major", "O."));
		const consumed = PendingChangesets.readSync(root);
		assert.isTrue(Result.isSuccess(consumed));
		if (Result.isSuccess(consumed))
			assert.deepStrictEqual(
				consumed.success.map((p) => p.file),
				["a.md", "b.md", "c.md", "pre/old.md"],
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
	const started = cpuNow();
	const result = PendingChangesets.readSync(root);
	const elapsed = cpuNow() - started;
	// On this host the path is past the OS limit, so the read fails; a host or a trim that
	// collapsed the run would answer an empty list instead. Either is fine: what matters is
	// that the answer comes fast, and that it is an answer, not a throw.
	assert.isTrue(Result.isFailure(result) || Result.isSuccess(result));
	assert.isBelow(elapsed, 500, `readSync took ${elapsed.toFixed(0)}ms`);
});

const denied = (method: string, path: string): PlatformError.PlatformError =>
	PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method, pathOrDescriptor: path });

const Mixed = MemoryFileSystem.layerWithPath(
	{
		"/repo/.changeset/zeta.md": change("@effected/z", "patch", "Zeta."),
		"/repo/.changeset/bad.md": '---\n"@effected/b": huge\n---\n\nnot a bump type\n',
		"/repo/.changeset/alpha.md": change("@effected/a", "minor", "Alpha."),
		"/repo/.changeset/locked.md": change("@effected/l", "patch", "Locked."),
		"/repo/.changeset/notes.txt": "not a changeset",
		"/repo/.changeset/config.json": "{",
		"/repo/.changeset/README.md": "no front matter",
		"/repo/.changeset/pre/old.md": "no front matter either",
		"/repo/.changeset/pre/kept.md": change("@effected/k", "major", "Kept."),
	},
	{
		faults: {
			readFileString: (path) =>
				path === "/repo/.changeset/locked.md" ? Effect.fail(denied("readFileString", path)) : undefined,
		},
	},
);

const AllBad = MemoryFileSystem.layerWithPath({
	"/repo/.changeset/one.md": "no front matter",
	"/repo/.changeset/two.md": '---\n"@effected/a": huge\n---\n',
});

const EmptyDir = MemoryFileSystem.layerWithPath({
	"/repo/.changeset/config.json": "{}",
	"/repo/.changeset/notes.txt": "---\nnot: yaml: here\n",
});

const Unlistable = MemoryFileSystem.layerWithPath(
	{ "/repo/.changeset/a.md": change("@effected/a", "minor", "A.") },
	{
		faults: {
			readDirectory: (path) =>
				path === "/repo/.changeset/pre" ? Effect.fail(denied("readDirectory", path)) : undefined,
		},
	},
);

it.effect("readSettled keeps the good changesets and reports each bad file with its typed error", () =>
	Effect.gen(function* () {
		const strict = yield* Effect.flip(PendingChangesets.read("/repo"));
		assert.strictEqual(strict._tag, "ChangesetParseError");

		const { changesets, failures } = yield* PendingChangesets.readSettled("/repo");
		assert.deepStrictEqual(
			changesets.map((p) => [p.file, [...p.releases.entries()]]),
			[
				["alpha.md", [["@effected/a", "minor"]]],
				["zeta.md", [["@effected/z", "patch"]]],
				["pre/kept.md", [["@effected/k", "major"]]],
			],
		);
		assert.deepStrictEqual(
			failures.map((f) => [f.file, f.error._tag]),
			[
				["bad.md", "ChangesetParseError"],
				["locked.md", "PlatformError"],
				["pre/old.md", "ChangesetParseError"],
			],
		);
		const [bad, locked, old] = failures;
		assert.isTrue(bad?.error._tag === "ChangesetParseError" && bad.error.file === "bad.md");
		assert.isTrue(locked?.error._tag === "PlatformError" && locked.error.reason._tag === "PermissionDenied");
		assert.isTrue(old?.error._tag === "ChangesetParseError" && old.error.file === "pre/old.md");
	}).pipe(Effect.provide(Mixed)),
);

it.effect("readSettled reports every file when none parses", () =>
	Effect.gen(function* () {
		const { changesets, failures } = yield* PendingChangesets.readSettled("/repo");
		assert.deepStrictEqual(changesets, []);
		assert.deepStrictEqual(
			failures.map((f) => [f.file, f.error._tag]),
			[
				["one.md", "ChangesetParseError"],
				["two.md", "ChangesetParseError"],
			],
		);
	}).pipe(Effect.provide(AllBad)),
);

it.effect("readSettled answers nothing for a directory holding no changesets, ignoring non-.md files", () =>
	Effect.gen(function* () {
		assert.deepStrictEqual(yield* PendingChangesets.read("/repo"), []);
		assert.deepStrictEqual(yield* PendingChangesets.readSettled("/repo"), { changesets: [], failures: [] });
	}).pipe(Effect.provide(EmptyDir)),
);

it.effect("readSettled answers nothing for a missing .changeset directory", () =>
	Effect.gen(function* () {
		assert.deepStrictEqual(yield* PendingChangesets.readSettled("/repo"), { changesets: [], failures: [] });
	}).pipe(Effect.provide(Empty)),
);

it.effect("readSettled still fails the whole read when a directory cannot be listed", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(PendingChangesets.readSettled("/repo"));
		assert.strictEqual(error._tag, "PlatformError");
		assert.strictEqual(error.reason._tag, "PermissionDenied");
	}).pipe(Effect.provide(Unlistable)),
);

it.effect("readSettled orders its answer by file name regardless of the order the directory lists", () =>
	Effect.gen(function* () {
		const { changesets } = yield* PendingChangesets.readSettled("/repo");
		assert.deepStrictEqual(
			changesets.map((p) => p.file),
			["alpha.md", "mid.md", "zeta.md"],
		);
	}).pipe(Effect.provide(Unsorted)),
);

it("readSettledSync skips a bad file on disk and reports it, where readSync fails", async () => {
	const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const root = mkdtempSync(join(tmpdir(), "changesets-"));
	try {
		const missing = PendingChangesets.readSettledSync(root);
		assert.isTrue(Result.isSuccess(missing));
		if (Result.isSuccess(missing)) assert.deepStrictEqual(missing.success, { changesets: [], failures: [] });

		mkdirSync(join(root, ".changeset", "pre"), { recursive: true });
		writeFileSync(join(root, ".changeset", "good.md"), change("alpha", "minor", "ok"));
		writeFileSync(join(root, ".changeset", "bad.md"), '---\n"beta": huge\n---\n\nnot a bump type\n');
		writeFileSync(join(root, ".changeset", "notes.txt"), "ignored");
		writeFileSync(join(root, ".changeset", "pre", "old.md"), change("gamma", "patch", "old"));
		mkdirSync(join(root, ".changeset", "dir.md"));

		assert.isTrue(Result.isFailure(PendingChangesets.readSync(root)));
		const settled = PendingChangesets.readSettledSync(`${root}/`);
		assert.isTrue(Result.isSuccess(settled));
		if (Result.isSuccess(settled)) {
			assert.deepStrictEqual(
				settled.success.changesets.map((p) => [p.file, [...p.releases.entries()]]),
				[
					["good.md", [["alpha", "minor"]]],
					["pre/old.md", [["gamma", "patch"]]],
				],
			);
			assert.deepStrictEqual(
				settled.success.failures.map((f) => [f.file, f.error._tag]),
				[
					["bad.md", "ChangesetParseError"],
					["dir.md", "PlatformError"],
				],
			);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
