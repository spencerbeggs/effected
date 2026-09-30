// Differential oracle for the sync port: the same tree on a real tmpdir and in
// memfs, compared call for call. node is the reference; if they disagree the
// port is wrong, never the expectation.
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { MemoryFileSystem } from "../../src/index.js";

let host: string;
beforeAll(() => {
	host = mkdtempSync(join(tmpdir(), "memfs-ports-"));
	writeFileSync(join(host, "file.txt"), "hello");
	mkdirSync(join(host, "dir"));
	writeFileSync(join(host, "dir", "inner.txt"), "x");
	symlinkSync(join(host, "dir"), join(host, "to-dir"));
	symlinkSync(join(host, "missing"), join(host, "dangling"));
	symlinkSync(join(host, "loop-b"), join(host, "loop-a"));
	symlinkSync(join(host, "loop-a"), join(host, "loop-b"));
});
afterAll(() => rmSync(host, { recursive: true, force: true }));

interface StatLike {
	isFile(): boolean;
	isDirectory(): boolean;
	isSymbolicLink(): boolean;
	size: number;
}

// `size` is compared for files only: a directory's size is host-defined.
const outcome = (f: () => unknown) => {
	try {
		const value = f();
		if (typeof value === "object" && value !== null && "isSymbolicLink" in value) {
			const s = value as StatLike;
			return {
				kind: s.isSymbolicLink() ? "symlink" : s.isDirectory() ? "directory" : "file",
				size: s.isFile() ? s.size : -1,
			};
		}
		return { value };
	} catch (e) {
		const error = e as { code: string; syscall: string };
		return { code: error.code, syscall: error.syscall };
	}
};

const cases = ["file.txt", "dir", "to-dir", "dangling", "loop-a", "file.txt/child", "nope"];

describe("sync port parity with node:fs", () => {
	it.effect("agrees with statSync, lstatSync, readFileSync and readdirSync on every case", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith({
				"/r/file.txt": "hello",
				"/r/dir/inner.txt": "x",
				"/r/to-dir": MemoryFileSystem.symlink("/r/dir"),
				"/r/dangling": MemoryFileSystem.symlink("/r/missing"),
				"/r/loop-a": MemoryFileSystem.symlink("/r/loop-b"),
				"/r/loop-b": MemoryFileSystem.symlink("/r/loop-a"),
			});
			const sync = MemoryFileSystem.syncFileSystem(volume);
			for (const c of cases) {
				assert.deepStrictEqual(
					outcome(() => sync.stat(`/r/${c}`)),
					outcome(() => statSync(join(host, c))),
					`stat ${c}`,
				);
				assert.deepStrictEqual(
					outcome(() => sync.lstat(`/r/${c}`)),
					outcome(() => lstatSync(join(host, c))),
					`lstat ${c}`,
				);
				assert.deepStrictEqual(
					outcome(() => sync.readFile(`/r/${c}`)),
					outcome(() => readFileSync(join(host, c), "utf8")),
					`readFile ${c}`,
				);
				assert.deepStrictEqual(
					outcome(() => [...sync.readDirectory(`/r/${c}`)].sort()),
					outcome(() => readdirSync(join(host, c)).sort()),
					`readDirectory ${c}`,
				);
			}
		}),
	);
});
