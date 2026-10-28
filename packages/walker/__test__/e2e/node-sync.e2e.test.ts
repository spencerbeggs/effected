// `@effected/walker/node-sync` over a real filesystem: the sync walk against
// real `node:fs`, including a real symlink loop under followSymlinks and a real
// nested-package boundary.

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { GlobPattern } from "@effected/glob";
import { Result } from "effect";
import { confineRealSync } from "../../src/ConfineReal.js";
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

describe("confineRealSync over node:fs", () => {
	const withDangling = <A>(f: (base: string, outside: string) => A): A => {
		const root = mkdtempSync(join(tmpdir(), "walker-e2e-"));
		try {
			const base = join(root, "base");
			const outside = join(root, "outside");
			mkdirSync(base);
			mkdirSync(outside);
			symlinkSync(join(outside, "pwned.txt"), join(base, "dangling"));
			symlinkSync(join(outside, "newdir"), join(base, "dangdir"));
			return f(base, outside);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	};

	// The attack the refusal closes: an accepted path through a dangling link is a
	// write that lands outside the base. Never write through a refused candidate.
	it("refuses a real dangling link, so no write lands outside the base", () => {
		withDangling((base, outside) => {
			for (const candidate of ["dangling", "dangdir/x", "dangling/../../outside/z"]) {
				const result = confineRealSync(base, candidate, nodeWalkerSyncOps);
				if (Result.isSuccess(result)) writeFileSync(result.success, "x");
				assert.isTrue(Result.isFailure(result) && result.failure.reason === "unresolvable", candidate);
			}
			assert.isFalse(existsSync(join(outside, "pwned.txt")));
		});
	});

	// The control: an absent path with no link in it is still checked lexically.
	it("accepts an absent path with no link in it, and the write lands inside", () => {
		withDangling((base) => {
			const result = confineRealSync(base, "new.txt", nodeWalkerSyncOps);
			assert.isTrue(Result.isSuccess(result));
			if (Result.isSuccess(result)) writeFileSync(result.success, "x");
			assert.isTrue(existsSync(join(base, "new.txt")));
		});
	});
});
