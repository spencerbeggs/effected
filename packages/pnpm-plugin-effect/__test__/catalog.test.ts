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

describe("effect catalog", () => {
	/**
	 * The `effect` catalog's own entry is an unquoted key, which the shared
	 * reader skips, so it is read here by name.
	 */
	function effectEntry(): string {
		const source = readFileSync(join(PACKAGE_ROOT, "savvy.build.ts"), "utf8");
		const match = /\n\t+effect: (\{[^}]*\})/.exec(source.slice(source.indexOf("effect: {\n\t\t\t\t\tpackages: {")));
		assert.isNotNull(match, "the effect catalog declares no `effect` entry");
		return match?.[1] ?? "";
	}

	const entries = () => new Map([...readCatalogEntries("effect"), ["effect", effectEntry()]]);

	it("finds effect and its satellites, so an empty catalog cannot pass silently", () => {
		assert.isAtLeast(entries().size, 20);
		assert.isTrue(entries().has("@effect/platform-node"));
	});

	// The catalog rides the stable line with carets under lock-minor; the override
	// layer below, not the catalog range, is what keeps a satellite from pairing with
	// an older core. What the catalog must still promise is that the whole family
	// names one version, so the derived pins all agree.
	it("keeps every entry on a caret under lock-minor with a floored peer", () => {
		for (const [name, spec] of entries()) {
			const range = /\brange:\s*"([^"]+)"/.exec(spec)?.[1] ?? "";
			const peer = /\bpeer:\s*"([^"]+)"/.exec(spec)?.[1] ?? "";
			if (name === "@effect/tsgo") {
				// tsgo is a tool on its own 0.x line, kept exact so the peer-rules
				// derivation (which only reads exact entries) still names it.
				assert.match(range, /^\d+\.\d+\.\d+$/, `${name} range is not exact`);
				continue;
			}
			assert.match(range, /^\^\d+\.\d+\.\d+$/, `${name} range is not a caret on a plain version`);
			assert.match(peer, /^\^\d+\.\d+\.0$/, `${name} peer is not floored to its minor`);
			assert.match(spec, /strategy:\s*"lock-minor"/, `${name} is not on strategy lock-minor`);
		}
	});

	it("holds every 4.x entry at the same version as effect itself", () => {
		const effect = bare(effectEntry());
		assert.match(effect, /^4\.\d+\.\d+$/);
		for (const [name, spec] of entries()) {
			if (name === "@effect/tsgo") continue;
			assert.strictEqual(bare(spec), effect, name);
		}
	});
});

/** The plain version a catalog entry's range names, operator stripped. */
function bare(spec: string): string {
	return (/\brange:\s*"\^?([^"]+)"/.exec(spec)?.[1] ?? "").trim();
}

describe("overrides", () => {
	const RC117 = "@effect/platform-node@4.0.0-rc.117>@effect/platform-node-shared";
	const RC118 = "@effect/platform-node@4.0.0-rc.118>@effect/platform-node-shared";
	/**
	 * The pins `overridesFromCatalogs` derives: `effect` and every satellite on
	 * the 4.x line at the catalog's own version, plus `@effect/tsgo` on its own
	 * 0.x line. Derived here from the catalog literal the same way, so the test
	 * moves with the catalog and only a disagreement between the literal and the
	 * built hook can fail it.
	 */
	function familyPins(): Record<string, string> {
		const source = readFileSync(join(PACKAGE_ROOT, "savvy.build.ts"), "utf8");
		const effect = /\n\t+effect: \{[^}]*range:\s*"\^?([^"]+)"/.exec(
			source.slice(source.indexOf("effect: {\n\t\t\t\t\tpackages: {")),
		)?.[1];
		assert.isString(effect);
		assert.match(effect ?? "", /^4\.\d+\.\d+$/, "the effect catalog's own entry is not a plain 4.x version");
		const entries = readCatalogEntries("effect");
		const tsgo = /\brange:\s*"(\d+)\.(\d+)\.(\d+)"/.exec(entries.get("@effect/tsgo") ?? "");
		assert.isNotNull(tsgo, "the effect catalog's tsgo entry is not a plain version");
		const pins = Object.fromEntries(
			[...entries.keys(), "effect"]
				.filter((name) => name !== "@effect/tsgo")
				.map((name) => [`${name}@^4.0.0`, effect as string]),
		);
		pins[`@effect/tsgo@^0.${tsgo?.[2]}.0`] = `${tsgo?.[1]}.${tsgo?.[2]}.${tsgo?.[3]}`;
		return pins;
	}
	const PINS = { ...familyPins(), [RC117]: "4.0.0-rc.117", [RC118]: "4.0.0-rc.118" };
	const PNPMFILE = join(PACKAGE_ROOT, "dist/dev/pkg/pnpmfile.mjs");

	/**
	 * The built hook, not the source literal: what a consumer runs is the
	 * `updateConfig` the bundler emits, so this is the only place the merge with a
	 * consumer's own overrides can be observed. `dist/dev/pkg` is the
	 * `publishConfig.directory`, so it is the published hook, and it is the
	 * target the test pre-build keeps fresh.
	 */
	async function updateConfig(config: Record<string, unknown>): Promise<Record<string, unknown>> {
		assert.isTrue(existsSync(PNPMFILE), "build the plugin before testing its pnpmfile");
		const { hooks } = (await import(PNPMFILE)) as {
			hooks: { updateConfig: (config: Record<string, unknown>) => Promise<Record<string, unknown>> };
		};
		return hooks.updateConfig(config);
	}

	it("pins the effect family to the catalog version and each prerelease parent's shared package to its own", async () => {
		const { overrides } = await updateConfig({});
		assert.deepStrictEqual(overrides, PINS);
		// Positive control on the derivation: the family is more than the two rc entries,
		// and tsgo is pinned on its own 0.x line rather than the 4.x one.
		assert.isAtLeast(Object.keys(PINS).length, 23);
		assert.notProperty(overrides, "@effect/tsgo@^4.0.0");
	});

	it("keeps a consumer's own overrides", async () => {
		const { overrides } = await updateConfig({ overrides: { foo: "1.0.0" } });
		assert.deepStrictEqual(overrides, { ...PINS, foo: "1.0.0" });
	});

	it("lets a consumer's value for the same selector win", async () => {
		const { overrides } = await updateConfig({ overrides: { [RC117]: "4.0.0-rc.116" } });
		assert.deepStrictEqual(overrides, { ...PINS, [RC117]: "4.0.0-rc.116" });
	});
});
