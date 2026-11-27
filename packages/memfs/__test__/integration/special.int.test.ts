// Differential oracle for special entries: a real unix socket under
// os.tmpdir() against a `MemoryFileSystem.special("Socket")` seed, through
// @effect/platform-node's `FileSystem` and through `node:fs` against the sync
// port. Every content operation on a socket fails in its `open`. Linux answers
// ENXIO; macOS answers errno 102 (EOPNOTSUPP), which libuv leaves unmapped as
// "Unknown system error -102" (host-probed). memfs models the Linux errno, as
// it does everywhere the two platforms disagree.
//
// A FIFO is not opened here: opening one for reading blocks until a writer
// appears, so only its `stat` is compared.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import type { Server } from "node:net";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import type { PlatformError } from "effect";
import { Effect, FileSystem } from "effect";
import { MemoryFileSystem } from "../../src/index.js";

const supported = process.platform === "linux" || process.platform === "darwin";

let host: string;
let server: Server;
beforeAll(async () => {
	if (!supported) return;
	host = mkdtempSync(join(tmpdir(), "memfs-special-"));
	server = createServer();
	await new Promise<void>((resolve) => server.listen(join(host, "sock"), resolve));
	symlinkSync(join(host, "sock"), join(host, "link"));
	writeFileSync(join(host, "file.txt"), "hello");
	execFileSync("mkfifo", [join(host, "pipe")]);
});
afterAll(async () => {
	if (!supported) return;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	rmSync(host, { recursive: true, force: true });
});

const memory = MemoryFileSystem.makeSync(
	{
		sock: MemoryFileSystem.special("Socket"),
		link: MemoryFileSystem.symlink("/r/sock"),
		"file.txt": "hello",
		pipe: MemoryFileSystem.special("FIFO"),
	},
	{ root: "/r" },
);

/** The errno the platform reports for opening a socket: memfs models Linux's. */
const socketErrno = (implementation: "memory" | "node"): string =>
	implementation === "memory" || process.platform === "linux" ? "ENXIO" : "Unknown system error -102";

const outcome = (error: PlatformError.PlatformError) => ({
	tag: error.reason._tag,
	method: error.reason.method,
	code: (error.reason.cause as { readonly code?: string } | undefined)?.code,
});

// Every operation, given the volume root.
const operations = (fs: FileSystem.FileSystem, at: (name: string) => string) =>
	[
		["readFile", fs.readFile(at("sock"))],
		["readFile", fs.readFile(at("link"))],
		["open", Effect.scoped(fs.open(at("sock"), { flag: "r" }))],
		["open", Effect.scoped(fs.open(at("sock"), { flag: "w" }))],
		["open", Effect.scoped(fs.open(at("sock"), { flag: "a+" }))],
		["writeFile", fs.writeFileString(at("sock"), "x")],
		["truncate", fs.truncate(at("sock"))],
		["copyFile", fs.copyFile(at("sock"), at("copy"))],
		["copyFile", fs.copyFile(at("file.txt"), at("sock"))],
	] as const;

describe.skipIf(!supported)("special entries agree with the host", () => {
	it.effect("stat reports the type and size 0 on both", () =>
		Effect.gen(function* () {
			const node = yield* Effect.provide(FileSystem.FileSystem, NodeFileSystem.layer);
			for (const [name, type] of [
				["sock", "Socket"],
				["link", "Socket"],
				["pipe", "FIFO"],
			] as const) {
				const real = yield* node.stat(join(host, name));
				const virtual = yield* memory.fileSystem.stat(`/r/${name}`);
				assert.strictEqual(real.type, type, name);
				assert.strictEqual(virtual.type, type, name);
				assert.strictEqual(Number(real.size), 0, name);
				assert.strictEqual(Number(virtual.size), 0, name);
			}
		}),
	);

	it.effect("every content operation on a socket fails in its open, with the same tag and method", () =>
		Effect.gen(function* () {
			const node = yield* Effect.provide(FileSystem.FileSystem, NodeFileSystem.layer);
			const real = operations(node, (name) => join(host, name));
			const virtual = operations(memory.fileSystem, (name) => `/r/${name}`);
			for (let index = 0; index < real.length; index++) {
				const [method, realEffect] = real[index] as (typeof real)[number];
				const [, virtualEffect] = virtual[index] as (typeof virtual)[number];
				assert.deepStrictEqual(
					outcome(yield* Effect.flip(realEffect)),
					{ tag: "Unknown", method, code: socketErrno("node") },
					`node ${index} ${method}`,
				);
				assert.deepStrictEqual(
					outcome(yield* Effect.flip(virtualEffect)),
					{ tag: "Unknown", method, code: socketErrno("memory") },
					`memory ${index} ${method}`,
				);
			}
		}),
	);

	// A KNOWN divergence, both sides asserted: node's `fs.cp` refuses a socket
	// with its own code before it opens anything; memfs refuses every special
	// entry in `copy` with the one ENXIO its other content operations raise.
	it.effect("copy of a socket: ERR_FS_CP_SOCKET on the host, ENXIO in memfs", () =>
		Effect.gen(function* () {
			const node = yield* Effect.provide(FileSystem.FileSystem, NodeFileSystem.layer);
			const real = outcome(yield* Effect.flip(node.copy(join(host, "sock"), join(host, "cp"))));
			assert.strictEqual(real.code, "ERR_FS_CP_SOCKET");
			const virtual = outcome(yield* Effect.flip(memory.fileSystem.copy("/r/sock", "/r/cp")));
			assert.deepStrictEqual(virtual, { tag: "Unknown", method: "copy", code: "ENXIO" });
		}),
	);

	it("the sync port throws what readFileSync throws, and stats agree", () => {
		for (const name of ["sock", "link"]) {
			let realError: { code?: string; syscall?: string } = {};
			try {
				readFileSync(join(host, name));
			} catch (e) {
				realError = e as { code?: string; syscall?: string };
			}
			let virtualError: { code?: string; syscall?: string } = {};
			try {
				memory.sync.readFile(`/r/${name}`);
			} catch (e) {
				virtualError = e as { code?: string; syscall?: string };
			}
			assert.deepStrictEqual(
				{ code: realError.code, syscall: realError.syscall },
				{
					code: socketErrno("node"),
					syscall: "open",
				},
			);
			assert.deepStrictEqual(
				{ code: virtualError.code, syscall: virtualError.syscall },
				{
					code: socketErrno("memory"),
					syscall: "open",
				},
			);
		}
		for (const name of ["sock", "link", "pipe"]) {
			const real = statSync(join(host, name));
			const virtual = memory.sync.stat(`/r/${name}`);
			for (const predicate of [
				"isFile",
				"isDirectory",
				"isSymbolicLink",
				"isCharacterDevice",
				"isBlockDevice",
				"isFIFO",
				"isSocket",
			] as const) {
				assert.strictEqual(virtual[predicate](), real[predicate](), `${name} ${predicate}`);
			}
		}
	});
});
