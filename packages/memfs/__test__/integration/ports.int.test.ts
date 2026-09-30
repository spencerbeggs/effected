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
	symlinkSync(join(host, "file.txt", "child"), join(host, "bad-link"));
	symlinkSync(join(host, "nc-b", "x"), join(host, "nc-a"));
	symlinkSync(join(host, "nc-a"), join(host, "nc-b"));
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

// String concatenation, NOT path.join: join folds `..` lexically, which would
// hide the kernel's ENOTDIR for `file.txt/..`.
const hostPath = (name: string) => `${host}/${name}`;

const cases = [
	"file.txt",
	"dir",
	"to-dir",
	"dangling",
	"loop-a",
	"file.txt/child",
	"nope",
	"bad-link",
	"to-dir/inner.txt",
	"dir/..",
	"file.txt/..",
	"nc-a",
];

const seed = {
	"/r/file.txt": "hello",
	"/r/dir/inner.txt": "x",
	"/r/to-dir": MemoryFileSystem.symlink("/r/dir"),
	"/r/dangling": MemoryFileSystem.symlink("/r/missing"),
	"/r/loop-a": MemoryFileSystem.symlink("/r/loop-b"),
	"/r/loop-b": MemoryFileSystem.symlink("/r/loop-a"),
	"/r/bad-link": MemoryFileSystem.symlink("/r/file.txt/child"),
	"/r/nc-a": MemoryFileSystem.symlink("/r/nc-b/x"),
	"/r/nc-b": MemoryFileSystem.symlink("/r/nc-a"),
};

describe("sync port parity with node:fs", () => {
	it.effect("agrees with statSync, lstatSync, readFileSync and readdirSync on every case", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith(seed);
			const sync = MemoryFileSystem.syncFileSystem(volume);
			for (const c of cases) {
				assert.deepStrictEqual(
					outcome(() => sync.stat(`/r/${c}`)),
					outcome(() => statSync(hostPath(c))),
					`stat ${c}`,
				);
				assert.deepStrictEqual(
					outcome(() => sync.lstat(`/r/${c}`)),
					outcome(() => lstatSync(hostPath(c))),
					`lstat ${c}`,
				);
				assert.deepStrictEqual(
					outcome(() => sync.readFile(`/r/${c}`)),
					outcome(() => readFileSync(hostPath(c), "utf8")),
					`readFile ${c}`,
				);
				assert.deepStrictEqual(
					outcome(() => [...sync.readDirectory(`/r/${c}`)].sort()),
					outcome(() => readdirSync(hostPath(c)).sort()),
					`readDirectory ${c}`,
				);
			}
		}),
	);

	it.effect("the promises port agrees with readdir, stat and readFile, dirents included", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith(seed);
			const fsp = MemoryFileSystem.promisesFileSystem(volume);
			const settled = (f: () => Promise<unknown>) =>
				Effect.promise(() =>
					f().then(
						(value) => ({ value }),
						(e: { code: string; syscall: string }) => ({ code: e.code, syscall: e.syscall }),
					),
				);
			const kinds = (d: { name: string; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }) => [
				d.name,
				d.isSymbolicLink() ? "symlink" : d.isDirectory() ? "directory" : d.isFile() ? "file" : "other",
			];
			const memory = yield* Effect.promise(() => fsp.readdir("/r", { withFileTypes: true }));
			const real = readdirSync(host, { withFileTypes: true });
			assert.deepStrictEqual(memory.map(kinds).sort(), real.map(kinds).sort());
			for (const c of cases) {
				const memoryStat = yield* settled(() => fsp.stat(`/r/${c}`).then((s) => s.isFile()));
				const realStat = yield* settled(() => Promise.resolve().then(() => statSync(hostPath(c)).isFile()));
				assert.deepStrictEqual(memoryStat, realStat, `promises stat ${c}`);
				const memoryDir = yield* settled(() => fsp.readdir(`/r/${c}`).then((names) => [...names].sort()));
				const realDir = yield* settled(() => Promise.resolve().then(() => readdirSync(hostPath(c)).sort()));
				assert.deepStrictEqual(memoryDir, realDir, `promises readdir ${c}`);
			}
		}),
	);
});
