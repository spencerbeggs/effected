import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PACKAGES_DIR = fileURLToPath(new URL("../../", import.meta.url));
const PLUGIN = "@effected/pnpm-plugin-effect";

/**
 * The catalog is declared as an inline object literal inside the
 * `PnpmConfigPlugin(...)` call because that is how `rolldown-pnpm-config`
 * finds it: its `upgrade` CLI statically walks the call argument for
 * `.catalogs.<name>.packages`. Hoisting the literal into an exported `const`
 * would make it importable here and invisible to the rewriter, and importing
 * `savvy.build.ts` at all would run the bundler, so this reads the source the
 * same way the CLI does.
 */
function readCatalogEntries(catalog: string): Map<string, string> {
	const source = readFileSync(join(PACKAGE_ROOT, "savvy.build.ts"), "utf8");
	const anchor = source.indexOf(`${catalog}: {`);
	assert.notStrictEqual(anchor, -1, `no \`${catalog}\` catalog declared in savvy.build.ts`);
	const packagesAt = source.indexOf("packages: {", anchor);
	assert.notStrictEqual(packagesAt, -1, `\`${catalog}\` catalog has no packages map`);
	const open = source.indexOf("{", packagesAt);
	let depth = 0;
	let close = open;
	for (let i = open; i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}") {
			depth--;
			if (depth === 0) {
				close = i;
				break;
			}
		}
	}
	const body = source.slice(open + 1, close);

	const entries = new Map<string, string>();
	for (let i = 0; i < body.length; i++) {
		if (body[i] !== '"') continue;
		const end = body.indexOf('"', i + 1);
		const name = body.slice(i + 1, end);
		const rest = body.slice(end + 1);
		const keyed = /^\s*:\s*\{/.exec(rest);
		if (!keyed) {
			i = end;
			continue;
		}
		const valueOpen = end + 1 + keyed[0].length - 1;
		let d = 0;
		let valueClose = valueOpen;
		for (let j = valueOpen; j < body.length; j++) {
			if (body[j] === "{") d++;
			else if (body[j] === "}") {
				d--;
				if (d === 0) {
					valueClose = j;
					break;
				}
			}
		}
		entries.set(name, body.slice(valueOpen, valueClose + 1));
		i = valueClose;
	}
	return entries;
}

/**
 * Publishability is `publishConfig.access`, never `private`: every manifest in
 * this repo is `private: true`, and the bundler's publishConfig transform is
 * what produces the publishable one.
 */
function publishablePackages(): string[] {
	return readdirSync(PACKAGES_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) => {
			// A directory without a manifest is not a package. Build output survives a
			// branch switch while tracked files do not, so `packages/<name>/` routinely
			// exists holding only `dist/` and `node_modules/` for a package the checked
			// out branch does not have. Reading straight through crashed this test with
			// an ENOENT naming a package.json nobody deleted.
			const manifest = join(PACKAGES_DIR, entry.name, "package.json");
			if (!existsSync(manifest)) return [];
			return [
				JSON.parse(readFileSync(manifest, "utf8")) as {
					name: string;
					publishConfig?: { access?: string };
				},
			];
		})
		.filter((manifest) => manifest.publishConfig?.access === "public")
		.map((manifest) => manifest.name);
}

describe("effected catalog", () => {
	it("covers every publishable package except the plugin itself", () => {
		const listed = [...readCatalogEntries("effected").keys()].sort();
		const expected = publishablePackages()
			.filter((name) => name !== PLUGIN)
			.sort();
		assert.deepStrictEqual(listed, expected);
		assert.isFalse(listed.includes(PLUGIN), "cataloguing the plugin makes the sync loop non-terminating");
	});

	it("uses the object form so a peers catalog is emitted", () => {
		for (const [name, spec] of readCatalogEntries("effected")) {
			assert.match(spec, /\brange:/, `${name} must declare a range`);
			assert.match(spec, /\bpeer:/, `${name} must declare a peer range or no peers catalog is emitted`);
			// The VALUES, not just the keys: `lock-minor` is what floors the patch while a
			// caret still keeps 0.x minors disjoint, and `source: "workspace"` is what makes
			// the entry resolve to this repo's next release instead of the registry. Either
			// one silently changed is a different policy, and a presence-only check cannot
			// tell the difference.
			assert.match(spec, /\bstrategy:\s*"lock-minor"/, `${name} must recompute peers with lock-minor`);
			assert.match(spec, /\bsource:\s*"workspace"/, `${name} must resolve from this workspace`);
		}
	});

	it("finds the packages it filters, so an empty catalog cannot pass silently", () => {
		const publishable = publishablePackages();
		assert.isAbove(publishable.length, 1, "publishConfig.access filtering yielded nothing");
		assert.include(publishable, PLUGIN, "the plugin is publishable; it is excluded from the catalog deliberately");
	});
});
