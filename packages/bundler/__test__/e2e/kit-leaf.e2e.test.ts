/**
 * The source-sibling spike: can the kit build with its `@effected/*` siblings resolved to source, with no sibling
 * `dist` anywhere?
 *
 * Run it with `EFFECTED_SPIKE=1 pnpm exec vitest run --project @effected/bundler --coverage.enabled=false kit-leaf`.
 * It builds `packages/cli-kit` in a scratch pnpm workspace that holds cli-kit and its `@effected/*` closure: each
 * package's manifest without `publishConfig.directory`/`linkDirectory`, and a COPY of its `src/`. A symlinked `src/`
 * would answer the wrong question, because tsgo and rolldown realpath it and would then resolve its siblings through
 * the main checkout's `node_modules` into `dist/dev`.
 *
 * Recorded 2026-11-06, Apple Silicon, three alternating runs each, one fresh `node` process per run:
 *
 * | Siblings resolve to | dts pass | js pass | Whole build | Peak RSS |
 * | --- | --- | --- | --- | --- |
 * | source | 462-468 ms | 112-113 ms | 751-757 ms | 294-296 MB |
 * | `dist/dev`, today | 453-458 ms | 171-177 ms | 793-801 ms | 298-303 MB |
 *
 * The dts pass takes 1.03x as long from source against the fallback's 2x limit, so the spike holds. The `dist/dev`
 * row is this bundler, because the old one reports no per-pass time; its own `build:prod` emits the same
 * `index.d.ts` and `package.json` byte for byte, and takes 5.5 s and 1286 MB with its API Extractor pass.
 *
 * Holding on cli-kit alone is weak evidence: its public types are explicit, so its declarations stay byte-identical
 * with every sibling link REMOVED. The probe below is what makes this test able to fail. A wider one-off sweep built
 * 48 of the kit's 49 packages from source with zero `.d.ts` byte differences from the old bundler; the 49th,
 * pnpm-plugin-effected, needs its virtual-module plugin, which that sweep did not pass.
 *
 * `bundledPackages` naming a sibling that resolves to source fails the build (tsgo declares only the package's own
 * project), and no kit package uses it. No build here changes directory, so this also proves the emitted manifest's
 * workspace specifiers resolve from `options.cwd`.
 *
 * Not proven here: API Extractor over source siblings, because the meta pass is not ported yet.
 */
import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Bundler } from "../../src/Bundler.js";
import { PackageBuildConfig } from "../../src/config/BuildConfig.js";
import { collectExportNames } from "../../src/dts/reexport-stub.js";

const REPO = resolve(import.meta.dirname, "../../../..");
const SPIKE_ENABLED = process.env.EFFECTED_SPIKE === "1";
const SPIKE_TIMEOUT = 300_000;

/** Which of a sibling's exported names a declaration file declares at its top level, whether or not it imports them. */
const inlinedSiblingTypes = (dts: string, siblingNames: ReadonlyArray<string>): ReadonlyArray<string> =>
	siblingNames.filter((name) =>
		new RegExp(
			`^(?:export )?(?:declare )?(?:abstract )?(?:class|const|let|var|enum|function|interface|namespace|type) ${name}\\b`,
			"m",
		).test(dts),
	);

/** The names a package's `src/index.ts` exports, which must be statically enumerable for the check to mean anything. */
const exportedNames = (packageDir: string): ReadonlyArray<string> => {
	const names = collectExportNames(readFileSync(join(packageDir, "src", "index.ts"), "utf-8"));
	assert.isTrue(names.complete, `${packageDir} has a star re-export`);
	assert.isAbove(names.names.size, 0);
	return [...names.names];
};

const bareSiblingImports = (dts: string): ReadonlyArray<string> =>
	[...dts.matchAll(/^import .* from "(@effected\/[^"]+)";$/gm)].flatMap((match) => (match[1] ? [match[1]] : []));

describe("the spike's inlining detector", () => {
	it("names a sibling type carried inline, with no import line to give it away", () => {
		assert.deepStrictEqual(inlinedSiblingTypes("declare class Distribution {}\n", ["Distribution", "Other"]), [
			"Distribution",
		]);
		assert.deepStrictEqual(inlinedSiblingTypes("interface Distribution {}\n", ["Distribution"]), ["Distribution"]);
		assert.deepStrictEqual(inlinedSiblingTypes("type Distribution = string;\n", ["Distribution"]), ["Distribution"]);
	});
	it("passes a declaration that only imports it or mentions it in a member", () => {
		const dts =
			'import { Distribution } from "@effected/kit";\ndeclare class Other {\n  type Distribution: string;\n}\n';
		assert.deepStrictEqual(inlinedSiblingTypes(dts, ["Distribution"]), []);
		assert.deepStrictEqual(bareSiblingImports(dts), ["@effected/kit"]);
	});
});

interface Manifest {
	name: string;
	exports?: Record<string, string>;
	scripts?: unknown;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	publishConfig: { directory?: string; linkDirectory?: boolean };
}

const readManifest = (dir: string): Manifest =>
	JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as Manifest;

/** cli-kit plus every sibling reachable through it: all of its own edges, and the runtime edges of the rest. */
const closureOf = (start: string): ReadonlyArray<string> => {
	const dirByName = new Map<string, string>();
	for (const dir of readdirSync(join(REPO, "packages"))) {
		if (existsSync(join(REPO, "packages", dir, "package.json"))) {
			dirByName.set(readManifest(join(REPO, "packages", dir)).name, dir);
		}
	}
	const seen = new Set<string>();
	const queue = [start];
	while (queue.length > 0) {
		const dir = queue.pop() as string;
		if (seen.has(dir)) continue;
		seen.add(dir);
		const manifest = readManifest(join(REPO, "packages", dir));
		const edges = {
			...manifest.dependencies,
			...manifest.peerDependencies,
			...(dir === start ? manifest.devDependencies : {}),
		};
		for (const name of Object.keys(edges)) {
			const sibling = dirByName.get(name);
			if (sibling !== undefined) queue.push(sibling);
		}
	}
	return [...seen];
};

/** Lays out the scratch workspace and installs it from the store. */
const makeWorkspace = (root: string): void => {
	const closure = closureOf("cli-kit");
	const names = new Set(closure.map((dir) => readManifest(join(REPO, "packages", dir)).name));
	for (const dir of closure) {
		const from = join(REPO, "packages", dir);
		const to = join(root, "packages", dir);
		const manifest = readManifest(from);
		delete manifest.publishConfig.directory;
		delete manifest.publishConfig.linkDirectory;
		delete manifest.scripts;
		for (const name of Object.keys(manifest.devDependencies ?? {})) {
			if (name.startsWith("@effected/") && !names.has(name)) delete manifest.devDependencies?.[name];
		}
		mkdirSync(to, { recursive: true });
		writeFileSync(join(to, "package.json"), JSON.stringify(manifest, null, "\t"));
		cpSync(join(from, "src"), join(to, "src"), { recursive: true });
		cpSync(join(from, "tsconfig.json"), join(to, "tsconfig.json"));
	}
	const rootManifest = JSON.parse(readFileSync(join(REPO, "package.json"), "utf-8")) as { devEngines: unknown };
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({
			name: "spike",
			version: "0.0.0",
			private: true,
			type: "module",
			devEngines: rootManifest.devEngines,
		}),
	);
	writeFileSync(
		join(root, "pnpm-workspace.yaml"),
		readFileSync(join(REPO, "pnpm-workspace.yaml"), "utf-8").replace(
			/packages:\n(?: {2}- .*\n)+/,
			"packages:\n  - packages/*\n",
		),
	);
	cpSync(join(REPO, "pnpm-lock.yaml"), join(root, "pnpm-lock.yaml"));
	execFileSync("pnpm", ["install", "--offline", "--ignore-scripts", "--no-frozen-lockfile"], {
		cwd: root,
		stdio: "pipe",
	});
};

// Never changes directory: the workspace specifiers in the emitted manifest resolve from `cwd`, so this also proves a
// real build does not depend on the process's own directory.
const buildCliKit = (cwd: string, extra: Record<string, unknown> = {}) => {
	const config = Schema.decodeUnknownSync(PackageBuildConfig)({
		meta: false,
		dtsExternals: ["@effected/cli-kit", "@effected/cli-kit/ui"],
		...extra,
	});
	return Effect.suspend(() => {
		rmSync(join(cwd, "dist"), { recursive: true, force: true });
		return Bundler.build({ cwd, config, tsdoctor: undefined, noExe: true, verbose: false, plugins: [], ci: false });
	});
};

describe.skipIf(!SPIKE_ENABLED)("cli-kit from source siblings", () => {
	it.effect(
		"builds with bare sibling imports, nothing inlined, and inferred sibling types that need the source",
		() =>
			Effect.gen(function* () {
				const root = process.env.EFFECTED_SPIKE_DIR ?? mkdtempSync(join(tmpdir(), "bundler-spike-"));
				yield* Effect.sync(() => makeWorkspace(root));
				const cwd = join(root, "packages", "cli-kit");
				const links = join(cwd, "node_modules", "@effected");
				const pkgDir = join(cwd, "dist", "prod", "npm", "pkg");

				// The setup itself: a sibling link lands on a package root inside the workspace, and no sibling has a dist.
				assert.strictEqual(realpathSync(join(links, "env")), realpathSync(join(root, "packages", "env")));
				assert.isFalse(existsSync(join(root, "packages", "env", "dist")));

				// The real package.
				const result = yield* buildCliKit(cwd);
				const dts = readFileSync(join(pkgDir, "index.d.ts"), "utf-8");
				const imports = bareSiblingImports(dts);
				assert.include(imports, "@effected/env");
				assert.include(imports, "@effected/kit");
				const siblingNames = [
					...exportedNames(join(root, "packages", "env")),
					...exportedNames(join(root, "packages", "kit")),
				];
				assert.deepStrictEqual(inlinedSiblingTypes(dts, siblingNames), []);
				assert.notStrictEqual(process.cwd(), cwd);
				const emitted = readManifest(pkgDir);
				assert.notInclude(JSON.stringify(emitted), "workspace:");
				assert.notInclude(JSON.stringify(emitted), "catalog:");
				assert.notMatch(dts, /from "\.\.?\/[^"]*(?:packages|src)\//);
				const issues = JSON.parse(readFileSync(result.issuesPath, "utf-8")) as { buildOk: boolean; errors: unknown[] };
				assert.strictEqual(issues.buildOk, true);
				assert.deepStrictEqual(issues.errors, []);
				const passes = result.report.targetGroups[0]?.passes ?? [];
				writeFileSync(
					join(root, "measurements.json"),
					JSON.stringify({
						dtsMs: passes.find((pass) => pass.id === "dts")?.ms,
						jsMs: passes.find((pass) => pass.id === "js")?.ms,
						workerPeakRssKb: process.resourceUsage().maxRSS,
					}),
				);

				// Inlining a sibling that resolves to source is refused outright: tsgo declares only the package's own project.
				const refused = yield* Effect.flip(buildCliKit(cwd, { bundledPackages: ["@effected/env"] }));
				assert.strictEqual(refused._tag, "BundlerError");
				assert.match(refused.message, /tsgo did not generate a declaration file/);

				// The control for the check above: real inlining from a rolled-up sibling must trip it.
				const envDir = join(root, "packages", "env");
				yield* Bundler.build({
					cwd: envDir,
					config: Schema.decodeUnknownSync(PackageBuildConfig)({ meta: false }),
					tsdoctor: undefined,
					noExe: true,
					verbose: false,
					plugins: [],
					ci: false,
				});
				const envLink = join(links, "env");
				rmSync(envLink);
				symlinkSync(join(envDir, "dist", "prod", "npm", "pkg"), envLink);
				yield* buildCliKit(cwd, { bundledPackages: ["@effected/env"] });
				assert.isNotEmpty(inlinedSiblingTypes(readFileSync(join(pkgDir, "index.d.ts"), "utf-8"), siblingNames));
				rmSync(envLink);
				symlinkSync(envDir, envLink);
				rmSync(join(envDir, "dist"), { recursive: true, force: true });

				// The probe: every export's type is inferred across a sibling boundary, so the declaration needs the sibling.
				const manifest = readManifest(cwd);
				manifest.exports = { ...manifest.exports, "./probe": "./src/probe.ts" };
				writeFileSync(join(cwd, "package.json"), JSON.stringify(manifest, null, "\t"));
				const env = join(root, "packages", "env", "src");
				writeFileSync(join(env, "spikeHidden.ts"), "export interface SpikeHidden { readonly hidden: string }\n");
				writeFileSync(
					join(env, "index.ts"),
					`${readFileSync(join(env, "index.ts"), "utf-8")}
import type { SpikeHidden } from "./spikeHidden.js";
export const makeSpikeHidden = (): SpikeHidden => ({ hidden: "x" });
`,
				);
				writeFileSync(
					join(cwd, "src", "probe.ts"),
					`import { Audience, makeSpikeHidden } from "@effected/env";
export const probeLayer = Audience.layerTest;
export const probeHidden = () => makeSpikeHidden();
`,
				);

				yield* buildCliKit(cwd);
				const fromSource = readFileSync(join(pkgDir, "probe.d.ts"), "utf-8");
				assert.match(fromSource, /probeLayer: \(kind: import\("@effected\/env"\)\.AudienceKind/);
				assert.deepStrictEqual(inlinedSiblingTypes(fromSource, siblingNames), []);
				// The known edge, pinned: a sibling's public function returning a type its entry point does not export
				// degrades to `any`, silently. The kit has no such site today; see okf/modules/bundler.md.
				assert.match(fromSource, /probeHidden: any;/);

				// The control: with the links gone the same source declares `any`, so the assertions above can fail.
				const parked = join(root, "parked-links");
				renameSync(links, parked);
				yield* buildCliKit(cwd);
				assert.match(readFileSync(join(pkgDir, "probe.d.ts"), "utf-8"), /probeLayer: any;/);
				renameSync(parked, links);
			}),
		SPIKE_TIMEOUT,
	);
});
