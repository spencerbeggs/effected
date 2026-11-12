// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/generate.bundle.test.ts on 2026-11-06
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { decodeBundleManifest } from "@effected/manifest";
import { Effect, PlatformError } from "effect";
import { BundleManifestEmitError } from "../../src/errors.js";
import type { GenerateMetaOptions } from "../../src/meta/generate.js";
import { generateMeta } from "../../src/meta/generate.js";

/** generateMeta runs API Extractor over the scaffold on the host disk. */
const runGenerateMeta = (options: GenerateMetaOptions) =>
	Effect.runPromise(generateMeta(options).pipe(Effect.provide(NodeServices.layer)));

/** A valid 1×1 opaque PNG. */
const PNG_1X1 = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
		"base64",
	),
);

function scaffold(pkg: Record<string, unknown>): { cwd: string; dtsDir: string; outMetaDir: string } {
	const cwd = mkdtempSync(join(tmpdir(), "meta-bundle-"));
	writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "@scope/fixture", version: "1.0.0" }));
	writeFileSync(
		join(cwd, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ESNext",
				module: "ESNext",
				moduleResolution: "bundler",
				declaration: true,
				skipLibCheck: true,
				types: [],
			},
			include: [join(cwd, "**/*.d.ts")],
		}),
	);
	const dtsDir = join(cwd, "dist", "prod", "npm", "pkg");
	mkdirSync(dtsDir, { recursive: true });
	writeFileSync(join(dtsDir, "index.d.ts"), "/** @public */\nexport interface Public { y: number }\n");
	writeFileSync(join(dtsDir, "package.json"), JSON.stringify({ name: "@scope/fixture", version: "1.0.0", ...pkg }));
	mkdirSync(join(cwd, "models-a"), { recursive: true });
	mkdirSync(join(cwd, "models-b"), { recursive: true });
	return { cwd, dtsDir, outMetaDir: join(cwd, "dist", "prod", "npm", "meta") };
}

function baseOptions(s: ReturnType<typeof scaffold>): GenerateMetaOptions {
	return {
		cwd: s.cwd,
		packageName: "@scope/fixture",
		tsconfigPath: join(s.cwd, "tsconfig.json"),
		dtsDir: s.dtsDir,
		entries: { index: "index" },
		exportPaths: { index: "." },
		outMetaDir: s.outMetaDir,
		localPaths: ["models-a", "models-b"],
		tsdoc: { suppressWarnings: [], tagDefinitions: [] },
		onMessage: () => {},
	};
}

async function decodeAt(path: string): Promise<unknown> {
	return Effect.runPromise(decodeBundleManifest(JSON.parse(readFileSync(path, "utf-8"))));
}

// Every case here runs a real API Extractor pass (about 1.5s locally, slower on CI runners), and the
// stale-cleanup case runs three, so the 5s default is too tight for the suite.
describe("generateMeta bundle sidecar", { timeout: 60_000 }, () => {
	it("writes bundle.json for a private package from config and project tiers and copies it to localPaths", async () => {
		const s = scaffold({ private: true });
		await runGenerateMeta({
			...baseOptions(s),
			bundle: { config: { name: "Fixture" }, leaf: undefined, project: { name: "Proj" }, targets: [] },
		});
		const expected = { spec: 1, name: "Fixture", project: { name: "Proj" } };
		assert.deepStrictEqual(await decodeAt(join(s.outMetaDir, "bundle.json")), expected);
		assert.deepStrictEqual(await decodeAt(join(s.cwd, "models-a", "bundle.json")), expected);
		assert.deepStrictEqual(await decodeAt(join(s.cwd, "models-b", "bundle.json")), expected);
		assert.strictEqual(existsSync(join(s.outMetaDir, "og")), false);
	});

	it("derives registries from the group's targets and the emitted repository for a public package", async () => {
		const s = scaffold({ private: false, repository: { type: "git", url: "git+https://github.com/o/r.git" } });
		await runGenerateMeta({
			...baseOptions(s),
			bundle: {
				config: undefined,
				leaf: undefined,
				project: undefined,
				targets: [
					{ name: "npm", registry: "https://registry.npmjs.org" },
					{ name: "github", registry: "https://npm.pkg.github.com" },
				],
			},
		});
		assert.deepStrictEqual(await decodeAt(join(s.outMetaDir, "bundle.json")), {
			spec: 1,
			registries: [
				{ type: "npm", name: "npm", url: "https://www.npmjs.com/package/@scope/fixture" },
				{ type: "npm", name: "github", url: "https://github.com/o/r/pkgs/npm/fixture" },
			],
		});
	});

	it("renders the generated image first, writes it beside the manifest, and copies it to localPaths", async () => {
		const s = scaffold({ private: true });
		const seen: Array<{ name: string; version: string }> = [];
		await runGenerateMeta({
			...baseOptions(s),
			manifestTransform: (p) => ({ ...p, version: "2.0.0" }),
			bundle: {
				config: {
					openGraph: {
						images: [{ url: "https://example.com/og.png" }],
						generate: async (info) => {
							seen.push({ name: info.name, version: info.version });
							return PNG_1X1;
						},
					},
				},
				leaf: { tagline: "leaf tag" },
				project: undefined,
				targets: [],
			},
		});
		// The generator sees the transformed (optimistic) version, not the built one.
		assert.deepStrictEqual(seen, [{ name: "@scope/fixture", version: "2.0.0" }]);
		assert.deepStrictEqual(await decodeAt(join(s.outMetaDir, "bundle.json")), {
			spec: 1,
			tagline: "leaf tag",
			openGraph: {
				images: [
					{ path: "og/fixture.png", type: "image/png", width: 1, height: 1 },
					{ url: "https://example.com/og.png" },
				],
			},
		});
		for (const dir of [s.outMetaDir, join(s.cwd, "models-a"), join(s.cwd, "models-b")]) {
			assert.deepStrictEqual(readFileSync(join(dir, "og", "fixture.png")), Buffer.from(PNG_1X1));
		}
	});

	it("writes no sidecar and no og/ when bundle is undefined", async () => {
		const s = scaffold({ private: true });
		await runGenerateMeta(baseOptions(s));
		assert.strictEqual(existsSync(join(s.outMetaDir, "bundle.json")), false);
		assert.strictEqual(existsSync(join(s.outMetaDir, "og")), false);
		assert.strictEqual(existsSync(join(s.cwd, "models-a", "bundle.json")), false);
	});

	it("removes a previous build's sidecar and og/ from the meta dir and every localPaths copy", async () => {
		const s = scaffold({ private: true });
		const withImage = {
			config: { name: "Fixture", openGraph: { generate: async () => PNG_1X1 } },
			leaf: undefined,
			project: undefined,
			targets: [],
		};
		await runGenerateMeta({ ...baseOptions(s), bundle: withImage });
		for (const dir of [s.outMetaDir, join(s.cwd, "models-a"), join(s.cwd, "models-b")]) {
			assert.strictEqual(existsSync(join(dir, "bundle.json")), true, dir);
			assert.strictEqual(existsSync(join(dir, "og", "fixture.png")), true, dir);
		}
		// Same package, generator dropped: the image must disappear everywhere while the manifest stays.
		await runGenerateMeta({ ...baseOptions(s), bundle: { ...withImage, config: { name: "Fixture" } } });
		for (const dir of [s.outMetaDir, join(s.cwd, "models-a"), join(s.cwd, "models-b")]) {
			assert.deepStrictEqual(await decodeAt(join(dir, "bundle.json")), { spec: 1, name: "Fixture" });
			assert.strictEqual(existsSync(join(dir, "og")), false, dir);
		}
		// Identity dropped too: nothing to say, so the stale sidecar goes as well.
		await runGenerateMeta(baseOptions(s));
		for (const dir of [s.outMetaDir, join(s.cwd, "models-a"), join(s.cwd, "models-b")]) {
			assert.strictEqual(existsSync(join(dir, "bundle.json")), false, dir);
			assert.strictEqual(existsSync(join(dir, "fixture.api.json")), true, dir);
		}
	});

	it("deletes the retired tsdoctor.json from the meta dir and every localPaths copy, and never writes it", async () => {
		const s = scaffold({ private: true });
		const dirs = [s.outMetaDir, join(s.cwd, "models-a"), join(s.cwd, "models-b")];
		for (const dir of dirs) {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "tsdoctor.json"), JSON.stringify({ spec: 1, name: "Stale" }));
		}
		await runGenerateMeta({
			...baseOptions(s),
			bundle: { config: { name: "Fixture" }, leaf: undefined, project: undefined, targets: [] },
		});
		for (const dir of dirs) {
			assert.strictEqual(existsSync(join(dir, "tsdoctor.json")), false, dir);
			// positive control: the build did write its sidecar, under the new name
			assert.deepStrictEqual(await decodeAt(join(dir, "bundle.json")), { spec: 1, name: "Fixture" });
		}
	});

	it("wraps a sidecar that fails to encode as BundleManifestEmitError naming the path", async () => {
		const s = scaffold({ private: true });
		// A leaf image with neither path nor url violates the schema's XOR; the composer passes it
		// through untouched, so encodeBundleManifest is what rejects it — inside generateMeta's wrapper.
		const err = await runGenerateMeta({
			...baseOptions(s),
			bundle: {
				config: undefined,
				leaf: { openGraph: { images: [{} as { url: string }] } },
				project: undefined,
				targets: [],
			},
		}).catch((e: unknown) => e);
		assert.instanceOf(err, BundleManifestEmitError);
		assert.strictEqual((err as BundleManifestEmitError).path, join(s.outMetaDir, "bundle.json"));
		assert.strictEqual((err as BundleManifestEmitError).packageName, "@scope/fixture");
		assert.strictEqual(existsSync(join(s.outMetaDir, "bundle.json")), false);
	});

	it("wraps a sidecar write that fails on disk as BundleManifestEmitError", async () => {
		const s = scaffold({ private: true });
		// The generator runs after the api-model trio is written and before the sidecar write, so it is
		// the one seam where the meta dir can be made read-only without failing an earlier write. The
		// og/ dir is created first (writable itself) so the image write still succeeds.
		try {
			const err = await runGenerateMeta({
				...baseOptions(s),
				bundle: {
					config: {
						name: "Fixture",
						openGraph: {
							generate: async () => {
								mkdirSync(join(s.outMetaDir, "og"), { recursive: true });
								chmodSync(s.outMetaDir, 0o555);
								return PNG_1X1;
							},
						},
					},
					leaf: undefined,
					project: undefined,
					targets: [],
				},
			}).catch((e: unknown) => e);
			assert.instanceOf(err, BundleManifestEmitError);
			assert.strictEqual((err as BundleManifestEmitError).path, join(s.outMetaDir, "bundle.json"));
			// The write goes through the FileSystem service: its PlatformError wraps the host errno as its own cause.
			const cause = (err as BundleManifestEmitError).cause;
			assert.instanceOf(cause, PlatformError.PlatformError);
			assert.strictEqual(((cause as PlatformError.PlatformError).cause as NodeJS.ErrnoException).code, "EACCES");
		} finally {
			chmodSync(s.outMetaDir, 0o755);
		}
	});

	it("writes no sidecar when the tiers are empty and the package is private", async () => {
		const s = scaffold({ private: true });
		await runGenerateMeta({
			...baseOptions(s),
			bundle: { config: undefined, leaf: undefined, project: undefined, targets: [] },
		});
		assert.strictEqual(existsSync(join(s.outMetaDir, "bundle.json")), false);
	});
});

describe("generateMeta Open Graph cache", () => {
	it("persists a salted render under node_modules/.cache/effected/og", async () => {
		const s = scaffold({ name: "@scope/fixture", version: "1.0.0" });
		const generate = Object.assign(async () => PNG_1X1, { cacheSalt: "salt" });
		await runGenerateMeta({
			...baseOptions(s),
			bundle: { config: { openGraph: { generate } }, leaf: undefined, project: undefined, targets: [] },
		});
		const directory = join(s.cwd, "node_modules", ".cache", "effected", "og");
		assert.isTrue(existsSync(directory));
		assert.isNotEmpty(readdirSync(directory));
	});
});
