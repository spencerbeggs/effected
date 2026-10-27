// nodeRunSync's cleanup, observed: every descriptor it opens is closed and its
// temporary directory removed on EVERY path — success, a failing open, a
// throwing spawn — and a spawn that throws is reported, not thrown. The real
// node operations run underneath spies, against a private temporary root.

import { spawnSync } from "node:child_process";
import { closeSync, existsSync, fstatSync, mkdtempSync, openSync, readSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, assert, beforeEach, describe, it } from "@effect/vitest";
import type { NodeRunOps } from "../src/internal/nodeRunSync.js";
import { makeNodeRunSync } from "../src/internal/nodeRunSync.js";
import { nodeRunSync } from "../src/node-sync.js";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "node-run-sync-test-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

interface Spy {
	readonly ops: NodeRunOps;
	readonly opened: Array<number>;
	readonly closed: Array<number>;
	readonly removed: Array<string>;
}

/** The real node operations under spies, rooted at the test's private directory, with optional faults. */
const spy = (faults: { readonly failOpen?: number; readonly spawnThrows?: boolean } = {}): Spy => {
	const opened: Array<number> = [];
	const closed: Array<number> = [];
	const removed: Array<string> = [];
	let opens = 0;
	const ops: NodeRunOps = {
		spawnSync: (command, args, options) => {
			if (faults.spawnThrows === true)
				throw new TypeError("The argument 'args[0]' must be a string without null bytes");
			return spawnSync(command, args, options as Parameters<typeof spawnSync>[2]);
		},
		mkdtempSync: (prefix) => mkdtempSync(prefix),
		openSync: (path, flags) => {
			opens++;
			if (faults.failOpen === opens) throw Object.assign(new Error("EMFILE"), { code: "EMFILE" });
			const fd = openSync(path, flags);
			opened.push(fd);
			return fd;
		},
		closeSync: (fd) => {
			closed.push(fd);
			closeSync(fd);
		},
		rmSync: (path, options) => {
			removed.push(path);
			rmSync(path, options);
		},
		fstatSync: (fd) => fstatSync(fd),
		readSync: (fd, buffer, offset, length, position) => readSync(fd, buffer, offset, length, position),
		tmpdir: () => root,
	};
	return { ops, opened, closed, removed };
};

const leftovers = (): ReadonlyArray<string> => readdirSync(root);

const capture = { stdio: "capture", maxOutputBytes: 1024 } as const;

describe("nodeRunSync cleanup", () => {
	it("success: both descriptors closed, the temporary directory removed", () => {
		const s = spy();
		const result = makeNodeRunSync(s.ops)(
			process.execPath,
			["-e", "console.log('out'); console.error('err')"],
			capture,
		);
		assert.strictEqual(result.status, 0);
		assert.strictEqual(result.stdout.trim(), "out");
		assert.strictEqual(result.stderr.trim(), "err");
		assert.strictEqual(s.opened.length, 2);
		assert.sameMembers(s.closed, s.opened);
		assert.strictEqual(s.removed.length, 1);
		assert.deepStrictEqual(leftovers(), []);
	});

	it("the stderr open failing: the stdout descriptor is still closed and the directory removed", () => {
		const s = spy({ failOpen: 2 });
		const result = makeNodeRunSync(s.ops)(process.execPath, ["-e", ""], capture);
		assert.isDefined(result.error);
		assert.strictEqual(result.status, null);
		assert.strictEqual(s.opened.length, 1);
		assert.sameMembers(s.closed, s.opened);
		assert.deepStrictEqual(leftovers(), []);
	});

	it("a throwing spawn is reported as could-not-start, and still cleans up", () => {
		const s = spy({ spawnThrows: true });
		const result = makeNodeRunSync(s.ops)(process.execPath, ["a\u0000b"], capture);
		assert.instanceOf(result.error, TypeError);
		assert.strictEqual(result.status, null);
		assert.sameMembers(s.closed, s.opened);
		assert.strictEqual(s.opened.length, 2);
		assert.deepStrictEqual(leftovers(), []);
	});

	it("inherit mode: a throwing spawn is reported too", () => {
		const s = spy({ spawnThrows: true });
		const result = makeNodeRunSync(s.ops)(process.execPath, ["x"], { stdio: "inherit", maxOutputBytes: 1 });
		assert.instanceOf(result.error, TypeError);
		assert.deepStrictEqual(s.opened, []);
	});

	it("the real binding reports a NUL byte in argv as could-not-start", () => {
		const result = nodeRunSync(process.execPath, ["-e", "nul\u0000here"], capture);
		assert.isDefined(result.error);
		assert.strictEqual(result.status, null);
		assert.isFalse(existsSync(join(root, "stdout")));
	});
});

describe("nodeRunSync options", () => {
	it("passes windowsVerbatimArguments to spawnSync in both stdio modes, and omits it when unset", () => {
		const s = spy();
		const seen: Array<Parameters<NodeRunOps["spawnSync"]>[2]> = [];
		const run = makeNodeRunSync({
			...s.ops,
			spawnSync: (command, args, options) => {
				seen.push({ ...options });
				return s.ops.spawnSync(command, args, options);
			},
		});
		for (const stdio of ["capture", "inherit"] as const) {
			for (const verbatim of [true, false]) {
				seen.length = 0;
				const result = run(process.execPath, ["-e", ""], {
					stdio,
					maxOutputBytes: 64,
					windowsVerbatimArguments: verbatim,
				});
				assert.strictEqual(result.status, 0);
				assert.strictEqual(seen[0]?.windowsVerbatimArguments, verbatim, `${stdio} ${verbatim}`);
			}
			seen.length = 0;
			run(process.execPath, ["-e", ""], { stdio, maxOutputBytes: 64 });
			assert.isFalse(Object.hasOwn(seen[0] ?? {}, "windowsVerbatimArguments"), stdio);
		}
		assert.deepStrictEqual(leftovers(), []);
	});
});
