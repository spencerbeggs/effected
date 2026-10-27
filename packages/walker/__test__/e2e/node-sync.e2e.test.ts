// `@effected/walker/node-sync` over a real filesystem: the sync walk against
// real `node:fs`, including a real symlink loop under followSymlinks and a real
// nested-package boundary.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { GlobPattern } from "@effected/glob";
import { Result } from "effect";
import { descendEntriesSync, descendSync } from "../../src/DescendSync.js";
import { nodeWalkerSyncOps } from "../../src/node-sync.js";

const withTree = <A>(f: (root: string) => A): A => {
	const root = mkdtempSync(join(tmpdir(), "walker-e2e-"));
	try {
		mkdirSync(join(root, "src", "lib"), { recursive: true });
		mkdirSync(join(root, "pkg", "nested"), { recursive: true });
		writeFileSync(join(root, "src", "a.ts"), "a");
		writeFileSync(join(root, "src", "lib", "b.ts"), "bb");
		writeFileSync(join(root, "pkg", "package.json"), "{}");
		writeFileSync(join(root, "pkg", "nested", "c.ts"), "");
		symlinkSync(join(root, "src"), join(root, "src", "lib", "loop"));
		return f(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
};

const all = Result.getOrThrow(GlobPattern.compileResult("**/*.ts"));

describe("descendSync over node:fs", () => {
	it("a real symlink loop terminates under followSymlinks, and is never entered by default", () => {
		withTree((root) => {
			const expected = ["pkg/nested/c.ts", "src/a.ts", "src/lib/b.ts"];
			assert.deepStrictEqual(Result.getOrThrow(descendSync(all, { cwd: root, ...nodeWalkerSyncOps })), expected);
			assert.deepStrictEqual(
				Result.getOrThrow(descendSync(all, { cwd: root, followSymlinks: true, ...nodeWalkerSyncOps })),
				expected,
			);
		});
	});

	it("boundaries stop at a real nested package; entries carry real stats", () => {
		withTree((root) => {
			const entries = Result.getOrThrow(
				descendEntriesSync(all, { cwd: root, boundaries: ["package.json"], ...nodeWalkerSyncOps }),
			);
			assert.deepStrictEqual(
				entries.map((entry) => [entry.path, entry.info.size]),
				[
					["src/a.ts", 1],
					["src/lib/b.ts", 2],
				],
			);
			assert.isAbove(entries[0]?.info.mtimeMs ?? 0, 0);
		});
	});
});
