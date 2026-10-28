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

/**
 * The oracle: npm-registry-fetch 19.1.1's `regFromURI` (lib/auth.js), transcribed. It starts at
 * `//host[:port]` plus the whole path and strips either the trailing run of non-slash characters or one
 * trailing `/` per step, stopping at `//`. Every step removes at least one character, so it terminates;
 * it is the order the kit must match, not the implementation it uses.
 */
const npmOrder = (url: string): ReadonlyArray<string> => {
	const parsed = new URL(url);
	const keys: Array<string> = [];
	let key = `//${parsed.host}${parsed.pathname}`;
	while (key.length > "//".length) {
		keys.push(key);
		key = key.replace(/([^/]+|\/)$/, "");
	}
	return keys;
};

const ORDINARY = [
	"https://H.example:443/a/b/c.tgz",
	"https://h.example:8443",
	"https://h.example:8443/",
	"https://h.example/a/b/",
	"https://h.example/a",
	"https://registry.npmjs.org/@scope%2fname/1.0.0",
	"https://npm.pkg.github.com/acme/@acme%2fwidget?write=true#frag",
	"https://user:pass@h.example/p/q",
	"https://r.example.com//pkg/-/pkg-1.0.0.tgz",
	"https://r.example.com//",
	"https://r.example.com///a//b///",
	"http://[::1]:4873/pkg/-/pkg-1.0.0.tgz",
	"foo:///x",
	"foo:bar",
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
		assert.deepStrictEqual(JSON.parse(child.stdout), [8, 3, 11, MAX_NERF_DART_KEYS, MAX_NERF_DART_KEYS]);
	});

	it("tries exactly npm's keys in npm's order: each level with its slash, then without", () => {
		for (const url of ORDINARY) {
			assert.deepStrictEqual(nerfDartKeys(url), npmOrder(url), url);
		}
	});

	it("treats an empty segment as a level, deepest first, ending at the host", () => {
		assert.deepStrictEqual(nerfDartKeys("https://r.example.com//pkg/-/pkg-1.0.0.tgz"), [
			"//r.example.com//pkg/-/pkg-1.0.0.tgz",
			"//r.example.com//pkg/-/",
			"//r.example.com//pkg/-",
			"//r.example.com//pkg/",
			"//r.example.com//pkg",
			"//r.example.com//",
			"//r.example.com/",
			"//r.example.com",
		]);
		assert.deepStrictEqual(nerfDartKeys("https://r.example.com//"), [
			"//r.example.com//",
			"//r.example.com/",
			"//r.example.com",
		]);
	});

	it("walks an ordinary path, lowercasing the host and dropping a default port (the control)", () => {
		assert.deepStrictEqual(nerfDartKeys("https://H.example:443/a/b/c.tgz"), [
			"//h.example/a/b/c.tgz",
			"//h.example/a/b/",
			"//h.example/a/b",
			"//h.example/a/",
			"//h.example/a",
			"//h.example/",
			"//h.example",
		]);
		assert.deepStrictEqual(nerfDartKeys("https://h.example:8443"), ["//h.example:8443/", "//h.example:8443"]);
		assert.isUndefined(nerfDartKeys("not a url"));
	});

	it("keeps the shallowest keys, so the host's own keys survive the bound", () => {
		const keys = nerfDartKeys(`https://h.example/${"a/".repeat(500)}`) ?? [];
		assert.lengthOf(keys, MAX_NERF_DART_KEYS);
		assert.deepStrictEqual(keys.slice(-2), ["//h.example/", "//h.example"]);
		assert.deepStrictEqual(keys, npmOrder(`https://h.example/${"a/".repeat(500)}`).slice(-MAX_NERF_DART_KEYS));
	});
});
