// Kit-owned extension of the differential oracle (the vendored contract suite in
// FileSystemContract.ts is upstream's and stays unedited). It pins the error
// SHAPE of every failure the audit found memfs and the node adapter disagreeing
// on — the `_tag`, the `method`, and the errno `code` on `reason.cause` — and
// runs unchanged against BOTH MemoryFileSystem.layer and @effect/platform-node's
// real filesystem. A case listed here is exercised on both; nothing in this file
// is a disclaimer.
//
// Expectations come in three shapes:
// - one outcome: both implementations, on every platform, agree on it;
// - `{ linux, darwin }`: the real platform disagrees with itself. memfs models
//   the Linux errno, and the node run asserts whichever platform it is on;
// - `{ memory, node }`: a KNOWN divergence memfs deliberately keeps. Both sides
//   are still asserted, so a change on either side fails here and forces the
//   decision to be revisited. The node side may itself be `{ linux, darwin }`.
//
// It also pins the BEHAVIOUR of `FileSystem` options the pinned upstream engine
// predates (`open` noFollow, positional `read`/`readAlloc`): a success case
// carries a `check`, so a silently ignored option fails here on the memfs run.
//
// `pathOrDescriptor` is deliberately not asserted: node's adapter reports the
// FIRST path argument of a two-path operation (rename, copy, copyFile, link,
// symlink), memfs the one the conflict concerns.

import { assert, describe, layer } from "@effect/vitest";
import type { Layer, Scope } from "effect";
import { Cause, Effect, Exit, Option, Result, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import type * as PlatformError from "effect/PlatformError";

type Implementation = "memory" | "node";

interface Failure {
	readonly tag: PlatformError.SystemErrorTag | "BadArgument";
	readonly method: string;
	/** The errno `code` expected on `reason.cause`; absent for a BadArgument. */
	readonly code?: string;
}

type Outcome = "success" | Failure;

interface PerPlatform {
	readonly linux: Outcome;
	readonly darwin: Outcome;
}

type Expectation = Outcome | PerPlatform | { readonly memory: Outcome; readonly node: Outcome | PerPlatform };

interface Case {
	readonly name: string;
	readonly run: (
		fs: FileSystem.FileSystem,
		path: (...segments: ReadonlyArray<string>) => string,
	) => Effect.Effect<unknown, PlatformError.PlatformError, Scope.Scope>;
	readonly expect: Expectation;
	/** An extra assertion on the success value, when the value is the point. */
	readonly check?: (
		value: unknown,
		fs: FileSystem.FileSystem,
		path: (...segments: ReadonlyArray<string>) => string,
	) => Effect.Effect<void, PlatformError.PlatformError>;
	/** An assertion on the tree after `run`, whichever way it exited: a failure that changed nothing. */
	readonly afterward?: (
		fs: FileSystem.FileSystem,
		path: (...segments: ReadonlyArray<string>) => string,
	) => Effect.Effect<void, PlatformError.PlatformError>;
}

const fail = (tag: Failure["tag"], method: string, code?: string): Failure =>
	code === undefined ? { tag, method } : { tag, method, code };

const resolveExpectation = (expectation: Expectation, implementation: Implementation): Outcome => {
	if (expectation === "success" || "tag" in expectation) return expectation;
	if ("memory" in expectation) {
		return implementation === "memory" ? expectation.memory : resolveExpectation(expectation.node, "node");
	}
	// memfs models Linux; the node run asserts the platform it runs on.
	if (implementation === "memory" || process.platform === "linux") return expectation.linux;
	if (process.platform === "darwin") return expectation.darwin;
	throw new Error(`no errno expectation for platform ${process.platform}`);
};

const bytes = new Uint8Array([1, 2, 3, 4]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const withHandle = (
	fs: FileSystem.FileSystem,
	file: string,
	flag: FileSystem.OpenFlag,
	use: (handle: FileSystem.File) => Effect.Effect<unknown, PlatformError.PlatformError>,
) => Effect.flatMap(fs.open(file, { flag }), use);

// A handle whose scope has already closed: every operation on it is EBADF.
const closedHandle = (fs: FileSystem.FileSystem, file: string) => Effect.scoped(fs.open(file, { flag: "r" }));

const cases: ReadonlyArray<Case> = [
	// readLink on an entry that is not a symbolic link: EINVAL, which node maps to Unknown.
	{
		name: "readLink on a regular file",
		run: (fs, p) => fs.readLink(p("file")),
		expect: fail("Unknown", "readLink", "EINVAL"),
	},
	{
		name: "readLink on a directory",
		run: (fs, p) => fs.readLink(p("dir")),
		expect: fail("Unknown", "readLink", "EINVAL"),
	},
	{
		name: "readLink on a missing path",
		run: (fs, p) => fs.readLink(p("missing")),
		expect: fail("NotFound", "readLink", "ENOENT"),
	},
	{
		name: "readLink through a symlink loop",
		run: (fs, p) => fs.readLink(p("loop1", "x")),
		expect: fail("BadResource", "readLink", "ELOOP"),
	},

	// remove: fs.rm refuses every directory without `recursive`.
	{
		name: "remove a non-empty directory without recursive",
		run: (fs, p) => fs.remove(p("full")),
		expect: fail("Unknown", "remove", "ERR_FS_EISDIR"),
	},
	{
		name: "remove an empty directory without recursive",
		run: (fs, p) => fs.remove(p("empty")),
		expect: fail("Unknown", "remove", "ERR_FS_EISDIR"),
	},
	{
		name: "remove an empty directory with force but without recursive",
		run: (fs, p) => fs.remove(p("empty"), { force: true }),
		expect: fail("Unknown", "remove", "ERR_FS_EISDIR"),
	},
	{
		name: "remove an empty directory named with a trailing slash",
		run: (fs, p) => fs.remove(`${p("empty")}/`),
		expect: fail("Unknown", "remove", "ERR_FS_EISDIR"),
	},
	{
		name: "remove a directory named with a trailing slash recursively",
		run: (fs, p) => fs.remove(`${p("full")}/`, { recursive: true }),
		expect: "success",
		check: (_, fs, p) => Effect.map(fs.exists(p("full")), (exists) => assert.isFalse(exists)),
	},
	{
		name: "remove a file named with a trailing slash",
		run: (fs, p) => fs.remove(`${p("file")}/`),
		expect: fail("BadResource", "remove", "ENOTDIR"),
	},

	// makeDirectory: a non-directory earlier in the path is ENOTDIR; as the final component, EEXIST.
	{
		name: "makeDirectory beneath a file",
		run: (fs, p) => fs.makeDirectory(p("file", "child")),
		expect: fail("BadResource", "makeDirectory", "ENOTDIR"),
	},
	{
		name: "makeDirectory recursively beneath a file",
		run: (fs, p) => fs.makeDirectory(p("file", "child", "grandchild"), { recursive: true }),
		expect: fail("BadResource", "makeDirectory", "ENOTDIR"),
	},
	{
		name: "makeDirectory onto a file",
		run: (fs, p) => fs.makeDirectory(p("file")),
		expect: fail("AlreadyExists", "makeDirectory", "EEXIST"),
	},
	{
		name: "makeDirectory of the root",
		run: (fs) => fs.makeDirectory("/"),
		expect: fail("AlreadyExists", "makeDirectory", "EEXIST"),
	},
	{
		name: "makeDirectory of the root recursively",
		run: (fs) => fs.makeDirectory("/", { recursive: true }),
		expect: "success",
	},

	// makeDirectory through symbolic links (#891). The recursive walk follows a
	// link component: a dangling one is ENOENT as the final component and — the
	// node adapter's callback `fs.mkdir`, not `mkdirSync`, which says ENOENT —
	// ENOTDIR earlier in the path; a loop is ELOOP either way. Without
	// `recursive`, a link as the final component is simply an existing entry.
	{
		name: "makeDirectory recursively onto a dangling symlink",
		run: (fs, p) => fs.makeDirectory(p("dangling"), { recursive: true }),
		expect: fail("NotFound", "makeDirectory", "ENOENT"),
	},
	{
		name: "makeDirectory recursively beneath a dangling symlink",
		run: (fs, p) => fs.makeDirectory(p("dangling", "a", "b"), { recursive: true }),
		expect: fail("BadResource", "makeDirectory", "ENOTDIR"),
	},
	{
		name: "makeDirectory recursively onto a dangling symlink named with a trailing slash",
		run: (fs, p) => fs.makeDirectory(`${p("dangling")}/`, { recursive: true }),
		expect: { linux: fail("NotFound", "makeDirectory", "ENOENT"), darwin: "success" },
	},
	{
		name: "makeDirectory onto a dangling symlink",
		run: (fs, p) => fs.makeDirectory(p("dangling")),
		expect: fail("AlreadyExists", "makeDirectory", "EEXIST"),
	},
	{
		name: "makeDirectory beneath a dangling symlink",
		run: (fs, p) => fs.makeDirectory(p("dangling", "a")),
		expect: fail("NotFound", "makeDirectory", "ENOENT"),
	},
	{
		name: "makeDirectory recursively onto a symlink loop",
		run: (fs, p) => fs.makeDirectory(p("loop1"), { recursive: true }),
		expect: fail("BadResource", "makeDirectory", "ELOOP"),
	},
	{
		name: "makeDirectory recursively beneath a symlink loop",
		run: (fs, p) => fs.makeDirectory(p("loop1", "a", "b"), { recursive: true }),
		expect: fail("BadResource", "makeDirectory", "ELOOP"),
	},
	{
		name: "makeDirectory onto a symlink loop",
		run: (fs, p) => fs.makeDirectory(p("loop1")),
		expect: fail("AlreadyExists", "makeDirectory", "EEXIST"),
	},
	{
		name: "makeDirectory recursively onto a file",
		run: (fs, p) => fs.makeDirectory(p("file"), { recursive: true }),
		expect: fail("AlreadyExists", "makeDirectory", "EEXIST"),
	},
	{
		name: "makeDirectory recursively onto a symlink to a file",
		run: (fs, p) => fs.makeDirectory(p("filesym"), { recursive: true }),
		expect: fail("AlreadyExists", "makeDirectory", "EEXIST"),
	},
	{
		name: "makeDirectory recursively beneath a symlink to a file",
		run: (fs, p) => fs.makeDirectory(p("filesym", "a", "b"), { recursive: true }),
		expect: fail("BadResource", "makeDirectory", "ENOTDIR"),
	},
	{
		name: "makeDirectory recursively onto a symlink to a directory",
		run: (fs, p) => fs.makeDirectory(p("dirsym"), { recursive: true }),
		expect: "success",
	},
	{
		name: "makeDirectory recursively beneath a symlink to a directory",
		run: (fs, p) => fs.makeDirectory(p("dirsym", "a", "b"), { recursive: true }),
		expect: "success",
		check: (_, fs, p) => Effect.map(fs.exists(p("dir", "a", "b")), (exists) => assert.isTrue(exists)),
	},

	// rename
	{
		name: "rename a directory into itself",
		run: (fs, p) => fs.rename(p("dir"), p("dir", "sub")),
		expect: fail("Unknown", "rename", "EINVAL"),
	},
	{
		name: "rename a directory over a file",
		run: (fs, p) => fs.rename(p("dir"), p("file")),
		expect: fail("BadResource", "rename", "ENOTDIR"),
	},
	{
		name: "rename a file over a directory",
		run: (fs, p) => fs.rename(p("file"), p("dir")),
		expect: fail("BadResource", "rename", "EISDIR"),
	},
	{
		name: "rename a directory over a non-empty directory",
		run: (fs, p) => fs.rename(p("dir"), p("full")),
		expect: fail("Unknown", "rename", "ENOTEMPTY"),
	},
	{
		name: "rename a file beneath a file",
		run: (fs, p) => fs.rename(p("file"), p("file2", "x")),
		expect: fail("BadResource", "rename", "ENOTDIR"),
	},
	{
		name: "rename a directory named with a trailing slash",
		run: (fs, p) => fs.rename(`${p("dir")}/`, p("moved")),
		expect: "success",
	},
	{
		name: "rename a directory onto a new trailing-slash path",
		run: (fs, p) => fs.rename(p("dir"), `${p("moved")}/`),
		expect: "success",
	},
	{
		name: "rename a file named with a trailing slash",
		run: (fs, p) => fs.rename(`${p("file")}/`, p("moved")),
		expect: fail("BadResource", "rename", "ENOTDIR"),
	},
	{
		name: "rename a file onto a new trailing-slash path",
		run: (fs, p) => fs.rename(p("file"), `${p("moved")}/`),
		expect: { linux: fail("BadResource", "rename", "ENOTDIR"), darwin: fail("NotFound", "rename", "ENOENT") },
	},

	// copyFile
	{
		name: "copyFile from a directory",
		run: (fs, p) => fs.copyFile(p("dir"), p("out")),
		expect: { linux: fail("BadResource", "copyFile", "EISDIR"), darwin: fail("Unknown", "copyFile", "ENOTSUP") },
	},
	{
		name: "copyFile onto a directory",
		run: (fs, p) => fs.copyFile(p("file"), p("dir")),
		expect: fail("BadResource", "copyFile", "EISDIR"),
	},
	{
		name: "copyFile onto a new trailing-slash path",
		run: (fs, p) => fs.copyFile(p("file"), `${p("out")}/`),
		expect: { linux: fail("BadResource", "copyFile", "EISDIR"), darwin: fail("NotFound", "copyFile", "ENOENT") },
	},

	// copy (fs.cp): same-entry and kind mismatches fail before `overwrite` is consulted.
	{
		name: "copy a directory into itself",
		run: (fs, p) => fs.copy(p("full"), p("full", "sub")),
		expect: fail("Unknown", "copy", "ERR_FS_CP_EINVAL"),
	},
	{
		name: "copy a directory onto itself",
		run: (fs, p) => fs.copy(p("full"), p("full"), { overwrite: true }),
		expect: fail("Unknown", "copy", "ERR_FS_CP_EINVAL"),
	},
	{
		name: "copy a file onto itself",
		run: (fs, p) => fs.copy(p("file"), p("file")),
		expect: fail("Unknown", "copy", "ERR_FS_CP_EINVAL"),
	},
	{
		name: "copy a file onto its own hard link",
		run: (fs, p) =>
			Effect.andThen(fs.link(p("file"), p("hardlink")), fs.copy(p("file"), p("hardlink"), { overwrite: true })),
		expect: fail("Unknown", "copy", "ERR_FS_CP_EINVAL"),
	},
	{
		name: "copy a directory onto a file",
		run: (fs, p) => fs.copy(p("full"), p("file")),
		expect: fail("Unknown", "copy", "ERR_FS_CP_DIR_TO_NON_DIR"),
	},
	{
		name: "copy a directory onto a file with overwrite",
		run: (fs, p) => fs.copy(p("full"), p("file"), { overwrite: true }),
		expect: fail("Unknown", "copy", "ERR_FS_CP_DIR_TO_NON_DIR"),
	},
	{
		name: "copy a file onto a directory",
		run: (fs, p) => fs.copy(p("file"), p("dir")),
		expect: fail("Unknown", "copy", "ERR_FS_CP_NON_DIR_TO_DIR"),
	},
	{
		name: "copy a file onto a directory with overwrite",
		run: (fs, p) => fs.copy(p("file"), p("dir"), { overwrite: true }),
		expect: fail("Unknown", "copy", "ERR_FS_CP_NON_DIR_TO_DIR"),
	},
	{
		name: "copy a tree whose file lands on a nested directory",
		run: (fs, p) =>
			Effect.andThen(
				fs.makeDirectory(p("shadow", "a"), { recursive: true }),
				fs.copy(p("full"), p("shadow"), { overwrite: true }),
			),
		expect: fail("Unknown", "copy", "ERR_FS_CP_NON_DIR_TO_DIR"),
	},
	{
		name: "copy a tree whose directory lands on a nested file",
		run: (fs, p) =>
			Effect.andThen(
				fs.makeDirectory(p("shadow", "a"), { recursive: true }),
				fs.copy(p("shadow"), p("full"), { overwrite: true }),
			),
		expect: fail("Unknown", "copy", "ERR_FS_CP_DIR_TO_NON_DIR"),
	},
	{
		name: "copy a tree with a nested kind mismatch without overwrite",
		run: (fs, p) =>
			Effect.andThen(fs.makeDirectory(p("shadow", "a"), { recursive: true }), fs.copy(p("full"), p("shadow"))),
		expect: fail("Unknown", "copy", "ERR_FS_CP_NON_DIR_TO_DIR"),
	},
	// Known divergence: without `overwrite`, fs.cp silently keeps an existing
	// destination (and merges into an existing directory); memfs fails EEXIST.
	{
		name: "copy a file onto an existing file without overwrite",
		run: (fs, p) => fs.copy(p("file"), p("file2")),
		expect: { memory: fail("AlreadyExists", "copy", "EEXIST"), node: "success" },
	},
	{
		name: "copy a directory onto an existing directory without overwrite",
		run: (fs, p) => fs.copy(p("full"), p("full2")),
		expect: { memory: fail("AlreadyExists", "copy", "EEXIST"), node: "success" },
	},
	// Known divergence: fs.cp creates missing destination parents; memfs does not.
	{
		name: "copy into a missing parent directory",
		run: (fs, p) => fs.copy(p("file"), p("missing", "out")),
		expect: { memory: fail("NotFound", "copy", "ENOENT"), node: "success" },
	},
	// copy onto a `.` or `..` leaf (#1339). fs.cp stats the destination, so
	// `dir/.` IS `dir` and `dir/..` the directory holding it: a file source is a
	// kind mismatch whatever `overwrite` says, and a directory source merges.
	{
		name: "copy a file onto dir/.",
		run: (fs, p) => fs.copy(p("file"), p("dir", ".")),
		expect: fail("Unknown", "copy", "ERR_FS_CP_NON_DIR_TO_DIR"),
	},
	{
		name: "copy a file onto dir/. with overwrite",
		run: (fs, p) => fs.copy(p("file"), p("dir", "."), { overwrite: true }),
		expect: fail("Unknown", "copy", "ERR_FS_CP_NON_DIR_TO_DIR"),
	},
	{
		name: "copy a file onto dir/..",
		run: (fs, p) => fs.copy(p("file"), p("dir", ".."), { overwrite: true }),
		expect: fail("Unknown", "copy", "ERR_FS_CP_NON_DIR_TO_DIR"),
	},
	{
		name: "copy a directory onto dir/. with overwrite merges into dir",
		run: (fs, p) => fs.copy(p("full"), p("dir", "."), { overwrite: true }),
		expect: "success",
		check: (_, fs, p) => Effect.map(fs.readFileString(p("dir", "a")), (text) => assert.strictEqual(text, "a")),
	},
	{
		name: "copy a directory onto dirsym/. with overwrite merges into the link's target",
		run: (fs, p) => fs.copy(p("full"), p("dirsym", "."), { overwrite: true }),
		expect: "success",
		check: (_, fs, p) => Effect.map(fs.readFileString(p("dir", "a")), (text) => assert.strictEqual(text, "a")),
	},
	{
		name: "copy a directory onto dir/.. with overwrite merges into the directory holding dir",
		run: (fs, p) => fs.copy(p("full"), p("dir", ".."), { overwrite: true }),
		expect: "success",
		check: (_, fs, p) => Effect.map(fs.readFileString(p("a")), (text) => assert.strictEqual(text, "a")),
	},
	// Known divergence, as for any existing directory: without `overwrite`,
	// fs.cp merges into `dir/.`; memfs fails EEXIST.
	{
		name: "copy a directory onto dir/. without overwrite",
		run: (fs, p) => fs.copy(p("full"), p("dir", ".")),
		expect: { memory: fail("AlreadyExists", "copy", "EEXIST"), node: "success" },
	},
	{
		name: "copy a directory onto its own full/.",
		run: (fs, p) => fs.copy(p("full"), p("full", "."), { overwrite: true }),
		expect: fail("Unknown", "copy", "ERR_FS_CP_EINVAL"),
	},
	// fs.cp walks the destination's LEXICAL parents for the source (`dirname`
	// of `dir/..` is `dir`), so copying a directory onto its own `..` is a
	// copy into itself even though the destination is its parent.
	{
		name: "copy a directory onto its own dir/..",
		run: (fs, p) => fs.copy(p("dir"), p("dir", ".."), { overwrite: true }),
		expect: fail("Unknown", "copy", "ERR_FS_CP_EINVAL"),
	},
	{
		name: "copy a file onto file/.",
		run: (fs, p) => fs.copy(p("file2"), p("file", ".")),
		expect: fail("BadResource", "copy", "ENOTDIR"),
	},
	// Known divergence: fs.cp creates the missing `missing` (its mkdir of the
	// destination's dirname), then fails on the leaf with EISDIR for a file and
	// EEXIST for a directory, leaving `missing` behind; memfs creates no parent
	// (as for any missing parent above) and fails ENOENT.
	{
		name: "copy a file onto missing/.",
		run: (fs, p) => fs.copy(p("file"), p("missing", ".")),
		expect: { memory: fail("NotFound", "copy", "ENOENT"), node: fail("BadResource", "copy", "EISDIR") },
	},
	{
		name: "copy a directory onto missing/.",
		run: (fs, p) => fs.copy(p("full"), p("missing", ".")),
		expect: { memory: fail("NotFound", "copy", "ENOENT"), node: fail("AlreadyExists", "copy", "EEXIST") },
	},

	// open, and the file handles it returns
	{
		name: "open a directory for writing",
		run: (fs, p) => fs.open(p("dir"), { flag: "w" }),
		expect: fail("BadResource", "open", "EISDIR"),
	},
	// Known divergence: node opens a directory read-only and fails on the first
	// read; memfs refuses at open. The tag and code agree, the method does not.
	{
		name: "open a directory for reading",
		run: (fs, p) => fs.open(p("dir"), { flag: "r" }),
		expect: { memory: fail("BadResource", "open", "EISDIR"), node: "success" },
	},
	{
		name: "stream a directory",
		run: (fs, p) => Stream.runDrain(fs.stream(p("dir"))),
		expect: { memory: fail("BadResource", "open", "EISDIR"), node: fail("BadResource", "readAlloc", "EISDIR") },
	},
	{
		name: "read from a write-only handle",
		run: (fs, p) => withHandle(fs, p("file"), "w", (h) => h.read(new Uint8Array(4))),
		expect: fail("Unknown", "read", "EBADF"),
	},
	{
		name: "readAlloc from a write-only handle",
		run: (fs, p) => withHandle(fs, p("file"), "w", (h) => h.readAlloc(4)),
		expect: fail("Unknown", "readAlloc", "EBADF"),
	},
	{
		name: "write to a read-only handle",
		run: (fs, p) => withHandle(fs, p("file"), "r", (h) => h.write(bytes)),
		expect: fail("Unknown", "write", "EBADF"),
	},
	{
		name: "writeAll to a read-only handle",
		run: (fs, p) => withHandle(fs, p("file"), "r", (h) => h.writeAll(bytes)),
		expect: fail("Unknown", "writeAll", "EBADF"),
	},
	{
		name: "truncate a read-only handle",
		run: (fs, p) => withHandle(fs, p("file"), "r", (h) => h.truncate(0)),
		expect: fail("Unknown", "truncate", "EINVAL"),
	},
	{
		name: "read from a closed handle",
		run: (fs, p) => Effect.flatMap(closedHandle(fs, p("file")), (h) => h.read(new Uint8Array(4))),
		expect: fail("Unknown", "read", "EBADF"),
	},
	{
		name: "stat a closed handle",
		run: (fs, p) => Effect.flatMap(closedHandle(fs, p("file")), (h) => h.stat),
		expect: fail("Unknown", "stat", "EBADF"),
	},

	// open with noFollow: O_NOFOLLOW refuses a symbolic link as the FINAL path
	// component with ELOOP (dangling or not, with or without O_CREAT), while a
	// link earlier in the path is still followed. O_EXCL is checked first, so an
	// exclusive create onto a link is EEXIST as it would be without noFollow.
	{
		name: "open with noFollow a symlink to a file",
		run: (fs, p) => fs.open(p("filesym"), { noFollow: true }),
		expect: fail("BadResource", "open", "ELOOP"),
	},
	{
		name: "open with noFollow a dangling symlink",
		run: (fs, p) => fs.open(p("dangling"), { noFollow: true }),
		expect: fail("BadResource", "open", "ELOOP"),
	},
	{
		name: "open with noFollow a symlink to a directory",
		run: (fs, p) => fs.open(p("dirsym"), { noFollow: true }),
		expect: fail("BadResource", "open", "ELOOP"),
	},
	{
		name: "open with noFollow a symlink to a file for writing",
		run: (fs, p) => fs.open(p("filesym"), { flag: "w", noFollow: true }),
		expect: fail("BadResource", "open", "ELOOP"),
		check: (_, fs, p) => Effect.map(fs.readFileString(p("file")), (text) => assert.strictEqual(text, "x")),
	},
	{
		name: "open with noFollow a dangling symlink for appending",
		run: (fs, p) => fs.open(p("dangling"), { flag: "a", noFollow: true }),
		expect: fail("BadResource", "open", "ELOOP"),
	},
	{
		name: "open with noFollow a symlink for exclusive creation",
		run: (fs, p) => fs.open(p("filesym"), { flag: "wx", noFollow: true }),
		expect: fail("AlreadyExists", "open", "EEXIST"),
	},
	{
		name: "open with noFollow a regular file",
		run: (fs, p) => Effect.flatMap(fs.open(p("file"), { noFollow: true }), (h) => h.readAlloc(4)),
		expect: "success",
		check: (value) => Effect.sync(() => assert.deepStrictEqual(value, Option.some(encoder.encode("x")))),
	},
	{
		name: "open with noFollow a file beneath a symlinked directory",
		run: (fs, p) =>
			Effect.andThen(fs.writeFileString(p("dir", "f"), "f"), fs.open(p("dirsym", "f"), { noFollow: true })),
		expect: "success",
	},
	{
		name: "open with noFollow creates a missing file",
		run: (fs, p) => fs.open(p("created"), { flag: "w", noFollow: true }),
		expect: "success",
		check: (_, fs, p) => Effect.map(fs.exists(p("created")), (exists) => assert.isTrue(exists)),
	},

	// read/readAlloc with a position: the read happens at the given offset and
	// the handle's cursor is left where it was; at or past EOF nothing is read.
	{
		name: "read and readAlloc at a position leave the cursor unchanged",
		run: (fs, p) =>
			Effect.andThen(
				fs.writeFileString(p("digits"), "0123456789"),
				withHandle(fs, p("digits"), "r", (h) =>
					Effect.gen(function* () {
						yield* h.seek(BigInt(2), "start");
						const buffer = new Uint8Array(3);
						const positional = yield* h.read(buffer, { position: BigInt(6) });
						const cursorRead = yield* h.readAlloc(2);
						const positionalAlloc = yield* h.readAlloc(3, { position: BigInt(8) });
						const atEof = yield* h.read(new Uint8Array(2), { position: BigInt(10) });
						const pastEof = yield* h.readAlloc(2, { position: BigInt(11) });
						const cursor = yield* h.seek(BigInt(0), "current");
						const rest = yield* h.readAlloc(16);
						return {
							positional,
							buffer: decoder.decode(buffer),
							cursorRead: Option.map(cursorRead, (b) => decoder.decode(b)),
							positionalAlloc: Option.map(positionalAlloc, (b) => decoder.decode(b)),
							atEof,
							pastEof,
							cursor,
							rest: Option.map(rest, (b) => decoder.decode(b)),
						};
					}),
				),
			),
		expect: "success",
		check: (value) =>
			Effect.sync(() =>
				assert.deepStrictEqual(value, {
					positional: 3,
					buffer: "678",
					cursorRead: Option.some("23"),
					positionalAlloc: Option.some("89"),
					atEof: 0,
					pastEof: Option.none(),
					cursor: BigInt(4),
					rest: Option.some("456789"),
				}),
			),
	},
	{
		name: "read at a negative position",
		run: (fs, p) => withHandle(fs, p("file"), "r", (h) => h.read(new Uint8Array(1), { position: BigInt(-1) })),
		expect: fail("BadArgument", "read"),
	},
	{
		name: "readAlloc at a negative position",
		run: (fs, p) => withHandle(fs, p("file"), "r", (h) => h.readAlloc(1, { position: BigInt(-1) })),
		expect: fail("BadArgument", "readAlloc"),
	},
	{
		name: "read at a position from a write-only handle",
		run: (fs, p) => withHandle(fs, p("file"), "w", (h) => h.read(new Uint8Array(1), { position: BigInt(0) })),
		expect: fail("Unknown", "read", "EBADF"),
	},

	// link and symlink
	{
		name: "link to a directory",
		run: (fs, p) => fs.link(p("dir"), p("dirlink")),
		expect: fail("PermissionDenied", "link", "EPERM"),
	},
	{
		name: "link onto an existing entry",
		run: (fs, p) => fs.link(p("file"), p("file2")),
		expect: fail("AlreadyExists", "link", "EEXIST"),
	},
	{
		name: "link onto a new trailing-slash path",
		run: (fs, p) => fs.link(p("file"), `${p("new")}/`),
		expect: fail("NotFound", "link", "ENOENT"),
	},
	{
		name: "symlink onto an existing entry",
		run: (fs, p) => fs.symlink(p("file"), p("file2")),
		expect: fail("AlreadyExists", "symlink", "EEXIST"),
	},
	{
		name: "symlink onto a directory named with a trailing slash",
		run: (fs, p) => fs.symlink(p("file"), `${p("dir")}/`),
		expect: fail("AlreadyExists", "symlink", "EEXIST"),
	},
	{
		name: "symlink onto a new trailing-slash path",
		run: (fs, p) => fs.symlink(p("file"), `${p("new")}/`),
		expect: fail("NotFound", "symlink", "ENOENT"),
	},

	// writeFile / readFile / readDirectory / stat
	{
		name: "writeFile onto a directory named with a trailing slash",
		run: (fs, p) => fs.writeFileString(`${p("dir")}/`, "x"),
		expect: fail("BadResource", "writeFile", "EISDIR"),
	},
	{
		name: "writeFile onto a new trailing-slash path",
		run: (fs, p) => fs.writeFileString(`${p("new")}/`, "x"),
		expect: { linux: fail("BadResource", "writeFile", "EISDIR"), darwin: fail("NotFound", "writeFile", "ENOENT") },
	},
	{
		name: "readFile a path with a NUL byte",
		run: (fs, p) => fs.readFile(p("a\u0000b")),
		expect: fail("BadArgument", "readFile"),
	},
	{
		name: "writeFile a path with a NUL byte",
		run: (fs, p) => fs.writeFileString(p("a\u0000b"), "x"),
		expect: fail("BadArgument", "writeFile"),
	},
	{
		name: "readFile a directory",
		run: (fs, p) => fs.readFile(p("dir")),
		expect: fail("BadResource", "readFile", "EISDIR"),
	},
	{
		name: "readDirectory a file",
		run: (fs, p) => fs.readDirectory(p("file")),
		expect: fail("BadResource", "readDirectory", "ENOTDIR"),
	},
	{ name: "stat a symlink loop", run: (fs, p) => fs.stat(p("loop1")), expect: fail("BadResource", "stat", "ELOOP") },
	{
		name: "utimes beneath a file",
		run: (fs, p) => fs.utimes(p("file", "x"), 0, 0),
		expect: fail("BadResource", "utime", "ENOTDIR"),
	},
	{
		name: "makeTempDirectory inside a file",
		run: (fs, p) => fs.makeTempDirectory({ directory: p("file") }),
		expect: fail("BadResource", "makeTempDirectory", "ENOTDIR"),
	},
	{
		name: "truncate to a negative length",
		run: (fs, p) => fs.truncate(p("file"), -1),
		expect: "success",
		check: (_, fs, p) => Effect.map(fs.readFile(p("file")), (contents) => assert.strictEqual(contents.length, 0)),
	},

	{
		name: "truncate a handle to a negative length",
		run: (fs, p) => withHandle(fs, p("file"), "r+", (h) => h.truncate(-1)),
		expect: "success",
		check: (_, fs, p) => Effect.map(fs.readFile(p("file")), (contents) => assert.strictEqual(contents.length, 0)),
	},

	// A path that walks THROUGH a non-directory (#1284). A `.` or `..` after a
	// file is a component under something that cannot hold one: ENOTDIR, never
	// the lexically collapsed path, and never a bad entry name either. A `.`
	// leaf under a missing parent is ENOENT for the same reason.
	{ name: "stat file/.", run: (fs, p) => fs.stat(p("file", ".")), expect: fail("BadResource", "stat", "ENOTDIR") },
	{ name: "stat file/..", run: (fs, p) => fs.stat(p("file", "..")), expect: fail("BadResource", "stat", "ENOTDIR") },
	{
		name: "readDirectory file/x/..",
		run: (fs, p) => fs.readDirectory(p("file", "x", "..")),
		expect: fail("BadResource", "readDirectory", "ENOTDIR"),
	},
	{
		name: "readFile file/../file",
		run: (fs, p) => fs.readFile(p("file", "..", "file")),
		expect: fail("BadResource", "readFile", "ENOTDIR"),
	},
	{
		name: "stat filesym/. (a link to a file)",
		run: (fs, p) => fs.stat(p("filesym", ".")),
		expect: fail("BadResource", "stat", "ENOTDIR"),
	},
	{
		name: "remove file/.",
		run: (fs, p) => fs.remove(p("file", ".")),
		expect: fail("BadResource", "remove", "ENOTDIR"),
	},
	{
		name: "remove file/x/.. recursively",
		run: (fs, p) => fs.remove(p("file", "x", ".."), { recursive: true }),
		expect: fail("BadResource", "remove", "ENOTDIR"),
	},
	{
		name: "rename file/.",
		run: (fs, p) => fs.rename(p("file", "."), p("moved")),
		expect: fail("BadResource", "rename", "ENOTDIR"),
	},
	{
		name: "rename onto file/x/..",
		run: (fs, p) => fs.rename(p("file2"), p("file", "x", "..")),
		expect: fail("BadResource", "rename", "ENOTDIR"),
	},
	{
		name: "symlink at file/.",
		run: (fs, p) => fs.symlink("t", p("file", ".")),
		expect: fail("BadResource", "symlink", "ENOTDIR"),
	},
	{
		name: "link at filesym/..",
		run: (fs, p) => fs.link(p("file2"), p("filesym", "..")),
		expect: fail("BadResource", "link", "ENOTDIR"),
	},
	{
		name: "remove missing/.",
		run: (fs, p) => fs.remove(p("missing", ".")),
		expect: fail("NotFound", "remove", "ENOENT"),
	},
	{
		name: "symlink at missing/x/..",
		run: (fs, p) => fs.symlink("t", p("missing", "x", "..")),
		expect: fail("NotFound", "symlink", "ENOENT"),
	},
	// A `.` or `..` leaf on a real DIRECTORY (#1327) names that directory or its
	// parent, never a new entry: each operation refuses it with its own errno.
	{
		name: "remove dir/.",
		run: (fs, p) => fs.remove(p("dir", ".")),
		expect: fail("Unknown", "remove", "ERR_FS_EISDIR"),
	},
	{
		name: "remove dir/..",
		run: (fs, p) => fs.remove(p("dir", "..")),
		expect: fail("Unknown", "remove", "ERR_FS_EISDIR"),
	},
	{
		name: "remove dir/. with force",
		run: (fs, p) => fs.remove(p("dir", "."), { force: true }),
		expect: fail("Unknown", "remove", "ERR_FS_EISDIR"),
	},
	{
		name: "remove full/. recursively",
		run: (fs, p) => fs.remove(p("full", "."), { recursive: true }),
		expect: fail("Unknown", "remove", "EINVAL"),
		afterward: (fs, p) => Effect.map(fs.exists(p("full", "a")), (exists) => assert.isTrue(exists)),
	},
	{
		name: "remove empty/. recursively with force",
		run: (fs, p) => fs.remove(p("empty", "."), { recursive: true, force: true }),
		expect: fail("Unknown", "remove", "EINVAL"),
	},
	// Known divergence: Linux `rm -r dir/..` empties the directory holding `dir`
	// until its own path stops resolving, then answers success; memfs keeps
	// macOS's refusal, which removes nothing.
	{
		name: "remove dir/.. recursively",
		run: (fs, p) => fs.remove(p("dir", ".."), { recursive: true }),
		expect: {
			memory: fail("Unknown", "remove", "EINVAL"),
			node: { linux: "success", darwin: fail("Unknown", "remove", "EINVAL") },
		},
	},
	{
		name: "remove dir/missing/..",
		run: (fs, p) => fs.remove(p("dir", "missing", "..")),
		expect: fail("NotFound", "remove", "ENOENT"),
	},
	{
		name: "rename dir/.",
		run: (fs, p) => fs.rename(p("dir", "."), p("moved")),
		expect: { linux: fail("Busy", "rename", "EBUSY"), darwin: fail("Unknown", "rename", "EINVAL") },
	},
	{
		name: "rename full/..",
		run: (fs, p) => fs.rename(p("full", ".."), p("moved")),
		expect: { linux: fail("Busy", "rename", "EBUSY"), darwin: fail("Unknown", "rename", "EINVAL") },
	},
	{
		name: "rename a file onto dir/.",
		run: (fs, p) => fs.rename(p("file"), p("dir", ".")),
		expect: { linux: fail("Busy", "rename", "EBUSY"), darwin: fail("Unknown", "rename", "EINVAL") },
	},
	{
		name: "rename a directory onto full/..",
		run: (fs, p) => fs.rename(p("empty"), p("full", "..")),
		expect: { linux: fail("Busy", "rename", "EBUSY"), darwin: fail("Unknown", "rename", "EINVAL") },
	},
	{
		name: "rename a missing entry onto dir/.",
		run: (fs, p) => fs.rename(p("missing"), p("dir", ".")),
		expect: { linux: fail("Busy", "rename", "EBUSY"), darwin: fail("NotFound", "rename", "ENOENT") },
	},
	{
		name: "rename dir/. beneath a file",
		run: (fs, p) => fs.rename(p("dir", "."), p("file", "x")),
		expect: fail("BadResource", "rename", "ENOTDIR"),
	},
	{
		name: "rename dir/. beneath a missing directory",
		run: (fs, p) => fs.rename(p("dir", "."), p("missing", "x")),
		expect: fail("NotFound", "rename", "ENOENT"),
	},
	// The root has no leaf at all (#1339): Linux refuses it as it refuses a `.`
	// leaf, EBUSY once both parents resolve; macOS says EISDIR. Only cases whose
	// answer cannot depend on mounts run here — Linux checks EXDEV BEFORE EBUSY,
	// so `rename("/", tmp/x)` is EXDEV when the temp directory is its own mount.
	// The mount-dependent shapes are pinned on memfs alone, in RenameRoot.test.ts.
	{
		name: "rename the root onto itself",
		run: (fs) => fs.rename("/", "/"),
		expect: { linux: fail("Busy", "rename", "EBUSY"), darwin: fail("BadResource", "rename", "EISDIR") },
	},
	{
		name: "rename the root beneath a missing directory",
		run: (fs, p) => fs.rename("/", p("missing", "x")),
		expect: { linux: fail("NotFound", "rename", "ENOENT"), darwin: fail("BadResource", "rename", "EISDIR") },
	},
	{
		name: "rename the root beneath a file",
		run: (fs, p) => fs.rename("/", p("file", "x")),
		expect: { linux: fail("BadResource", "rename", "ENOTDIR"), darwin: fail("BadResource", "rename", "EISDIR") },
	},
	{
		name: "symlink at dir/.",
		run: (fs, p) => fs.symlink("t", p("dir", ".")),
		expect: fail("AlreadyExists", "symlink", "EEXIST"),
	},
	{
		name: "symlink at dir/..",
		run: (fs, p) => fs.symlink("t", p("dir", "..")),
		expect: fail("AlreadyExists", "symlink", "EEXIST"),
	},
	{
		name: "link at dir/.",
		run: (fs, p) => fs.link(p("file"), p("dir", ".")),
		expect: fail("AlreadyExists", "link", "EEXIST"),
	},
	{
		name: "link at dir/..",
		run: (fs, p) => fs.link(p("file"), p("dir", "..")),
		expect: fail("AlreadyExists", "link", "EEXIST"),
	},
	{
		name: "link from dir/.",
		run: (fs, p) => fs.link(p("dir", "."), p("dirlink")),
		expect: fail("PermissionDenied", "link", "EPERM"),
	},
	{
		name: "makeDirectory dir/.",
		run: (fs, p) => fs.makeDirectory(p("dir", ".")),
		expect: fail("AlreadyExists", "makeDirectory", "EEXIST"),
	},
	{
		name: "makeDirectory dir/..",
		run: (fs, p) => fs.makeDirectory(p("dir", "..")),
		expect: fail("AlreadyExists", "makeDirectory", "EEXIST"),
	},
	{
		name: "makeDirectory dir/. recursively",
		run: (fs, p) => fs.makeDirectory(p("dir", "."), { recursive: true }),
		expect: "success",
	},
	{
		name: "makeDirectory new/.. recursively creates new",
		run: (fs, p) => fs.makeDirectory(p("new", ".."), { recursive: true }),
		expect: "success",
		check: (_, fs, p) => Effect.map(fs.exists(p("new")), (exists) => assert.isTrue(exists)),
	},
	{
		name: "makeDirectory dir/new/..",
		run: (fs, p) => fs.makeDirectory(p("dir", "new", "..")),
		expect: fail("NotFound", "makeDirectory", "ENOENT"),
	},

	// realPath is the exception, because node's `fs.realpath` normalizes the
	// path lexically (`path.resolve`) before it resolves a single link: there,
	// `file/..` is the directory holding `file`, and a missing parent of a `..`
	// is never visited.
	...(
		[
			[["file", ".."], []],
			[["file", ".", ".."], []],
			[["missing", ".."], []],
			[["file", "."], ["file"]],
			[["file", "x", ".."], ["file"]],
		] as const
	).map(
		([segments, normalized]): Case => ({
			name: `realPath ${segments.join("/")} normalizes lexically, as fs.realpath does`,
			run: (fs, p) => fs.realPath(p(...segments)),
			expect: "success",
			check: (value, fs, p) => Effect.map(fs.realPath(p(...normalized)), (want) => assert.strictEqual(value, want)),
		}),
	),

	// A link TARGET is folded lexically too (#1339): fs.realpath joins
	// `sub/../b` onto the link's directory with `path.resolve`, so `..` undoes
	// `sub` even though `sub` is itself a link to `deep/inner` — the kernel,
	// which `readFile` uses, lands on `deep/b`. Before the join it `stat`s the
	// link, which IS physical: the result needs both to exist.
	...(
		[
			["both b files", ["b", "deep/b"], "success"],
			["only the physical deep/b", ["deep/b"], fail("NotFound", "realPath", "ENOENT")],
			["only the lexical b", ["b"], fail("NotFound", "realPath", "ENOENT")],
		] as const
	).map(
		([label, files, outcome]): Case => ({
			name: `realPath a -> sub/../b, sub a link, with ${label}, folds the target lexically`,
			run: (fs, p) =>
				Effect.gen(function* () {
					yield* fs.makeDirectory(p("deep", "inner"), { recursive: true });
					yield* fs.symlink("deep/inner", p("sub"));
					yield* fs.symlink("sub/../b", p("a"));
					for (const file of files) yield* fs.writeFileString(p(...file.split("/")), file);
					return yield* fs.realPath(p("a"));
				}),
			expect: outcome,
			check: (value, fs, p) => Effect.map(fs.realPath(p("b")), (want) => assert.strictEqual(value, want)),
		}),
	),

	// glob never fails on its root: missing, non-directory and unresolvable roots match nothing.
	{
		name: "glob from a missing root",
		run: (fs, p) => fs.glob("*", { root: p("missing") }),
		expect: "success",
		check: (value) => Effect.sync(() => assert.deepStrictEqual(value, [])),
	},
	{
		name: "glob from a file root",
		run: (fs, p) => fs.glob("*", { root: p("file") }),
		expect: "success",
		check: (value) => Effect.sync(() => assert.deepStrictEqual(value, [])),
	},
	{
		name: "glob from a symlink-loop root",
		run: (fs, p) => fs.glob("*", { root: p("loop1") }),
		expect: "success",
		check: (value) => Effect.sync(() => assert.deepStrictEqual(value, [])),
	},
];

const seedTree = Effect.fnUntraced(function* (
	fs: FileSystem.FileSystem,
	p: (...segments: ReadonlyArray<string>) => string,
) {
	yield* fs.writeFileString(p("file"), "x");
	yield* fs.writeFileString(p("file2"), "y");
	yield* fs.makeDirectory(p("dir"));
	yield* fs.makeDirectory(p("empty"));
	yield* fs.makeDirectory(p("full"));
	yield* fs.writeFileString(p("full", "a"), "a");
	yield* fs.makeDirectory(p("full2"));
	yield* fs.writeFileString(p("full2", "b"), "b");
	yield* fs.symlink(p("loop2"), p("loop1"));
	yield* fs.symlink(p("loop1"), p("loop2"));
	yield* fs.symlink(p("nowhere"), p("dangling"));
	yield* fs.symlink(p("file"), p("filesym"));
	yield* fs.symlink(p("dir"), p("dirsym"));
});

const assertOutcome = (exit: Exit.Exit<unknown, PlatformError.PlatformError>, expected: Outcome): void => {
	if (expected === "success") {
		assert.isTrue(Exit.isSuccess(exit), Exit.isFailure(exit) ? `expected success, got ${String(exit.cause)}` : "");
		return;
	}
	if (Exit.isSuccess(exit)) {
		assert.fail(`expected a ${expected.tag} failure, got success`);
		return;
	}
	const found = Cause.findError(exit.cause);
	if (Result.isFailure(found)) {
		assert.fail(`expected a typed failure, got ${String(exit.cause)}`);
		return;
	}
	const error = found.success;
	assert.strictEqual(error._tag, "PlatformError");
	assert.strictEqual(error.reason._tag, expected.tag);
	assert.strictEqual(error.reason.method, expected.method);
	if (expected.code !== undefined) {
		const cause = error.reason.cause as { readonly code?: unknown } | undefined;
		assert.strictEqual(cause?.code, expected.code);
	}
};

export const errnoSuite = (implementation: Implementation, fsLayer: Layer.Layer<FileSystem.FileSystem, unknown>) =>
	layer(fsLayer, { timeout: { seconds: 30 } })(`FileSystem errno parity (${implementation})`, (it) => {
		describe("failure shape matches the node adapter", () => {
			for (const testCase of cases) {
				it.effect(testCase.name, () =>
					Effect.scoped(
						Effect.gen(function* () {
							const fs = yield* FileSystem.FileSystem;
							const root = yield* fs.makeTempDirectoryScoped({ prefix: "effect-filesystem-errno-" });
							const p = (...segments: ReadonlyArray<string>) => [root, ...segments].join("/");
							yield* seedTree(fs, p);
							const exit = yield* Effect.exit(Effect.scoped(testCase.run(fs, p)));
							assertOutcome(exit, resolveExpectation(testCase.expect, implementation));
							if (testCase.check !== undefined && Exit.isSuccess(exit)) {
								yield* testCase.check(exit.value, fs, p);
							}
							if (testCase.afterward !== undefined) yield* testCase.afterward(fs, p);
						}),
					),
				);
			}
		});
	});
