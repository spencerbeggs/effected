import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it, vi } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PACKAGES_DIR = fileURLToPath(new URL("../../", import.meta.url));
const PLUGIN = "@effected/pnpm-plugin-effected";
const KIT = "@effected/";
const FAMILY = "@effect/";
const CONFIG = "lib/build/pnpm-config.plugin.ts";
const SOURCE = () => readFileSync(join(PACKAGE_ROOT, CONFIG), "utf8");

/** The one declared catalog's entries whose name starts with `prefix`. */
function entriesWith(prefix: string): Map<string, string> {
	return new Map([...readCatalogEntries("effected")].filter(([name]) => name.startsWith(prefix)));
}

/**
 * The `effect` entry is an unquoted key, which the shared reader skips, so it is
 * read here by name, inside the `effected` catalog.
 */
function effectEntry(): string {
	const source = SOURCE();
	const match = /\n\t+effect: (\{[^}]*\})/.exec(source.slice(source.indexOf("effected: {")));
	assert.isNotNull(match, "the effected catalog declares no `effect` entry");
	return match?.[1] ?? "";
}

/**
 * The catalog is declared as an inline object literal inside the
 * `PnpmConfigPlugin(...)` call because that is how `rolldown-pnpm-config`
 * finds it: its `upgrade` CLI statically walks the call argument for
 * `.catalogs.<name>.packages`. Hoisting the literal into an exported `const`
 * would make it importable here and invisible to the rewriter, so this reads the
 * source the same way the CLI does.
 */
function readCatalogEntries(catalog: string): Map<string, string> {
	const source = SOURCE();
	// A name with a colon is a quoted key; a bare identifier is not.
	const quoted = source.indexOf(`"${catalog}": {`);
	const anchor = quoted !== -1 ? quoted : source.indexOf(`\t${catalog}: {`);
	assert.notStrictEqual(anchor, -1, `no \`${catalog}\` catalog declared in ${CONFIG}`);
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

describe("effected catalog: the kit", () => {
	it("covers every publishable package except the plugin itself", () => {
		const listed = [...entriesWith(KIT).keys()].sort();
		const expected = publishablePackages()
			.filter((name) => name !== PLUGIN)
			.sort();
		assert.deepStrictEqual(listed, expected);
		assert.isFalse(listed.includes(PLUGIN), "cataloguing the plugin makes the sync loop non-terminating");
	});

	it("uses the object form so a peers catalog is emitted", () => {
		for (const [name, spec] of entriesWith(KIT)) {
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

	it("declares nothing but the Effect family and the kit", () => {
		for (const name of readCatalogEntries("effected").keys()) {
			assert.isTrue(name.startsWith(KIT) || name.startsWith(FAMILY), `${name} is neither kit nor Effect family`);
		}
	});

	it("finds the packages it filters, so an empty catalog cannot pass silently", () => {
		const publishable = publishablePackages();
		assert.isAbove(publishable.length, 1, "publishConfig.access filtering yielded nothing");
		assert.include(publishable, PLUGIN, "the plugin is publishable; it is excluded from the catalog deliberately");
	});
});

describe("effected catalog: the Effect family", () => {
	const entries = () => new Map([...entriesWith(FAMILY), ["effect", effectEntry()]]);

	it("finds effect and its satellites, so an empty catalog cannot pass silently", () => {
		assert.isAtLeast(entries().size, 20);
		assert.isTrue(entries().has("@effect/platform-node"));
	});

	// The 4.x family rides one Effect minor with tildes under lock-minor: a caret
	// let the unattended sync cross into 4.1, whose removed root `Crypto` export
	// broke the published kit at import. The override layer below, not the catalog
	// range, is what keeps a satellite from pairing with an older core. What the
	// catalog must still promise is that the whole family names one version, so the
	// derived pins all agree. `@effect/tsgo` is 0.x, where a caret already holds
	// the minor.
	it("holds every 4.x entry to one minor under lock-minor with a floored peer", () => {
		for (const [name, spec] of entries()) {
			const range = /\brange:\s*"([^"]+)"/.exec(spec)?.[1] ?? "";
			const peer = /\bpeer:\s*"([^"]+)"/.exec(spec)?.[1] ?? "";
			const op = name === "@effect/tsgo" ? "\\^" : "~";
			assert.match(range, new RegExp(`^${op}\\d+\\.\\d+\\.\\d+$`), `${name} range does not lock its minor`);
			assert.match(peer, new RegExp(`^${op}\\d+\\.\\d+\\.0$`), `${name} peer is not floored to its minor`);
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
	return (/\brange:\s*"[\^~]?([^"]+)"/.exec(spec)?.[1] ?? "").trim();
}

/**
 * The build catalog's entries, keyed by name. Its bare keys (`react`, `tsdown`, ...)
 * are invisible to `readCatalogEntries`, which reads quoted names only, so this reads
 * both spellings out of the `effected:build` block.
 */
function buildEntries(): Map<string, string> {
	const source = SOURCE();
	const start = source.indexOf('"effected:build": {');
	assert.notStrictEqual(start, -1, "no `effected:build` catalog declared");
	const packagesAt = source.indexOf("packages: {", start);
	let depth = 0;
	let end = packagesAt;
	for (let i = source.indexOf("{", packagesAt); i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}" && --depth === 0) {
			end = i;
			break;
		}
	}
	const body = source.slice(packagesAt, end);
	const entries = new Map<string, string>();
	for (const match of body.matchAll(/^\t+(?:"([^"]+)"|([A-Za-z][\w-]*)): (\{[^}]*\})/gm)) {
		entries.set(match[1] ?? match[2] ?? "", match[3] ?? "");
	}
	return entries;
}

/** Every package the kit reads from the build catalog, and the chain the bundler runs. */
const BUILD_CHAIN = [
	"@microsoft/api-extractor",
	"@microsoft/api-extractor-model",
	"@microsoft/tsdoc",
	"@microsoft/tsdoc-config",
	"@rsbuild/core",
	"@tsdown/exe",
	"@types/node",
	"@types/react",
	"@types/react-dom",
	"react",
	"react-dom",
	"rolldown",
	"rolldown-plugin-dts",
	"tsdown",
	"tsx",
	"typescript",
].sort();

describe("effected:build catalog: the build chain", () => {
	it("declares exactly the build chain and the toolchain", () => {
		assert.deepStrictEqual([...buildEntries().keys()].sort(), BUILD_CHAIN);
	});

	it("names no kit or Effect package, which belong to the effected catalog", () => {
		for (const name of buildEntries().keys()) {
			assert.isFalse(name.startsWith(KIT) || name.startsWith(FAMILY) || name === "effect", name);
		}
	});

	it("gives every entry a range, a peer and a strategy, and resolves none from the workspace", () => {
		for (const [name, spec] of buildEntries()) {
			assert.match(spec, /\brange:\s*"[^"]+"/, `${name} must declare a range`);
			assert.match(spec, /\bpeer:\s*"[^"]+"/, `${name} must declare a peer or no peers catalog is emitted`);
			assert.match(spec, /\bstrategy:\s*"(lock|lock-minor)"/, `${name} must declare a strategy`);
			assert.notMatch(spec, /\bsource:/, `${name} is a registry package`);
		}
	});

	// tsdown itself asks for ^0.30.0; an older declaration pass is the split the build
	// catalog exists to end (effected#1277), so the catalog never names one.
	it("holds rolldown-plugin-dts at the line tsdown asks for", () => {
		assert.match(buildEntries().get("rolldown-plugin-dts") ?? "", /range:\s*"\^0\.30\./);
	});
});

describe("overrides", () => {
	const RC117 = "@effect/platform-node@4.0.0-rc.117>@effect/platform-node-shared";
	const RC118 = "@effect/platform-node@4.0.0-rc.118>@effect/platform-node-shared";
	/**
	 * The pins `overridesFromCatalogs` derives: every member on its own release
	 * line at the catalog's version (`effect` and the satellites on 4.x, `@effect/tsgo`
	 * on its 0.x line). Derived here from the catalog literal the same way, so the test
	 * moves with the catalog and only a disagreement between the literal and the
	 * built hook can fail it.
	 */
	function familyPins(): Record<string, string> {
		const effect = bare(effectEntry());
		assert.match(effect, /^4\.\d+\.\d+$/, "the catalog's `effect` entry is not a plain 4.x version");
		// Each pin sits on the member's own release line, derived from its range the way
		// the directive does: `^X.0.0` on a major line, `^0.Y.0` on a 0.x line.
		const pins: Record<string, string> = {};
		const entries = new Map([...entriesWith(FAMILY), ["effect", `{ range: "^${effect}" }`]]);
		for (const [name, spec] of entries) {
			const version = bare(spec);
			const [major, minor] = version.split(".");
			const line = major === "0" ? `^0.${minor}.0` : `^${major}.0.0`;
			pins[`${name}@${line}`] = version;
		}
		assert.strictEqual(pins["effect@^4.0.0"], effect);
		return pins;
	}
	const PINS = { ...familyPins(), [RC117]: "4.0.0-rc.117", [RC118]: "4.0.0-rc.118" };
	const PNPMFILE = join(PACKAGE_ROOT, "dist/prod/npm/pkg/pnpmfile.mjs");

	/**
	 * The built hook, not the source literal: what a consumer runs is the
	 * `updateConfig` the bundler emits, so this is the only place the merge with a
	 * consumer's own overrides can be observed. `dist/prod/npm/pkg` is what the
	 * release packs, so it is the published hook, and it is the target the test
	 * pre-build keeps fresh.
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
		// The kit shares the catalog but must never be pinned graph-wide: the directive's
		// `include` patterns are what keep it out, so a widened filter fails here.
		for (const selector of Object.keys(overrides as Record<string, string>)) {
			assert.isFalse(selector.startsWith(KIT), `${selector} pins a kit package graph-wide`);
			// The build catalog derives no pins: a build-chain range is a catalog range only.
			const target =
				selector
					.split(">")
					.at(-1)
					?.replace(/(.)@.*$/, "$1") ?? "";
			assert.notInclude(BUILD_CHAIN, target, `${selector} pins a build-chain package graph-wide`);
		}
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

describe("the consumer's catalog", () => {
	const PNPMFILE = join(PACKAGE_ROOT, "dist/prod/npm/pkg/pnpmfile.mjs");

	async function catalogsFor(config: Record<string, unknown>): Promise<Record<string, Record<string, string>>> {
		assert.isTrue(existsSync(PNPMFILE), "build the plugin before testing its pnpmfile");
		const { hooks } = (await import(PNPMFILE)) as {
			hooks: { updateConfig: (config: Record<string, unknown>) => Promise<Record<string, unknown>> };
		};
		const out = await hooks.updateConfig(config);
		return out.catalogs as Record<string, Record<string, string>>;
	}

	// One runtime catalog was the point of the rename: the effect / effected split, and
	// the `:peers` twins, confused every consumer. `pnpm pack` runs no hook, so a peer
	// a consumer writes as `catalog:effected` publishes the `effected` range. The build
	// chain is a second catalog by design (okf/decisions/effected-build-catalog.md).
	it("exposes exactly two catalogs, effected and effected:build, and hides both peers twins", async () => {
		const catalogs = await catalogsFor({});
		assert.deepStrictEqual(Object.keys(catalogs).sort(), ["effected", "effected:build"]);
		assert.notProperty(catalogs, "effected:peers");
		assert.notProperty(catalogs, "effected:build:peers");
	});

	it("carries the build chain in effected:build", async () => {
		const build = (await catalogsFor({}))["effected:build"];
		assert.deepStrictEqual(Object.keys(build ?? {}).sort(), BUILD_CHAIN);
		assert.match(build?.tsdown ?? "", /^\^0\.\d+\.\d+$/);
		assert.isString(build?.typescript);
	});

	it("lets a consumer's own effected:build entry win", async () => {
		const catalogs = await catalogsFor({ catalogs: { "effected:build": { typescript: "7.1.1" } } });
		assert.strictEqual(catalogs["effected:build"]?.typescript, "7.1.1");
		assert.isString(catalogs["effected:build"]?.tsdown, "the rest of the plugin's entries stay");
	});

	// tsdown's own typescript peer admits no 7.1 prerelease, which the build catalog holds.
	it("allows a TypeScript 7.1 prerelease under tsdown", async () => {
		const { hooks } = (await import(PNPMFILE)) as {
			hooks: { updateConfig: (config: Record<string, unknown>) => Promise<Record<string, unknown>> };
		};
		const { peerDependencyRules } = await hooks.updateConfig({});
		const allowed = (peerDependencyRules as { allowedVersions?: Record<string, string> }).allowedVersions;
		assert.match(allowed?.["tsdown>typescript"] ?? "", /\^7\.1\.0-beta/);
	});

	it("carries the effect family and the kit in it", async () => {
		const { effected } = await catalogsFor({});
		assert.match(effected?.effect ?? "", /^~4\.\d+\.\d+$/);
		assert.match(effected?.["@effect/platform-node"] ?? "", /^~4\.\d+\.\d+$/);
		assert.match(effected?.["@effected/cli-kit"] ?? "", /^\^0\.\d+\.\d+$/);
		assert.notProperty(effected, PLUGIN);
	});

	it("keeps a consumer's own catalogs, and its effected entry wins", async () => {
		const catalogs = await catalogsFor({ catalogs: { build: { tsx: "^4.0.0" }, effected: { effect: "4.1.1" } } });
		assert.deepStrictEqual(catalogs.build, { tsx: "^4.0.0" });
		assert.strictEqual(catalogs.effected?.effect, "4.1.1");
	});
});

describe("the effected tool", () => {
	const PNPMFILE = join(PACKAGE_ROOT, "dist/prod/npm/pkg/pnpmfile.mjs");
	// The tool's four packages and the three carrier libraries they replaced the
	// names of, plus the app kit: a consumer moving from a kit library to its `-kit`
	// name, or adding the tool, reaches each one through `catalog:effected`.
	const TOOL = [
		"@effected/plugin",
		"@effected/cli",
		"@effected/mcp",
		"@effected/engine",
		"@effected/kit",
		"@effected/cli-kit",
		"@effected/mcp-kit",
		"@effected/app",
	];

	it("catalogs the tool packages and the carrier libraries", () => {
		const listed = entriesWith(KIT);
		for (const name of TOOL) assert.isTrue(listed.has(name), `${name} is not in the effected catalog`);
	});

	// `@effected/plugin` is installed as a root devDependency; the hoist makes its
	// bins resolve from every package of a consumer's workspace.
	it("hoists the carrier publicly", async () => {
		assert.isTrue(existsSync(PNPMFILE), "build the plugin before testing its pnpmfile");
		const { hooks } = (await import(PNPMFILE)) as {
			hooks: { updateConfig: (config: Record<string, unknown>) => Promise<Record<string, unknown>> };
		};
		const { publicHoistPattern } = await hooks.updateConfig({});
		assert.isArray(publicHoistPattern, "the resolved config carries no publicHoistPattern");
		assert.include(publicHoistPattern as ReadonlyArray<string>, "@effected/plugin");
	});
});

/**
 * The pnpm settings that came with the build chain from silk's plugin: the release-age
 * exclusions for the kit and the chain's lockstep satellites, esbuild's build script and
 * the tsdown TypeScript rule. Read off the built hook, where the merge with a consumer's
 * own settings, and with silk's when both plugins run, can be observed.
 */
describe("settings that came with the build chain", () => {
	const PNPMFILE = join(PACKAGE_ROOT, "dist/prod/npm/pkg/pnpmfile.mjs");
	const EXCLUDED = ["@effected/*", "@oxc-project/*", "@rolldown/*", "@typescript/*"];
	// The value both plugins declare for `tsdown>typescript`; one changed alone makes them diverge.
	const TSDOWN_TYPESCRIPT = "^5.5.0 || ^6.0.0 || ^7.0.0 || ^7.1.0-beta";
	/** What silk's plugin hands on for the keys the two plugins share, as of the port. */
	const SILK = {
		minimumReleaseAgeExclude: ["@effected/*", "@oxc-project/*", "@rolldown/*", "@typescript/*", "@pnpm/*", "effect"],
		allowBuilds: { esbuild: true, "better-sqlite3": true },
		peerDependencyRules: { allowedVersions: { "tsdown>typescript": TSDOWN_TYPESCRIPT } },
	};

	async function updateConfig(config: Record<string, unknown>): Promise<Record<string, unknown>> {
		assert.isTrue(existsSync(PNPMFILE), "build the plugin before testing its pnpmfile");
		const { hooks } = (await import(PNPMFILE)) as {
			hooks: { updateConfig: (config: Record<string, unknown>) => Promise<Record<string, unknown>> };
		};
		return hooks.updateConfig(config);
	}

	/** Run the hook and collect what it warns, which is how a divergence surfaces. */
	async function withWarnings(config: Record<string, unknown>) {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const out = await updateConfig(config);
			return { out, warnings: spy.mock.calls.map((call) => call.join(" ")) };
		} finally {
			spy.mockRestore();
		}
	}

	it("excludes the kit and the chain's lockstep satellites from the release-age quarantine", async () => {
		const { minimumReleaseAgeExclude } = await updateConfig({});
		for (const pattern of [...EXCLUDED, "effect", "@effect/*"]) {
			assert.include(minimumReleaseAgeExclude as string[], pattern);
		}
		// The quarantine itself is repository policy and stays with silk.
		assert.notProperty(await updateConfig({}), "minimumReleaseAge");
	});

	it("unions a consumer's own exclusions with its own, deduplicated", async () => {
		const { minimumReleaseAgeExclude } = await updateConfig({ minimumReleaseAgeExclude: ["foo", "@rolldown/*"] });
		const list = minimumReleaseAgeExclude as string[];
		assert.include(list, "foo");
		assert.strictEqual(list.filter((p) => p === "@rolldown/*").length, 1);
	});

	it("allows esbuild's build script, and lets a consumer's own value win", async () => {
		assert.deepStrictEqual((await updateConfig({})).allowBuilds, { esbuild: true });
		assert.deepStrictEqual((await updateConfig({ allowBuilds: { esbuild: false } })).allowBuilds, { esbuild: false });
	});

	it("merges silk's settings for the same keys silently", async () => {
		const { out, warnings } = await withWarnings(SILK);
		assert.deepStrictEqual(warnings, [], "two plugins declaring the same value must not diverge");
		assert.deepStrictEqual(out.allowBuilds, { esbuild: true, "better-sqlite3": true });
		const rules = out.peerDependencyRules as { allowedVersions: Record<string, string> };
		assert.strictEqual(rules.allowedVersions["tsdown>typescript"], TSDOWN_TYPESCRIPT);
		const list = out.minimumReleaseAgeExclude as string[];
		for (const pattern of [...EXCLUDED, "@pnpm/*"]) assert.strictEqual(list.filter((p) => p === pattern).length, 1);
	});

	// The control for the silent merge above: a divergent value for the same key does warn,
	// so an empty warning list means the values agreed, not that nothing was checked.
	it("warns when another plugin's tsdown rule diverges", async () => {
		const { warnings } = await withWarnings({
			peerDependencyRules: { allowedVersions: { "tsdown>typescript": "^5.0.0" } },
		});
		assert.isNotEmpty(warnings);
		assert.match(warnings.join("\n"), /tsdown>typescript/);
	});

	// Kept with silk on purpose: the kit's build reaches typescript, tsx and @types/node as
	// direct dependencies, and the kit peers typescript and @types/node, so silencing a
	// missing one would hide a build that cannot run.
	it("hoists only the carrier and silences no missing peer", async () => {
		const out = await updateConfig({});
		assert.deepStrictEqual(out.publicHoistPattern, ["@effected/plugin"]);
		const rules = out.peerDependencyRules as { ignoreMissing?: string[] };
		assert.deepStrictEqual(rules.ignoreMissing ?? [], []);
	});
});
