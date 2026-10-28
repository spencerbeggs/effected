// The nerf-dart walk once looped forever on a path holding `//`: stripping `[^/]+/$` from `//` makes no progress.
// A vitest timeout is a timer on the same thread and cannot stop a synchronous loop, so the hostile URLs run in a
// subprocess with a hard timeout. The helper has no imports, so node loads its source directly.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { MAX_NERF_DART_KEYS, nerfDartKeys } from "../src/internal/nerfDartKeys.js";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");

const HOSTILE = [
	"https://r.example.com//pkg/-/pkg-1.0.0.tgz",
	"https://r.example.com//",
	"https://r.example.com///a//b///",
	`https://r.example.com/${"/".repeat(10_000)}x`,
	`https://r.example.com/${"a/".repeat(10_000)}`,
];

describe("nerfDartKeys", () => {
	it("returns on `//`-bearing paths, in a subprocess under a hard timeout", () => {
		const script = [
			`import { nerfDartKeys } from "./src/internal/nerfDartKeys.ts";`,
			`const urls = ${JSON.stringify(HOSTILE)};`,
			"process.stdout.write(JSON.stringify(urls.map((url) => nerfDartKeys(url).length)));",
		].join("\n");
		const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
			cwd: PACKAGE,
			encoding: "utf8",
			timeout: 5_000,
		});
		assert.strictEqual(child.signal, null, "killed by the timeout: the walk does not terminate");
		assert.strictEqual(child.status, 0, child.stderr);
		assert.deepStrictEqual(JSON.parse(child.stdout), [4, 2, 8, MAX_NERF_DART_KEYS, MAX_NERF_DART_KEYS]);
	});

	it("treats an empty segment as a level, deepest first, ending at the host", () => {
		assert.deepStrictEqual(nerfDartKeys("https://r.example.com//pkg/-/pkg-1.0.0.tgz"), [
			"//r.example.com//pkg/-/",
			"//r.example.com//pkg/",
			"//r.example.com//",
			"//r.example.com/",
		]);
		assert.deepStrictEqual(nerfDartKeys("https://r.example.com//"), ["//r.example.com//", "//r.example.com/"]);
	});

	it("walks an ordinary path the way it always did (the control)", () => {
		assert.deepStrictEqual(nerfDartKeys("https://H.example:443/a/b/c.tgz"), [
			"//h.example/a/b/",
			"//h.example/a/",
			"//h.example/",
		]);
		assert.deepStrictEqual(nerfDartKeys("https://h.example:8443"), ["//h.example:8443/"]);
		assert.isUndefined(nerfDartKeys("not a url"));
	});

	it("keeps the shallowest keys, so the host's own key survives the bound", () => {
		const keys = nerfDartKeys(`https://h.example/${"a/".repeat(500)}`) ?? [];
		assert.lengthOf(keys, MAX_NERF_DART_KEYS);
		assert.strictEqual(keys.at(-1), "//h.example/");
		assert.strictEqual(keys[0], `//h.example/${"a/".repeat(MAX_NERF_DART_KEYS - 1)}`);
	});
});
