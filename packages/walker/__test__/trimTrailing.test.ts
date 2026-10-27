// `trimTrailing` replaces the unanchored `/\/+$/` the walk once trimmed prefixes with, which retries from every
// separator of a run that is not at the end, quadratically. A timing guard inside vitest cannot stop a runaway
// synchronous loop, so the long-run case runs in a subprocess with a hard timeout. The helper has no imports, so
// node loads its source directly.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { trimTrailing } from "../src/internal/trimTrailing.js";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Long enough that the quadratic regex takes tens of seconds; the loop takes well under one. */
const RUN = 200_000;

const isSlash = (character: string): boolean => character === "/";

describe("trimTrailing", () => {
	it("trims around a long separator run in linear time, in a subprocess under a hard timeout", () => {
		const script = [
			`import { trimTrailing } from "./src/internal/trimTrailing.ts";`,
			`const isSlash = (c) => c === "/";`,
			`const inner = "a" + "/".repeat(${RUN}) + "b";`,
			`const trailing = "a" + "/".repeat(${RUN});`,
			`process.stdout.write(JSON.stringify([trimTrailing(inner, isSlash).length, trimTrailing(trailing, isSlash)]));`,
		].join("\n");
		const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
			cwd: PACKAGE,
			encoding: "utf8",
			timeout: 5_000,
		});
		assert.strictEqual(child.signal, null, "killed by the timeout: trimming is not linear");
		assert.strictEqual(child.status, 0, child.stderr);
		assert.deepStrictEqual(JSON.parse(child.stdout), [RUN + 2, "a"]);
	});

	it("trims only the trailing run the predicate accepts", () => {
		assert.strictEqual(trimTrailing("src/lib///", isSlash), "src/lib");
		assert.strictEqual(trimTrailing("src//lib", isSlash), "src//lib");
		assert.strictEqual(trimTrailing("///", isSlash), "");
		assert.strictEqual(trimTrailing("", isSlash), "");
		// A glob pattern's backslash is an escape, never a separator: the walk's predicate leaves it.
		assert.strictEqual(trimTrailing("a\\/", isSlash), "a\\");
	});
});
