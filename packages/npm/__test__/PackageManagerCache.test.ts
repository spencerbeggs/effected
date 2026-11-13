// The facts table, pinned cell by cell. Every row is verified against the
// manager's own authority (cited in the module's TSDoc), and the table is the
// contract: a "tidied" path here is a cache that silently never hits.

import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { CachingPackageManager, PackageManagerCache } from "../src/index.js";

const HOME = "/home/ci";
const WIN_HOME = "C:\\Users\\ci";

const dir = (manager: CachingPackageManager, platform: string, home: string = HOME): string =>
	PackageManagerCache.defaultDirectory(manager, { platform, home });

describe("PackageManagerCache", () => {
	it("names the three rows", () => {
		assert.deepStrictEqual([...CachingPackageManager.literals], ["npm", "pnpm", "bun"]);
		assert.strictEqual(PackageManagerCache.Manager, CachingPackageManager);
	});

	it("pins the npm row: ~/.npm on Posix, LocalAppData npm-cache on Windows", () => {
		assert.strictEqual(dir("npm", "linux"), "/home/ci/.npm");
		assert.strictEqual(dir("npm", "darwin"), "/home/ci/.npm");
		assert.strictEqual(dir("npm", "win32", WIN_HOME), "C:\\Users\\ci\\AppData\\Local\\npm-cache");
	});

	it("pins the pnpm row: the storeDir default chain, and macOS is NOT the Linux path", () => {
		// The prior-art table this replaces folded macOS into the XDG path; pnpm
		// documents ~/Library/pnpm/store there.
		assert.strictEqual(dir("pnpm", "linux"), "/home/ci/.local/share/pnpm/store");
		assert.strictEqual(dir("pnpm", "darwin"), "/home/ci/Library/pnpm/store");
		assert.strictEqual(dir("pnpm", "win32", WIN_HOME), "C:\\Users\\ci\\AppData\\Local\\pnpm\\store");
	});

	it("pins the bun row: under the user profile on every platform, never AppData", () => {
		// bun documents no Windows divergence — the prior-art AppData row was
		// wrong, and this cell is the correction.
		assert.strictEqual(dir("bun", "linux"), "/home/ci/.bun/install/cache");
		assert.strictEqual(dir("bun", "darwin"), "/home/ci/.bun/install/cache");
		assert.strictEqual(dir("bun", "win32", WIN_HOME), "C:\\Users\\ci\\.bun\\install\\cache");
	});

	it("sends an unrecognized platform to the Linux/XDG family rather than refusing", () => {
		assert.strictEqual(dir("npm", "freebsd"), "/home/ci/.npm");
		assert.strictEqual(dir("pnpm", "openbsd"), "/home/ci/.local/share/pnpm/store");
	});

	it("the manager literal schema decodes its rows and refuses an unsupported manager", () => {
		assert.strictEqual(Schema.decodeUnknownSync(CachingPackageManager)("bun"), "bun");
		assert.throws(() => Schema.decodeUnknownSync(CachingPackageManager)("yarn"));
	});
});
