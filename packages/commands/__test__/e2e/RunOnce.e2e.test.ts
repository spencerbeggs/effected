// RunOnce's Node bindings against real processes and a real filesystem: the
// cross-process race the protocol exists for, signal-0 liveness against a real
// live and a real dead pid, and nodeRunSync's file-backed capture surviving
// output far past spawnSync's 1 MiB pipe buffer limit.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { nodeProcessLiveness, nodeRunOnceHost } from "../../src/node-sync.js";
import { RunOnce } from "../../src/RunOnce.js";

const CHILD = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "run-once-child.mjs");

const withDir = async <A>(f: (dir: string) => Promise<A> | A): Promise<A> => {
	const dir = mkdtempSync(join(tmpdir(), "run-once-e2e-"));
	try {
		return await f(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

const runChild = (dir: string, counter: string): Promise<string> =>
	new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [CHILD, dir, "race", counter], { stdio: ["ignore", "pipe", "inherit"] });
		let out = "";
		child.stdout.on("data", (chunk) => {
			out += String(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => (code === 0 ? resolve(JSON.parse(out) as string) : reject(new Error(`exit ${code}`))));
	});

describe("RunOnce across real processes", () => {
	it("four concurrent processes: exactly one runs the work, the rest trust it", { timeout: 30_000 }, async () => {
		await withDir(async (dir) => {
			const counter = join(dir, "counter");
			writeFileSync(counter, "");
			const outcomes = await Promise.all([0, 1, 2, 3].map(() => runChild(join(dir, "locks"), counter)));
			const lines = readFileSync(counter, "utf8").trim().split("\n");
			assert.strictEqual(lines.length, 1, `the work ran ${lines.length} times: ${outcomes.join(",")}`);
			assert.deepStrictEqual([...outcomes].sort(), ["Ran", "Trusted", "Trusted", "Trusted"]);
		});
	});

	it("a sequential re-run is not trusted: the work runs again", { timeout: 30_000 }, async () => {
		await withDir(async (dir) => {
			const counter = join(dir, "counter");
			writeFileSync(counter, "");
			assert.strictEqual(await runChild(join(dir, "locks"), counter), "Ran");
			assert.strictEqual(await runChild(join(dir, "locks"), counter), "Ran");
			assert.strictEqual(readFileSync(counter, "utf8").trim().split("\n").length, 2);
		});
	});
});

describe("nodeProcessLiveness", () => {
	it("is alive for a live child, dead for an exited one", async () => {
		const live = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
		try {
			assert.isDefined(live.pid);
			assert.isTrue(nodeProcessLiveness.isAlive(live.pid ?? 0));
		} finally {
			live.kill();
		}
		const exited = spawnSync(process.execPath, ["-e", ""]);
		assert.isFalse(nodeProcessLiveness.isAlive(exited.pid ?? 0));
		assert.isTrue(nodeProcessLiveness.isAlive(process.pid));
	});

	it("a lock left by a dead process is taken over at once", async () => {
		await withDir((dir) => {
			const dead = spawnSync(process.execPath, ["-e", ""]).pid ?? 0;
			const lock = { pid: dead, host: nodeProcessLiveness.host, nonce: "gone", startedAt: Date.now() };
			writeFileSync(join(dir, "k.lock"), JSON.stringify(lock));
			const started = Date.now();
			const result = RunOnce.runSync({ key: "k", dir }, nodeRunOnceHost, () => Result.succeed("ok"));
			assert.deepStrictEqual(result, Result.succeed({ _tag: "Ran", value: "ok" }));
			assert.isBelow(Date.now() - started, 5000);
		});
	});
});

describe("nodeRunSync through RunOnce.commandSync", () => {
	it("a successful build writing 3 MiB of output succeeds, keeping the trailing bytes", async () => {
		await withDir((dir) => {
			const script = "process.stdout.write('a'.repeat(3 * 1024 * 1024) + 'END')";
			const result = RunOnce.commandSync({ key: "k", dir }, nodeRunOnceHost, {
				argv: [process.execPath, "-e", script],
				maxOutputBytes: 1024,
			});
			assert.isTrue(Result.isSuccess(result));
			if (Result.isSuccess(result) && result.success._tag === "Ran") {
				assert.strictEqual(result.success.value.stdout.length, 1024);
				assert.isTrue(result.success.value.stdout.endsWith("END"));
			}
		});
	});

	it("a failing command reports its exit code and the tail of stderr", async () => {
		await withDir((dir) => {
			const result = RunOnce.commandSync({ key: "k", dir }, nodeRunOnceHost, {
				argv: [process.execPath, "-e", "console.error('the real error'); process.exit(3)"],
			});
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.strictEqual(result.failure.exitCode, 3);
				assert.include(result.failure.stderr ?? "", "the real error");
			}
		});
	});

	it("a NUL byte in argv fails spawn instead of throwing", async () => {
		await withDir((dir) => {
			const result = RunOnce.commandSync({ key: "k", dir }, nodeRunOnceHost, {
				argv: [process.execPath, "-e", "nul\u0000here"],
			});
			assert.isTrue(Result.isFailure(result) && result.failure.kind === "spawn");
		});
	});

	it("a missing executable fails spawn", async () => {
		await withDir((dir) => {
			const result = RunOnce.commandSync({ key: "k", dir }, nodeRunOnceHost, {
				argv: ["definitely-not-a-binary-xyz"],
			});
			assert.isTrue(Result.isFailure(result) && result.failure.kind === "spawn");
		});
	});
});
