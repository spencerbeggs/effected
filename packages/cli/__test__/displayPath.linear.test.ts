// `relativeTo` without a `Path` trims the caller's root of trailing separators. An unanchored `/[\\/]+$/` retries
// from every separator in a run that is not at the end, which is quadratic on a long run inside the root. A timing
// guard inside vitest cannot stop a runaway synchronous loop, so the run happens in a subprocess with a hard timeout.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { relativeTo } from "../src/internal/displayPath.js";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Long enough that the quadratic regex takes tens of seconds; the linear trim takes well under one. */
const RUN = 200_000;

describe("relativeTo without Path", () => {
	it("trims a root holding a long separator run in linear time, in a subprocess under a hard timeout", () => {
		const script = [
			`import { Option } from "effect";`,
			`import { relativeTo } from "./src/internal/displayPath.ts";`,
			`const root = "a" + "/".repeat(${RUN}) + "b";`,
			`process.stdout.write(relativeTo(root, Option.none())(root + "/x.ts"));`,
		].join("\n");
		const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
			cwd: PACKAGE,
			encoding: "utf8",
			timeout: 5_000,
		});
		assert.strictEqual(child.signal, null, "killed by the timeout: trimming the root is not linear");
		assert.strictEqual(child.status, 0, child.stderr);
		assert.strictEqual(child.stdout, "x.ts");
	});

	it("trims a trailing run of mixed separators, and only the trailing run", () => {
		assert.strictEqual(relativeTo("/repo/\\//", Option.none())("/repo/src/a.ts"), "src/a.ts");
		assert.strictEqual(relativeTo("/repo//x", Option.none())("/repo//x/a.ts"), "a.ts");
		assert.strictEqual(relativeTo("/repo", Option.none())("/repo//x/a.ts"), "/x/a.ts");
	});
});
