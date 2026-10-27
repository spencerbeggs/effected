// One contender in the RunOnce cross-process race (RunOnce.e2e.test.ts).
// Imports the package's dev build, which the workspace pre-builds before tests.
// argv: <dir> <key> <counterFile>. The work appends one line to the counter
// file and holds the lock for a while, so every other contender must wait.
import { appendFileSync } from "node:fs";
import { Result } from "effect";
import { RunOnce } from "../../../dist/dev/pkg/index.js";
import { nodeRunOnceHost } from "../../../dist/dev/pkg/node-sync.js";

const [dir, key, counter] = process.argv.slice(2);
const result = RunOnce.runSync({ dir, key, pollMs: 20 }, nodeRunOnceHost, () => {
	appendFileSync(counter, `${process.pid}\n`);
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
	return Result.succeed(process.pid);
});
process.stdout.write(JSON.stringify(Result.isSuccess(result) ? result.success._tag : "failed"));
